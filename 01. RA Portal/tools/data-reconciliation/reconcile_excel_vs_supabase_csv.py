from __future__ import annotations

import csv
import json
import math
import re
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "00. Raw Data"
DENORM_CSV = ROOT / "01. RA Portal" / "output" / "supabase_denormalized_asset_fund_snapshot_2026-06-02.csv"
OUT_DIR = ROOT / "01. RA Portal" / "output" / "reconciliation_20260602"


SOURCE_CONFIG = {
    "fund_master": {"contains": "펀드 관리", "header": 0},
    "fund_aum": {"contains": "펀드 AUM", "header": 1},
    "asset_master_source": {"contains": "투자 자산 관리", "header": 0},
    "fund_asset_source": {"contains": "펀드별 투자 자산", "header": 0},
    "lender_source": {"contains": "대주", "header": 0},
    "beneficiary_source": {"contains": "수익자", "header": 0},
    "staff_2025": {"contains": "2025년 인원", "header": 0},
    "staff_2026": {"contains": "2026.05 인원", "header": 0},
}


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip()
    if text in {"nan", "NaN", "None", "-", "　"}:
        return ""
    return re.sub(r"\s+", " ", text)


def normalize_id(value: Any) -> str:
    text = clean_text(value)
    if not text:
        return ""
    if re.fullmatch(r"\d+\.0", text):
        return text[:-2]
    return text


def normalize_name(value: Any) -> str:
    text = clean_text(value).lower()
    text = re.sub(r"\(구,\s*", "(", text)
    text = re.sub(r"[\s,./·ㆍ\-_()\[\]{}]", "", text)
    text = text.replace("주식회사", "").replace("(주)", "")
    text = re.sub(r"(투자|대출)$", "", text)
    return text


def to_number(value: Any) -> float | None:
    text = clean_text(value).replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def to_intish(value: Any) -> int | None:
    num = to_number(value)
    if num is None:
        return None
    return int(round(num))


def same_number(a: Any, b: Any, tolerance: float = 1.0) -> bool:
    na = to_number(a)
    nb = to_number(b)
    if na is None and nb is None:
        return True
    if na is None or nb is None:
        return False
    return abs(na - nb) <= tolerance


def find_source_files() -> dict[str, Path]:
    files = {}
    all_files = [p for p in SOURCE_DIR.glob("*.xlsx") if not p.name.startswith("~$")]
    for key, cfg in SOURCE_CONFIG.items():
        matches = [p for p in all_files if cfg["contains"] in p.name]
        if matches:
            files[key] = sorted(matches, key=lambda p: p.name)[-1]
    return files


def read_source(files: dict[str, Path], key: str) -> pd.DataFrame:
    cfg = SOURCE_CONFIG[key]
    df = pd.read_excel(files[key], header=cfg["header"], dtype=object)
    df.columns = [clean_text(c) for c in df.columns]
    return df.dropna(how="all").copy()


def read_denorm() -> pd.DataFrame:
    df = pd.read_csv(DENORM_CSV, dtype=object, encoding="utf-8-sig", keep_default_na=False)
    return df


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fieldnames is None:
        keys = []
        for row in rows:
            for key in row:
                if key not in keys:
                    keys.append(key)
        fieldnames = keys
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def workbook_inventory(files: dict[str, Path]) -> list[dict[str, Any]]:
    rows = []
    for key, path in sorted(files.items()):
        xl = pd.ExcelFile(path)
        for sheet in xl.sheet_names:
            header = SOURCE_CONFIG[key]["header"]
            df = pd.read_excel(path, sheet_name=sheet, header=header, dtype=object)
            df = df.dropna(how="all")
            columns = [clean_text(c) for c in df.columns]
            rows.append(
                {
                    "source_key": key,
                    "file_name": path.name,
                    "sheet_name": sheet,
                    "header_row_index": header,
                    "row_count": len(df),
                    "column_count": len(columns),
                    "columns": " | ".join(columns),
                }
            )
    return rows


def profile_denorm(csv_df: pd.DataFrame) -> list[dict[str, Any]]:
    rows = []
    total = len(csv_df)
    for col in csv_df.columns:
        s = csv_df[col].map(clean_text)
        nonblank = int((s != "").sum())
        top = Counter(s[s != ""]).most_common(5)
        rows.append(
            {
                "column_name": col,
                "nonblank_count": nonblank,
                "blank_count": total - nonblank,
                "nonblank_pct": round(nonblank / total * 100, 2) if total else 0,
                "distinct_nonblank": int(s[s != ""].nunique()),
                "top_values": json.dumps(top, ensure_ascii=False),
            }
        )
    return rows


def first_by_key(df: pd.DataFrame, key_col: str) -> dict[str, dict[str, Any]]:
    rows = {}
    for _, row in df.iterrows():
        key = normalize_id(row.get(key_col))
        if key and key not in rows:
            rows[key] = row.to_dict()
    return rows


def compare_funds(source: pd.DataFrame, csv_df: pd.DataFrame) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source_rows = first_by_key(source, "펀드코드")
    csv_rows = first_by_key(csv_df, "fund_id")
    mappings = [
        ("fund_name", "펀드명", "fund_name", "text"),
        ("fund_short_name", "약칭", "fund_short_name", "text"),
        ("fund_status", "운용상태", "fund_status", "text"),
        ("fund_sector", "투자섹터", "fund_sector", "text"),
        ("fund_location", "국내/해외", "fund_location", "text"),
        ("fund_setup_date", "최초 설정일", "fund_setup_date", "date_text"),
        ("fund_maturity_date", "만기일", "fund_maturity_date", "date_text"),
    ]
    mismatches = []
    for fund_id, src in source_rows.items():
        dst = csv_rows.get(fund_id)
        if not dst:
            mismatches.append(
                {
                    "domain": "fund_master",
                    "severity": "info",
                    "issue_type": "source_fund_not_in_denorm_csv",
                    "fund_id": fund_id,
                    "source_value": clean_text(src.get("펀드명")),
                    "csv_value": "",
                    "interpretation": "The denormalized CSV grain is asset_fund_links, so funds without linked assets are expected to be absent.",
                }
            )
            continue
        for field, src_col, dst_col, kind in mappings:
            src_val = clean_text(src.get(src_col))
            dst_val = clean_text(dst.get(dst_col))
            if kind == "date_text":
                src_val = src_val[:10]
                dst_val = dst_val[:10]
            if src_val and dst_val and src_val != dst_val:
                mismatches.append(
                    {
                        "domain": "fund_master",
                        "severity": "review",
                        "issue_type": "field_value_mismatch",
                        "fund_id": fund_id,
                        "field": field,
                        "source_column": src_col,
                        "csv_column": dst_col,
                        "source_value": src_val,
                        "csv_value": dst_val,
                        "interpretation": "Direct source field differs from denormalized CSV/Supabase value.",
                    }
                )
    summary = {
        "source_funds": len(source_rows),
        "csv_linked_funds": len(csv_rows),
        "source_funds_absent_from_csv": sum(1 for fid in source_rows if fid not in csv_rows),
        "csv_funds_not_in_source": sum(1 for fid in csv_rows if fid not in source_rows),
        "field_mismatch_count": sum(1 for r in mismatches if r["issue_type"] == "field_value_mismatch"),
    }
    return mismatches, summary


def compare_aum(source: pd.DataFrame, csv_df: pd.DataFrame) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source_rows = first_by_key(source, "펀드코드")
    csv_rows = first_by_key(csv_df, "fund_id")
    mappings = [
        ("fund_benchmark_aum", "AUM(원)", "fund_benchmark_aum"),
        ("fund_invested_aum", "AUM(원).1", "fund_invested_aum"),
        ("fund_equity_won", "Equity 총액(원)", "fund_equity_won"),
        ("fund_loan_won", "Loan 총액(원)", "fund_loan_won"),
        ("fund_deposit_won", "기준일자 임대보증금(원)", "fund_deposit_won"),
    ]
    mismatches = []
    compared = 0
    for fund_id, src in source_rows.items():
        dst = csv_rows.get(fund_id)
        if not dst:
            continue
        for field, src_col, dst_col in mappings:
            src_num = to_intish(src.get(src_col))
            dst_num = to_intish(dst.get(dst_col))
            if src_num is None and dst_num is None:
                continue
            compared += 1
            if src_num != dst_num:
                mismatches.append(
                    {
                        "domain": "fund_aum",
                        "severity": "review",
                        "issue_type": "numeric_value_mismatch",
                        "fund_id": fund_id,
                        "field": field,
                        "source_column": src_col,
                        "csv_column": dst_col,
                        "source_value": src_num,
                        "csv_value": dst_num,
                        "difference": "" if src_num is None or dst_num is None else dst_num - src_num,
                        "interpretation": "AUM value differs after load/normalization.",
                    }
                )
    summary = {
        "source_aum_funds": len(source_rows),
        "csv_linked_funds": len(csv_rows),
        "numeric_values_compared": compared,
        "numeric_mismatch_count": len(mismatches),
    }
    return mismatches, summary


def compare_fund_assets(source: pd.DataFrame, csv_df: pd.DataFrame) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    src_pairs = {}
    for _, row in source.iterrows():
        fund_id = normalize_id(row.get("펀드코드"))
        asset_name = clean_text(row.get("자산(건물)명"))
        if fund_id and asset_name:
            src_pairs[(fund_id, normalize_name(asset_name))] = {
                "fund_id": fund_id,
                "asset_name": asset_name,
                "business_stage": clean_text(row.get("사업단계")),
                "asset_type": clean_text(row.get("기초자산")),
                "address": clean_text(row.get("전체주소(시/도, 구/군 포함)")),
            }
    csv_pairs = {}
    csv_by_fund = {}
    for _, row in csv_df.iterrows():
        fund_id = normalize_id(row.get("fund_id"))
        asset_name = clean_text(row.get("asset_name"))
        if fund_id and asset_name:
            key = (fund_id, normalize_name(asset_name))
            csv_pairs[key] = row.to_dict()
            csv_by_fund.setdefault(fund_id, []).append(row.to_dict())
    mismatches = []
    for key, src in src_pairs.items():
        if key in csv_pairs:
            continue
        fund_id, norm_asset = key
        fund_assets = csv_by_fund.get(fund_id, [])
        mismatches.append(
            {
                "domain": "fund_asset_link",
                "severity": "review" if fund_assets else "info",
                "issue_type": "source_fund_asset_pair_not_exactly_in_csv",
                "fund_id": fund_id,
                "source_asset_name": src["asset_name"],
                "csv_asset_candidates_for_fund": " | ".join(clean_text(r.get("asset_name")) for r in fund_assets[:8]),
                "interpretation": "Exact normalized fund-asset pair is missing. This may be a canonical merge/rename, multi-asset split, synthetic asset, or a real omission.",
            }
        )
    for key, row in csv_pairs.items():
        if key not in src_pairs:
            fund_id, _ = key
            mismatches.append(
                {
                    "domain": "fund_asset_link",
                    "severity": "review",
                    "issue_type": "csv_fund_asset_pair_not_in_source",
                    "fund_id": fund_id,
                    "csv_asset_name": clean_text(row.get("asset_name")),
                    "relation_type": clean_text(row.get("relation_type")),
                    "interpretation": "CSV/Supabase contains a linked canonical asset not found as exact source pair. Check whether it came from inferred relationship, manual merge, or synthetic exposure logic.",
                }
            )
    summary = {
        "source_fund_asset_pairs": len(src_pairs),
        "csv_fund_asset_pairs": len(csv_pairs),
        "source_pairs_not_exact_in_csv": sum(1 for r in mismatches if r["issue_type"] == "source_fund_asset_pair_not_exactly_in_csv"),
        "csv_pairs_not_exact_in_source": sum(1 for r in mismatches if r["issue_type"] == "csv_fund_asset_pair_not_in_source"),
    }
    return mismatches, summary


def compare_asset_physical(source: pd.DataFrame, csv_df: pd.DataFrame) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source_by_code = {}
    source_by_name = {}
    for _, row in source.iterrows():
        code = clean_text(row.get("자산코드"))
        name = clean_text(row.get("자산(건물)명"))
        if code:
            source_by_code[code] = row.to_dict()
        if name and normalize_name(name) not in source_by_name:
            source_by_name[normalize_name(name)] = row.to_dict()
    csv_assets = {}
    for _, row in csv_df.iterrows():
        asset_id = clean_text(row.get("asset_id"))
        if asset_id and asset_id not in csv_assets:
            csv_assets[asset_id] = row.to_dict()
    mismatches = []
    matched = 0
    for asset_id, row in csv_assets.items():
        src = None
        match_method = ""
        code = clean_text(row.get("asset_code"))
        if code and code in source_by_code:
            src = source_by_code[code]
            match_method = "asset_code"
        else:
            src = source_by_name.get(normalize_name(row.get("asset_name")))
            match_method = "normalized_asset_name" if src is not None else ""
        if src is None:
            mismatches.append(
                {
                    "domain": "asset_physical",
                    "severity": "info",
                    "issue_type": "csv_asset_not_matched_to_asset_source",
                    "asset_id": asset_id,
                    "csv_asset_name": clean_text(row.get("asset_name")),
                    "asset_code": code,
                    "interpretation": "Canonical CSV asset is not directly matched to 투자 자산 관리 source by asset_code or normalized name. It may be synthetic, inferred, or from fund asset text.",
                }
            )
            continue
        matched += 1
        comparisons = [
            ("address_text", "전체주소(시/도, 구/군 포함)", "address_text", "text_contains"),
            ("gross_floor_area", "연면적(m²)", "gross_floor_area", "number"),
            ("site_area", "토지면적(㎡)", "site_area", "number"),
            ("business_stage", "사업단계", "business_stage", "text"),
            ("asset_type", "기초자산", "asset_type", "text"),
            ("portfolio_region", "투자지역", "portfolio_region", "text"),
            ("city", "투자도시", "city", "text"),
        ]
        for field, src_col, dst_col, kind in comparisons:
            src_val = clean_text(src.get(src_col))
            dst_val = clean_text(row.get(dst_col))
            if not src_val and not dst_val:
                continue
            if src_val and not dst_val:
                mismatches.append(
                    {
                        "domain": "asset_physical",
                        "severity": "review",
                        "issue_type": "source_nonblank_csv_blank",
                        "asset_id": asset_id,
                        "csv_asset_name": clean_text(row.get("asset_name")),
                        "match_method": match_method,
                        "field": field,
                        "source_column": src_col,
                        "csv_column": dst_col,
                        "source_value": src_val,
                        "csv_value": "",
                        "api_enrichment_status": clean_text(row.get("api_enrichment_status")),
                        "building_ledger_source": clean_text(row.get("building_ledger_source")),
                        "interpretation": "Source Excel has this value but the denormalized CSV field is blank for the matched canonical asset.",
                    }
                )
                continue
            if not src_val and dst_val:
                continue
            ok = False
            if kind == "number":
                ok = same_number(src_val, dst_val, tolerance=1.0)
            elif kind == "text_contains":
                ok = normalize_name(src_val) == normalize_name(dst_val) or normalize_name(src_val) in normalize_name(dst_val) or normalize_name(dst_val) in normalize_name(src_val)
            else:
                ok = normalize_name(src_val) == normalize_name(dst_val)
            if not ok:
                mismatches.append(
                    {
                        "domain": "asset_physical",
                        "severity": "review",
                        "issue_type": "asset_source_vs_csv_field_mismatch",
                        "asset_id": asset_id,
                        "csv_asset_name": clean_text(row.get("asset_name")),
                        "match_method": match_method,
                        "field": field,
                        "source_column": src_col,
                        "csv_column": dst_col,
                        "source_value": src_val,
                        "csv_value": dst_val,
                        "api_enrichment_status": clean_text(row.get("api_enrichment_status")),
                        "building_ledger_source": clean_text(row.get("building_ledger_source")),
                        "interpretation": "If building_ledger_source/api status is populated, physical fields may have been API-enriched rather than copied from Excel.",
                    }
                )
    summary = {
        "source_assets": len(source_by_code) or len(source_by_name),
        "csv_distinct_assets": len(csv_assets),
        "csv_assets_matched_to_source": matched,
        "asset_physical_mismatch_count": sum(1 for r in mismatches if r["issue_type"] == "asset_source_vs_csv_field_mismatch"),
        "csv_assets_not_matched_to_source": sum(1 for r in mismatches if r["issue_type"] == "csv_asset_not_matched_to_asset_source"),
    }
    return mismatches, summary


def exposure_limitations(lender: pd.DataFrame, beneficiary: pd.DataFrame, csv_df: pd.DataFrame) -> dict[str, Any]:
    linked_assets_with_lender = csv_df[csv_df["lender_exposure_count"].map(clean_text) != ""]["asset_id"].nunique()
    linked_assets_with_beneficiary = csv_df[csv_df["beneficiary_exposure_count"].map(clean_text) != ""]["asset_id"].nunique()
    return {
        "source_lender_rows": len(lender),
        "source_beneficiary_rows": len(beneficiary),
        "csv_columns_available": [
            "lender_committed_amt",
            "lender_drawn_amt",
            "beneficiary_committed_amt",
            "beneficiary_invested_amt",
            "lender_exposure_count",
            "beneficiary_exposure_count",
        ],
        "linked_assets_with_lender_summary": int(linked_assets_with_lender),
        "linked_assets_with_beneficiary_summary": int(linked_assets_with_beneficiary),
        "limitation": "The denormalized CSV carries asset-level exposure summaries, not lender/beneficiary row-level details. Row-level reconciliation must query lender_exposures and beneficiary_exposures or create a separate exposure-grain CSV.",
    }


def write_markdown(summary: dict[str, Any], issue_counts: Counter, top_issues: list[dict[str, Any]]) -> None:
    lines = [
        "# Supabase Denormalized CSV vs Source Excel Reconciliation",
        "",
        f"- Generated at: {datetime.now().isoformat(timespec='seconds')}",
        f"- Source folder: `{SOURCE_DIR}`",
        f"- Denormalized CSV: `{DENORM_CSV}`",
        f"- Output folder: `{OUT_DIR}`",
        "",
        "## Comparison Grain",
        "",
        "The denormalized CSV is not a full dump of every source row. Its grain is `asset_fund_link`: one row per canonical asset-to-fund relationship in Supabase.",
        "This means source funds with no linked canonical asset are expected to be absent from this CSV and should be tracked separately from true data loss.",
        "",
        "## Source vs Derived Field Classification",
        "",
        "| Field group | Main origin | Notes |",
        "|---|---|---|",
        "| Fund identity/status/AUM | Source Excel: 펀드 관리, 펀드 AUM 관리 | Loaded by fund_id; CSV includes only funds with asset_fund_links. |",
        "| Canonical asset identity | Derived/cleaned from fund_assets, 투자 자산 관리, aliases, manual merge logic | Names may differ from source because of canonicalization, merge, split, or synthetic asset logic. |",
        "| Physical specs | Mixed: Excel 투자 자산 관리 plus API-enriched asset_building_ledger | API fields can intentionally differ from old Excel fields. Preserve source/API distinction when reviewing. |",
        "| Project/risk/log context | Supabase project/risk/T5T/IOTA tables | Not primarily from the listed 00. Raw Data Excel folder. |",
        "| Lender/beneficiary exposure summaries | Source Excel collapsed into Supabase exposure tables, then summarized by asset | Current CSV lacks row-level lender/beneficiary detail. |",
        "",
        "## Summary",
        "",
    ]
    for key, value in summary.items():
        lines.append(f"- **{key}**: `{json.dumps(value, ensure_ascii=False)}`")
    lines.extend(["", "## Issue Counts", ""])
    for key, count in issue_counts.most_common():
        lines.append(f"- `{key}`: {count}")
    lines.extend(["", "## Top Review Issues", ""])
    for row in top_issues[:30]:
        label = row.get("field") or row.get("issue_type")
        identity = row.get("fund_id") or row.get("asset_id") or ""
        lines.append(f"- `{row.get('domain')}` / `{row.get('issue_type')}` / `{identity}` / `{label}`")
        src = row.get("source_value") or row.get("source_asset_name") or ""
        dst = row.get("csv_value") or row.get("csv_asset_name") or row.get("csv_asset_candidates_for_fund") or ""
        if src or dst:
            lines.append(f"  - source: {src}")
            lines.append(f"  - csv: {dst}")
        if row.get("interpretation"):
            lines.append(f"  - interpretation: {row['interpretation']}")
    lines.extend(
        [
            "",
            "## Repeatable Method",
            "",
            "1. Refresh or regenerate the denormalized CSV from Supabase.",
            "2. Put same-shape source workbooks under `00. Raw Data`.",
            "3. Run this script with the bundled Python runtime.",
            "4. Review `reconciliation_issues.csv` first, then drill into domain-specific summaries.",
            "5. Treat `info` rows as grain/coverage notes; treat `review` rows as possible distortion or mapping change candidates.",
        ]
    )
    (OUT_DIR / "reconciliation_report.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    files = find_source_files()
    csv_df = read_denorm()
    sources = {key: read_source(files, key) for key in files}

    inventory = workbook_inventory(files)
    write_csv(OUT_DIR / "source_workbook_inventory.csv", inventory)
    write_csv(OUT_DIR / "denorm_csv_profile.csv", profile_denorm(csv_df))

    all_issues: list[dict[str, Any]] = []
    summaries: dict[str, Any] = {
        "source_files": {key: path.name for key, path in files.items()},
        "denorm_rows": len(csv_df),
        "denorm_columns": len(csv_df.columns),
    }

    issues, summary = compare_funds(sources["fund_master"], csv_df)
    all_issues.extend(issues)
    summaries["fund_master"] = summary

    issues, summary = compare_aum(sources["fund_aum"], csv_df)
    all_issues.extend(issues)
    summaries["fund_aum"] = summary

    issues, summary = compare_fund_assets(sources["fund_asset_source"], csv_df)
    all_issues.extend(issues)
    summaries["fund_asset_links"] = summary

    issues, summary = compare_asset_physical(sources["asset_master_source"], csv_df)
    all_issues.extend(issues)
    summaries["asset_physical"] = summary

    summaries["exposure_reconciliation_scope"] = exposure_limitations(
        sources["lender_source"], sources["beneficiary_source"], csv_df
    )

    issue_fields = [
        "domain",
        "severity",
        "issue_type",
        "fund_id",
        "asset_id",
        "asset_code",
        "field",
        "source_column",
        "csv_column",
        "source_value",
        "csv_value",
        "difference",
        "source_asset_name",
        "csv_asset_name",
        "csv_asset_candidates_for_fund",
        "relation_type",
        "match_method",
        "api_enrichment_status",
        "building_ledger_source",
        "interpretation",
    ]
    write_csv(OUT_DIR / "reconciliation_issues.csv", all_issues, issue_fields)
    (OUT_DIR / "reconciliation_summary.json").write_text(
        json.dumps(summaries, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )

    counts = Counter((row.get("domain", ""), row.get("issue_type", ""), row.get("severity", "")) for row in all_issues)
    write_markdown(summaries, counts, [r for r in all_issues if r.get("severity") == "review"])

    print(
        json.dumps(
            {
                "output_dir": str(OUT_DIR),
                "source_files": len(files),
                "denorm_rows": len(csv_df),
                "issues": len(all_issues),
                "review_issues": sum(1 for r in all_issues if r.get("severity") == "review"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
