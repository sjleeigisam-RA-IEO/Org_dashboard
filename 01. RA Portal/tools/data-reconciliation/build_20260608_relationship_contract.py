from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import math
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "00. Raw Data"
OUT_DIR = ROOT / "01. RA Portal" / "output" / "relationship_contract_20260608"
SNAPSHOT_DATE = "2026-05-31"

SOURCE_CONTRACTS = {
    "fund_master": {
        "filename": "펀드 관리_20260608.xlsx",
        "header_row": 1,
        "key_columns": ["펀드코드"],
    },
    "asset_master": {
        "filename": "투자 자산 관리_20260608.xlsx",
        "header_row": 1,
        "key_columns": ["자산코드"],
    },
    "fund_asset_link": {
        "filename": "투자 자산 조회_20260608.xlsx",
        "header_row": 1,
        "key_columns": ["펀드코드", "순번"],
    },
    "fund_aum_snapshot": {
        "filename": "펀드 AUM 관리_20260608.xlsx",
        "header_row": 2,
        "key_columns": ["펀드코드"],
    },
    "beneficiary_exposure": {
        "filename": "수익자 정보 조회_20260608.xlsx",
        "header_row": 1,
        "key_columns": ["펀드코드", "수익자", "약정콜일자", "총약정금액", "투입금액"],
    },
    "lender_exposure": {
        "filename": "대주 정보 조회_20260608.xlsx",
        "header_row": 1,
        "key_columns": ["펀드코드", "대주", "트렌치", "대출인출일", "대출만기일", "대출약정금액(원)"],
    },
}


def clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip().replace("\xa0", " ")
    if text in {"nan", "NaN", "None", "-", "　"}:
        return ""
    return re.sub(r"\s+", " ", text)


def norm_id(value: Any) -> str:
    text = clean(value)
    if re.fullmatch(r"\d+\.0", text):
        return text[:-2]
    return text


def norm_name(value: Any) -> str:
    text = clean(value).lower()
    text = re.sub(r"\(구,\s*", "(", text)
    text = re.sub(r"[\s,./·ㆍ\-_()\[\]{}]", "", text)
    text = text.replace("주식회사", "").replace("(주)", "")
    return text


def num_text(value: Any) -> str:
    text = clean(value).replace(",", "")
    if not text:
        return ""
    try:
        numeric = float(text)
    except ValueError:
        return text
    if math.isnan(numeric):
        return ""
    if numeric.is_integer():
        return str(int(numeric))
    return str(numeric)


def row_hash(values: dict[str, str]) -> str:
    payload = json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def excel_col_to_index(col: str) -> int:
    value = 0
    for ch in col:
        value = value * 26 + ord(ch) - 64
    return value - 1


def cell_text(cell_xml: str, cell_type: str | None, shared_strings: list[str]) -> str:
    inline = re.findall(r"<t[^>]*>(.*?)</t>", cell_xml, re.S)
    if inline:
        return html.unescape("".join(inline))
    value_match = re.search(r"<v>(.*?)</v>", cell_xml, re.S)
    if not value_match:
        return ""
    value = html.unescape(value_match.group(1))
    if cell_type == "s":
        try:
            idx = int(value)
        except ValueError:
            return value
        return shared_strings[idx] if 0 <= idx < len(shared_strings) else ""
    return value


def read_xlsx_rows(path: Path, header_row: int) -> tuple[list[str], list[dict[str, str]]]:
    with zipfile.ZipFile(path) as archive:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_xml = archive.read("xl/sharedStrings.xml").decode("utf-8", errors="ignore")
            shared_strings = [html.unescape(text) for text in re.findall(r"<t[^>]*>(.*?)</t>", shared_xml, re.S)]
        sheet_names = [name for name in archive.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")]
        if not sheet_names:
            raise ValueError(f"No worksheet XML found in {path}")
        sheet_xml = archive.read(sheet_names[0]).decode("utf-8", errors="ignore")

    rows_by_number: dict[int, dict[int, str]] = {}
    for row_match in re.finditer(r"<row[^>]*r=\"(\d+)\"[^>]*>(.*?)</row>", sheet_xml, re.S):
        row_number = int(row_match.group(1))
        cells: dict[int, str] = {}
        for cell_match in re.finditer(
            r"<c[^>]*r=\"([A-Z]+)\d+\"[^>]*(?:t=\"([^\"]+)\")?[^>]*>(.*?)</c>",
            row_match.group(2),
            re.S,
        ):
            col, cell_type, body = cell_match.groups()
            value = clean(cell_text(body, cell_type, shared_strings))
            if value:
                cells[excel_col_to_index(col)] = value
        rows_by_number[row_number] = cells

    header_cells = rows_by_number.get(header_row, {})
    max_col = max(header_cells.keys(), default=-1)
    headers = [header_cells.get(idx, "") for idx in range(max_col + 1)]
    normalized_headers = []
    seen: Counter[str] = Counter()
    for idx, header in enumerate(headers):
        name = clean(header) or f"__blank_{idx + 1}"
        seen[name] += 1
        normalized_headers.append(name if seen[name] == 1 else f"{name}.{seen[name] - 1}")

    data_rows: list[dict[str, str]] = []
    for row_number in sorted(rows_by_number):
        if row_number <= header_row:
            continue
        cells = rows_by_number[row_number]
        row = {header: clean(cells.get(idx, "")) for idx, header in enumerate(normalized_headers)}
        if any(row.values()):
            row["source_row_number"] = str(row_number)
            data_rows.append(row)
    return normalized_headers, data_rows


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fieldnames is None:
        fieldnames = []
        for row in rows:
            for key in row:
                if key not in fieldnames:
                    fieldnames.append(key)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def load_sources() -> tuple[dict[str, list[str]], dict[str, list[dict[str, str]]]]:
    headers: dict[str, list[str]] = {}
    frames: dict[str, list[dict[str, str]]] = {}
    for source_key, spec in SOURCE_CONTRACTS.items():
        path = SOURCE_DIR / spec["filename"]
        source_headers, rows = read_xlsx_rows(path, spec["header_row"])
        for row in rows:
            body = {key: value for key, value in row.items() if key != "source_row_number"}
            row.update(
                {
                    "source_key": source_key,
                    "source_file": spec["filename"],
                    "source_sheet": "sheet",
                    "source_snapshot_date": SNAPSHOT_DATE,
                    "row_hash": row_hash(body),
                }
            )
        headers[source_key] = source_headers
        frames[source_key] = rows
    return headers, frames


def key_value(row: dict[str, str], columns: list[str]) -> str:
    return "|".join(clean(row.get(column)) for column in columns)


def source_inventory(headers: dict[str, list[str]], frames: dict[str, list[dict[str, str]]]) -> list[dict[str, Any]]:
    rows = []
    for source_key, spec in SOURCE_CONTRACTS.items():
        data = frames[source_key]
        keys = [key_value(row, spec["key_columns"]) for row in data]
        nonblank_keys = [key for key in keys if key and not key.startswith("|")]
        rows.append(
            {
                "source_key": source_key,
                "source_file": spec["filename"],
                "snapshot_date": SNAPSHOT_DATE,
                "header_row": spec["header_row"],
                "data_rows": len(data),
                "column_count": len(headers[source_key]),
                "contract_key": " + ".join(spec["key_columns"]),
                "nonblank_contract_keys": len(nonblank_keys),
                "unique_contract_keys": len(set(nonblank_keys)),
                "duplicate_contract_keys": len(nonblank_keys) - len(set(nonblank_keys)),
            }
        )
    return rows


def raw_rows(frames: dict[str, list[dict[str, str]]]) -> list[dict[str, Any]]:
    rows = []
    for source_key, data in frames.items():
        for row in data:
            rows.append(
                {
                    "source_key": source_key,
                    "source_file": row["source_file"],
                    "source_sheet": row["source_sheet"],
                    "source_row_number": row["source_row_number"],
                    "source_snapshot_date": row["source_snapshot_date"],
                    "row_hash": row["row_hash"],
                    "raw_payload": json.dumps(
                        {
                            key: value
                            for key, value in row.items()
                            if key
                            not in {
                                "source_key",
                                "source_file",
                                "source_sheet",
                                "source_row_number",
                                "source_snapshot_date",
                                "row_hash",
                            }
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    ),
                }
            )
    return rows


def fund_master_staging(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    output = []
    for row in rows:
        fund_id = norm_id(row.get("펀드코드"))
        if not fund_id:
            continue
        output.append(
            {
                "fund_id": fund_id,
                "short_name": clean(row.get("약칭")),
                "fund_name": clean(row.get("펀드명")),
                "vehicle_type": clean(row.get("Vehicle구분")),
                "holding_type": clean(row.get("모자구분")),
                "fund_form": clean(row.get("펀드형태")),
                "multi_class_type": clean(row.get("멀티클래스구분")),
                "aum_inclusion_flag": clean(row.get("AUM합산대상여부")),
                "status": clean(row.get("운용상태")),
                "aggregate_asset_names": clean(row.get("자산명")),
                "aggregate_beneficiary_names": clean(row.get("수익자 정보")),
                "aggregate_lender_names": clean(row.get("대주정보")),
                "source_row_number": row["source_row_number"],
                "row_hash": row["row_hash"],
            }
        )
    return output


def asset_master_staging(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    output = []
    for row in rows:
        asset_code = norm_id(row.get("자산코드"))
        if not asset_code:
            continue
        output.append(
            {
                "asset_code": asset_code,
                "canonical_name_candidate": clean(row.get("자산(건물)명")),
                "asset_type": clean(row.get("기초자산")),
                "business_stage": clean(row.get("사업단계")),
                "country_or_overseas": clean(row.get("국내/해외")),
                "raw_address": clean(row.get("전체주소(시/도, 구/군 포함)")),
                "portfolio_region": clean(row.get("투자지역")),
                "country": clean(row.get("투자국가")),
                "city": clean(row.get("투자도시")),
                "gross_floor_area_m2": num_text(row.get("연면적(m²)")),
                "gross_floor_area_py": num_text(row.get("연면적(평)")),
                "completion_date": clean(row.get("준공(예정)일")),
                "sold_flag": clean(row.get("매각여부")),
                "source_row_number": row["source_row_number"],
                "row_hash": row["row_hash"],
            }
        )
    return output


def asset_lookup(asset_rows: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    by_code = {row["asset_code"]: row for row in asset_rows}
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in asset_rows:
        key = norm_name(row.get("canonical_name_candidate"))
        if key:
            by_name[key].append(row)
    return by_code, by_name


def fund_asset_link_staging(link_rows: list[dict[str, str]], asset_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    _by_code, by_name = asset_lookup(asset_rows)
    output = []
    for row in link_rows:
        fund_id = norm_id(row.get("펀드코드"))
        sequence = norm_id(row.get("순번"))
        asset_name = clean(row.get("자산(건물)명"))
        matches = by_name.get(norm_name(asset_name), [])
        if len(matches) == 1:
            matched_asset_code = matches[0]["asset_code"]
            confidence = "0.94"
            review_status = "auto_matched"
            match_reason = "normalized_asset_name_unique"
        elif len(matches) > 1:
            matched_asset_code = ""
            confidence = "0.45"
            review_status = "needs_review"
            match_reason = "normalized_asset_name_ambiguous"
        else:
            matched_asset_code = ""
            confidence = "0"
            review_status = "unresolved"
            match_reason = "asset_name_not_found_in_asset_master_source"
        output.append(
            {
                "fund_id": fund_id,
                "source_sequence": sequence,
                "source_asset_name": asset_name,
                "matched_asset_code": matched_asset_code,
                "relation_type": "underlying_asset",
                "confidence": confidence,
                "review_status": review_status,
                "match_reason": match_reason,
                "source_row_number": row["source_row_number"],
                "row_hash": row["row_hash"],
            }
        )
    return output


def alias_candidates(asset_rows: list[dict[str, Any]], link_rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    _by_code, by_name = asset_lookup(asset_rows)
    rows = []
    for asset in asset_rows:
        name = clean(asset.get("canonical_name_candidate"))
        if name:
            rows.append(
                {
                    "asset_code": asset["asset_code"],
                    "alias_name": name,
                    "alias_type": "source_asset_master_name",
                    "confidence": "0.98",
                    "review_status": "verified_source_key",
                }
            )
    for row in link_rows:
        asset_name = clean(row.get("자산(건물)명"))
        matches = by_name.get(norm_name(asset_name), [])
        rows.append(
            {
                "asset_code": matches[0]["asset_code"] if len(matches) == 1 else "",
                "alias_name": asset_name,
                "alias_type": "fund_asset_source_name",
                "confidence": "0.90" if len(matches) == 1 else "0.45",
                "review_status": "auto_matched" if len(matches) == 1 else "needs_review",
            }
        )
    seen = set()
    deduped = []
    for row in rows:
        key = (row["asset_code"], norm_name(row["alias_name"]), row["alias_type"])
        if key in seen or not row["alias_name"]:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def aum_snapshot_staging(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    output = []
    for row in rows:
        fund_id = norm_id(row.get("펀드코드"))
        if not fund_id:
            continue
        output.append(
            {
                "fund_id": fund_id,
                "snapshot_date": SNAPSHOT_DATE,
                "benchmark_aum": num_text(row.get("AUM(원)")),
                "invested_aum": num_text(row.get("AUM(원).1")),
                "equity_won": num_text(row.get("Equity(원)")),
                "loan_won": num_text(row.get("Loan(원)")),
                "deposit_won": num_text(row.get("임대보증금(원)")),
                "aum_basis": "fund_level_source_snapshot",
                "asset_allocation_policy": "do_not_allocate_without_approved_rule",
                "source_row_number": row["source_row_number"],
                "row_hash": row["row_hash"],
            }
        )
    return output


def exposure_staging(rows: list[dict[str, str]], exposure_type: str) -> list[dict[str, Any]]:
    output = []
    if exposure_type == "lender":
        party_col = "대주"
        identity_cols = ["펀드코드", "대주", "트렌치", "대출인출일", "대출만기일", "대출약정금액(원)", "대출인출금액(원)"]
        amount_cols = {
            "committed_amt": "대출약정금액(원)",
            "drawn_amt": "대출인출금액(원)",
            "remaining_amt": "대출잔여금액(원)",
        }
    else:
        party_col = "수익자"
        identity_cols = ["펀드코드", "수익자", "약정콜일자", "총약정금액", "투입금액", "잔여약정금액"]
        amount_cols = {
            "committed_amt": "총약정금액",
            "invested_amt": "투입금액",
            "remaining_amt": "잔여약정금액",
        }
    for row in rows:
        fund_id = norm_id(row.get("펀드코드"))
        party_name = clean(row.get(party_col))
        if not fund_id or not party_name:
            continue
        identity_payload = {column: clean(row.get(column)) for column in identity_cols}
        output_row = {
            "exposure_type": exposure_type,
            "fund_id": fund_id,
            "party_name_raw": party_name,
            "party_name_normalized": norm_name(party_name),
            "snapshot_date": SNAPSHOT_DATE,
            "event_identity_hash": row_hash(identity_payload),
            "asset_id_policy": "derive_from_fund_asset_links_not_source_fk",
            "source_row_number": row["source_row_number"],
            "row_hash": row["row_hash"],
        }
        for target, source in amount_cols.items():
            output_row[target] = num_text(row.get(source))
        output.append(output_row)
    return output


def audit_rows(
    inventory: list[dict[str, Any]],
    fund_rows: list[dict[str, Any]],
    asset_rows: list[dict[str, Any]],
    link_rows: list[dict[str, Any]],
    lender_rows: list[dict[str, Any]],
    beneficiary_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in inventory:
        severity = "ok" if item["duplicate_contract_keys"] == 0 else "warning"
        rows.append(
            {
                "issue_type": "source_contract_key_uniqueness",
                "severity": severity,
                "source_key": item["source_key"],
                "row_count": item["data_rows"],
                "issue_count": item["duplicate_contract_keys"],
                "note": f"{item['contract_key']} uniqueness check",
            }
        )
    duplicate_asset_names = sum(1 for count in Counter(norm_name(row["canonical_name_candidate"]) for row in asset_rows).values() if count > 1)
    rows.append(
        {
            "issue_type": "asset_name_not_unique",
            "severity": "warning" if duplicate_asset_names else "ok",
            "source_key": "asset_master",
            "row_count": len(asset_rows),
            "issue_count": duplicate_asset_names,
            "note": "Asset names are aliases/display values; asset_code remains the source key.",
        }
    )
    unresolved = [row for row in link_rows if row["review_status"] == "unresolved"]
    ambiguous = [row for row in link_rows if row["review_status"] == "needs_review"]
    rows.extend(
        [
            {
                "issue_type": "fund_asset_link_unresolved",
                "severity": "warning" if unresolved else "ok",
                "source_key": "fund_asset_link",
                "row_count": len(link_rows),
                "issue_count": len(unresolved),
                "note": "Source asset name did not match asset master source by normalized name.",
            },
            {
                "issue_type": "fund_asset_link_ambiguous",
                "severity": "warning" if ambiguous else "ok",
                "source_key": "fund_asset_link",
                "row_count": len(link_rows),
                "issue_count": len(ambiguous),
                "note": "Source asset name matched multiple asset master rows.",
            },
        ]
    )
    for exposure_type, exposure_rows in [("lender", lender_rows), ("beneficiary", beneficiary_rows)]:
        identity_counts = Counter(row["event_identity_hash"] for row in exposure_rows)
        duplicate_identity_count = sum(count - 1 for count in identity_counts.values() if count > 1)
        rows.append(
            {
                "issue_type": f"{exposure_type}_event_identity_duplicates",
                "severity": "warning" if duplicate_identity_count else "ok",
                "source_key": f"{exposure_type}_exposure",
                "row_count": len(exposure_rows),
                "issue_count": duplicate_identity_count,
                "note": "Exposure fact identity must include source row hash; simple natural keys are not unique enough.",
            }
        )
    comma_asset_names = sum(1 for row in fund_rows if "," in clean(row.get("aggregate_asset_names")))
    rows.append(
        {
            "issue_type": "aggregate_asset_name_contains_comma",
            "severity": "info",
            "source_key": "fund_master",
            "row_count": len(fund_rows),
            "issue_count": comma_asset_names,
            "note": "Comma-separated asset names are display aggregates, not relationship sources.",
        }
    )
    return rows


def write_report(path: Path, summary: dict[str, Any], audits: list[dict[str, Any]]) -> None:
    lines = [
        "# 2026-06-08 Relationship Contract Staging Report",
        "",
        f"- Generated at: {datetime.now().isoformat(timespec='seconds')}",
        f"- Source snapshot date: {SNAPSHOT_DATE}",
        "- Policy: preserve source data, rebuild relationship layer through staging and audit.",
        "",
        "## Source Inventory",
        "",
        "| source | rows | columns | contract key | duplicate keys |",
        "|---|---:|---:|---|---:|",
    ]
    for row in summary["inventory"]:
        lines.append(
            f"| {row['source_key']} | {row['data_rows']} | {row['column_count']} | {row['contract_key']} | {row['duplicate_contract_keys']} |"
        )
    lines.extend(["", "## Staging Outputs", "", "| artifact | rows |", "|---|---:|"])
    for name, count in summary["outputs"].items():
        lines.append(f"| `{name}` | {count} |")
    lines.extend(["", "## Contract Audit", "", "| issue | severity | source | count | note |", "|---|---|---|---:|---|"])
    for row in audits:
        lines.append(f"| {row['issue_type']} | {row['severity']} | {row['source_key']} | {row['issue_count']} | {row['note']} |")
    lines.extend(
        [
            "",
            "## Next Action",
            "",
            "1. Review unresolved/ambiguous fund-asset link rows.",
            "2. Apply relationship_contract_v1 SQL to add non-destructive resolution/audit views.",
            "3. Promote approved staging rows into canonical relationship tables.",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build 2026-06-08 source/staging relationship contract artifacts.")
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    args = parser.parse_args()

    headers, frames = load_sources()
    inventory = source_inventory(headers, frames)
    raw = raw_rows(frames)
    funds = fund_master_staging(frames["fund_master"])
    assets = asset_master_staging(frames["asset_master"])
    links = fund_asset_link_staging(frames["fund_asset_link"], assets)
    aliases = alias_candidates(assets, frames["fund_asset_link"])
    aum = aum_snapshot_staging(frames["fund_aum_snapshot"])
    lenders = exposure_staging(frames["lender_exposure"], "lender")
    beneficiaries = exposure_staging(frames["beneficiary_exposure"], "beneficiary")
    audits = audit_rows(inventory, funds, assets, links, lenders, beneficiaries)

    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    write_csv(out_dir / "source_inventory.csv", inventory)
    write_csv(out_dir / "source_raw_rows.csv", raw)
    write_csv(out_dir / "fund_master_staging.csv", funds)
    write_csv(out_dir / "asset_master_staging.csv", assets)
    write_csv(out_dir / "fund_asset_link_staging.csv", links)
    write_csv(out_dir / "asset_alias_candidates.csv", aliases)
    write_csv(out_dir / "fund_aum_snapshot_staging.csv", aum)
    write_csv(out_dir / "lender_exposure_staging.csv", lenders)
    write_csv(out_dir / "beneficiary_exposure_staging.csv", beneficiaries)
    write_csv(out_dir / "relationship_contract_audit.csv", audits)

    summary = {
        "snapshot_date": SNAPSHOT_DATE,
        "inventory": inventory,
        "outputs": {
            "source_raw_rows.csv": len(raw),
            "fund_master_staging.csv": len(funds),
            "asset_master_staging.csv": len(assets),
            "fund_asset_link_staging.csv": len(links),
            "asset_alias_candidates.csv": len(aliases),
            "fund_aum_snapshot_staging.csv": len(aum),
            "lender_exposure_staging.csv": len(lenders),
            "beneficiary_exposure_staging.csv": len(beneficiaries),
            "relationship_contract_audit.csv": len(audits),
        },
    }
    (out_dir / "relationship_contract_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_report(out_dir / "relationship_contract_report.md", summary, audits)
    print(json.dumps({"output_dir": str(out_dir), "outputs": summary["outputs"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
