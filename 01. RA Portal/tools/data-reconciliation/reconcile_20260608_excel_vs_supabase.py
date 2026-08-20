from __future__ import annotations

import csv
import json
import math
import os
import re
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "00. Raw Data"
OUT_DIR = ROOT / "01. RA Portal" / "output" / "reconciliation_20260608"
RUN_DATE = "20260608"


def clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    text = str(value).strip()
    if text in {"nan", "NaN", "None", "-", "　"}:
        return ""
    return re.sub(r"\s+", " ", text.replace("\xa0", " "))


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
    text = re.sub(r"(투자|대출)$", "", text)
    return text


def valid_fund_id(value: Any) -> bool:
    text = norm_id(value)
    return bool(re.fullmatch(r"\d{6}", text) or re.fullmatch(r"[A-Z]\d{5}", text))


def num(value: Any) -> int | None:
    text = clean(value).replace(",", "")
    if not text:
        return None
    try:
        return int(round(float(text)))
    except ValueError:
        return None


def date_text(value: Any) -> str:
    text = clean(value)
    if not text:
        return ""
    return text[:10]


def country_code_from_source(value: Any) -> str:
    text = clean(value)
    if text == "국내":
        return "KR"
    if text in {"해외", "국외"}:
        return "OVERSEAS"
    return text


def load_env() -> None:
    path = ROOT / ".env"
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def fetch_all(table: str, select: str = "*") -> list[dict[str, Any]]:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    rows: list[dict[str, Any]] = []
    start = 0
    size = 1000
    while True:
        query = urllib.parse.urlencode({"select": select}, safe="*,.:()")
        request = urllib.request.Request(
            f"{url}/rest/v1/{table}?{query}",
            headers={**headers, "Range": f"{start}-{start + size - 1}"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            batch = json.loads(response.read().decode("utf-8") or "[]")
        rows.extend(batch)
        if len(batch) < size:
            return rows
        start += size


def find_file(required_columns: list[str], header: int = 0, name_contains: str = "") -> Path:
    candidates = [p for p in SOURCE_DIR.glob(f"*{RUN_DATE}*.xlsx") if not p.name.startswith("~$")]
    if name_contains:
        candidates = [p for p in candidates if name_contains in p.name]
    for path in candidates:
        try:
            frame = pd.read_excel(path, header=header, nrows=2, dtype=object)
        except Exception:
            continue
        columns = {clean(col) for col in frame.columns}
        if set(required_columns).issubset(columns):
            return path
    raise FileNotFoundError(f"No {RUN_DATE} workbook has columns: {required_columns}")


def read_excel(path: Path, header: int = 0) -> pd.DataFrame:
    frame = pd.read_excel(path, header=header, dtype=object)
    frame.columns = [clean(col) for col in frame.columns]
    return frame.dropna(how="all").copy()


def source_files() -> dict[str, tuple[Path, int]]:
    return {
        "fund_master": (find_file(["펀드코드", "펀드명", "운용상태"], 0, "펀드 관리"), 0),
        "fund_aum": (find_file(["펀드코드", "AUM(원)", "AUM(원).1"], 1, "펀드 AUM"), 1),
        "asset_master_source": (find_file(["자산코드", "자산(건물)명", "전체주소(시/도, 구/군 포함)"], 0, "투자 자산 관리"), 0),
        "fund_asset_source": (find_file(["펀드코드", "순번", "자산(건물)명"], 0, "투자 자산 조회"), 0),
        "lender_source": (find_file(["펀드코드", "대주", "대출약정금액(원)"], 0, "대주"), 0),
        "beneficiary_source": (find_file(["펀드코드", "수익자", "총약정금액"], 0, "수익자"), 0),
    }


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


def workbook_inventory(files: dict[str, tuple[Path, int]], frames: dict[str, pd.DataFrame]) -> list[dict[str, Any]]:
    rows = []
    for key, (path, header) in files.items():
        frame = frames[key]
        rows.append(
            {
                "source_key": key,
                "file_name": path.name,
                "header_row_index": header,
                "row_count": len(frame),
                "column_count": len(frame.columns),
                "columns": " | ".join(map(str, frame.columns)),
            }
        )
    return rows


def by_key(frame: pd.DataFrame, column: str) -> dict[str, dict[str, Any]]:
    result = {}
    for _, row in frame.iterrows():
        key = norm_id(row.get(column))
        if column == "펀드코드" and not valid_fund_id(key):
            continue
        if key and key not in result:
            result[key] = row.to_dict()
    return result


def compare_text_field(
    rows: list[dict[str, Any]],
    domain: str,
    key_name: str,
    key_value: str,
    field: str,
    source_column: str,
    source_value: Any,
    db_column: str,
    db_value: Any,
    severity: str = "review",
) -> None:
    source = clean(source_value)
    db = clean(db_value)
    if field in {"asset_name", "dept", "manager", "primary_region"}:
        source_parts = {clean(part) for part in source.split(",") if clean(part)}
        db_parts = {clean(part) for part in db.split(",") if clean(part)}
        if source_parts == db_parts:
            return
    if source == db:
        return
    rows.append(
        {
            "domain": domain,
            "severity": severity,
            "issue_type": "field_change_candidate",
            key_name: key_value,
            "field": field,
            "source_column": source_column,
            "db_column": db_column,
            "source_value": source,
            "db_value": db,
            "difference": "",
            "recommendation": "Review before update. Do not apply automatically.",
        }
    )


def compare_numeric_field(
    rows: list[dict[str, Any]],
    domain: str,
    fund_id: str,
    field: str,
    source_column: str,
    source_value: Any,
    db_column: str,
    db_value: Any,
) -> None:
    source = num(source_value)
    db = num(db_value)
    if source == db:
        return
    rows.append(
        {
            "domain": domain,
            "severity": "review",
            "issue_type": "numeric_change_candidate",
            "fund_id": fund_id,
            "field": field,
            "source_column": source_column,
            "db_column": db_column,
            "source_value": "" if source is None else source,
            "db_value": "" if db is None else db,
            "difference": "" if source is None or db is None else source - db,
            "recommendation": "Likely update candidate if the new workbook is the authoritative period.",
        }
    )


def compare_funds(source: pd.DataFrame, db_funds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source_rows = by_key(source, "펀드코드")
    db_rows = {norm_id(row.get("fund_id")): row for row in db_funds if norm_id(row.get("fund_id"))}
    issues: list[dict[str, Any]] = []
    mappings = [
        ("fund_name", "펀드명", "fund_name"),
        ("short_name", "약칭", "short_name"),
        ("asset_name", "자산명", "asset_name"),
        ("status", "운용상태", "status"),
        ("location", "국내/해외", "location"),
        ("sector", "투자섹터", "sector"),
        ("fund_type", "펀드유형", "fund_type"),
        ("legal_form", "법적형태", "legal_form"),
        ("recruitment_type", "모집형태", "recruitment_type"),
        ("primary_region", "주요투자지역", "primary_region"),
        ("dept", "부서(운용)", "dept"),
        ("manager", "담당자(운용)", "manager"),
    ]
    date_mappings = [
        ("setup_date", "최초 설정일", "setup_date"),
        ("maturity_date", "만기일", "maturity_date"),
        ("termination_date", "해지일", "termination_date"),
    ]
    for fund_id, src in source_rows.items():
        db = db_rows.get(fund_id)
        if not db:
            issues.append(
                {
                    "domain": "fund_master",
                    "severity": "update_candidate",
                    "issue_type": "new_source_fund_not_in_supabase",
                    "fund_id": fund_id,
                    "source_value": clean(src.get("펀드명")),
                    "db_value": "",
                    "recommendation": "New fund candidate. Verify whether it should be inserted.",
                }
            )
            continue
        for field, src_col, db_col in mappings:
            compare_text_field(issues, "fund_master", "fund_id", fund_id, field, src_col, src.get(src_col), db_col, db.get(db_col))
        for field, src_col, db_col in date_mappings:
            compare_text_field(
                issues,
                "fund_master",
                "fund_id",
                fund_id,
                field,
                src_col,
                date_text(src.get(src_col)),
                db_col,
                date_text(db.get(db_col)),
            )
    for fund_id, db in db_rows.items():
        if fund_id not in source_rows:
            issues.append(
                {
                    "domain": "fund_master",
                    "severity": "info",
                    "issue_type": "supabase_fund_not_in_today_source",
                    "fund_id": fund_id,
                    "source_value": "",
                    "db_value": clean(db.get("fund_name")),
                    "recommendation": "Likely inactive/old/out-of-scope for today's workbook; do not delete without lifecycle review.",
                }
            )
    return issues


def compare_aum(source: pd.DataFrame, db_funds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source_rows = by_key(source, "펀드코드")
    db_rows = {norm_id(row.get("fund_id")): row for row in db_funds if norm_id(row.get("fund_id"))}
    issues: list[dict[str, Any]] = []
    mappings = [
        ("equity_won", "Equity 총액(원)", "equity_won"),
        ("loan_won", "Loan 총액(원)", "loan_won"),
        ("deposit_won", "기준일자 임대보증금(원)", "deposit_won"),
        ("benchmark_aum", "AUM(원)", "benchmark_aum"),
        ("invested_equity_won", "Equity 총액(원).1", "invested_equity_won"),
        ("invested_loan_won", "Loan 총액(원).1", "invested_loan_won"),
        ("invested_deposit_won", "기준일자 임대보증금(원).1", "invested_deposit_won"),
        ("invested_aum", "AUM(원).1", "invested_aum"),
    ]
    for fund_id, src in source_rows.items():
        db = db_rows.get(fund_id)
        if not db:
            issues.append(
                {
                    "domain": "fund_aum",
                    "severity": "update_candidate",
                    "issue_type": "aum_source_fund_not_in_supabase",
                    "fund_id": fund_id,
                    "source_value": clean(src.get("펀드명")),
                    "db_value": "",
                    "recommendation": "AUM exists for a source fund missing in Supabase funds.",
                }
            )
            continue
        compare_text_field(
            issues,
            "fund_aum",
            "fund_id",
            fund_id,
            "aum_base_date",
            "기준일자",
            date_text(src.get("기준일자")),
            "aum_base_date",
            date_text(db.get("aum_base_date")),
        )
        for field, src_col, db_col in mappings:
            compare_numeric_field(issues, "fund_aum", fund_id, field, src_col, src.get(src_col), db_col, db.get(db_col))
    return issues


def compare_assets(source: pd.DataFrame, db_assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source_by_code = {}
    for _, row in source.iterrows():
        code = clean(row.get("자산코드"))
        if code:
            source_by_code[code] = row.to_dict()
    db_by_code = {clean(row.get("asset_code")): row for row in db_assets if clean(row.get("asset_code"))}
    issues: list[dict[str, Any]] = []
    mappings = [
        ("canonical_name", "자산(건물)명", "canonical_name", "text"),
        ("address_text", "전체주소(시/도, 구/군 포함)", "address_text", "text"),
        ("asset_type", "기초자산", "asset_type", "text"),
        ("business_stage", "사업단계", "business_stage", "text"),
        ("portfolio_region", "투자지역", "portfolio_region", "text"),
        ("country_code", "국내/해외", "country_code", "text"),
        ("gross_floor_area", "연면적(m²)", "gross_floor_area", "number"),
        ("site_area", "토지면적(㎡)", "site_area", "number"),
        ("completion_date", "준공(예정)일", "completion_date", "date"),
        ("parking", "주차대수", "parking", "text"),
    ]
    for code, src in source_by_code.items():
        db = db_by_code.get(code)
        if not db:
            issues.append(
                {
                    "domain": "asset_master",
                    "severity": "update_candidate",
                    "issue_type": "new_source_asset_code_not_in_supabase",
                    "asset_code": code,
                    "source_value": clean(src.get("자산(건물)명")),
                    "db_value": "",
                    "recommendation": "New asset-code candidate. Verify before inserting/merging.",
                }
            )
            continue
        for field, src_col, db_col, kind in mappings:
            src_val = src.get(src_col)
            db_val = db.get(db_col)
            if kind == "number":
                src_num = num(src_val)
                db_num = num(db_val)
                if src_num != db_num:
                    issues.append(
                        {
                            "domain": "asset_master",
                            "severity": "review",
                            "issue_type": "asset_field_change_candidate",
                            "asset_id": clean(db.get("asset_id")),
                            "asset_code": code,
                            "field": field,
                            "source_column": src_col,
                            "db_column": db_col,
                            "source_value": "" if src_num is None else src_num,
                            "db_value": "" if db_num is None else db_num,
                            "difference": "" if src_num is None or db_num is None else src_num - db_num,
                            "db_api_enrichment_status": clean(db.get("api_enrichment_status")),
                            "db_building_ledger_source": clean(db.get("building_ledger_source")),
                            "recommendation": "Physical fields may be API-enriched. Review provenance before overwriting.",
                        }
                    )
            else:
                src_text = date_text(src_val) if kind == "date" else clean(src_val)
                if field == "country_code":
                    src_text = country_code_from_source(src_val)
                db_text = date_text(db_val) if kind == "date" else clean(db_val)
                if src_text != db_text:
                    issues.append(
                        {
                            "domain": "asset_master",
                            "severity": "review",
                            "issue_type": "asset_field_change_candidate",
                            "asset_id": clean(db.get("asset_id")),
                            "asset_code": code,
                            "field": field,
                            "source_column": src_col,
                            "db_column": db_col,
                            "source_value": src_text,
                            "db_value": db_text,
                            "difference": "",
                            "db_api_enrichment_status": clean(db.get("api_enrichment_status")),
                            "db_building_ledger_source": clean(db.get("building_ledger_source")),
                            "recommendation": "Review. Some address/physical fields may intentionally differ after geocode/API cleanup.",
                        }
                    )
    return issues


def compare_fund_asset_pairs(source: pd.DataFrame, db_links: list[dict[str, Any]], db_assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    src_pairs = {}
    for _, row in source.iterrows():
        fund_id = norm_id(row.get("펀드코드"))
        asset_name = clean(row.get("자산(건물)명"))
        if valid_fund_id(fund_id) and asset_name:
            src_pairs[(fund_id, norm_name(asset_name))] = {
                "fund_id": fund_id,
                "asset_name": asset_name,
                "sequence": clean(row.get("순번")),
            }
    asset_by_id = {clean(row.get("asset_id")): row for row in db_assets if clean(row.get("asset_id"))}
    db_pairs = {}
    db_by_fund = defaultdict(list)
    for link in db_links:
        asset = asset_by_id.get(clean(link.get("asset_id")), {})
        fund_id = norm_id(link.get("fund_id"))
        asset_name = clean(asset.get("canonical_name"))
        if fund_id and asset_name:
            key = (fund_id, norm_name(asset_name))
            row = {
                "fund_id": fund_id,
                "asset_name": asset_name,
                "relation_type": clean(link.get("relation_type")),
                "asset_id": clean(link.get("asset_id")),
            }
            db_pairs[key] = row
            db_by_fund[fund_id].append(row)
    issues: list[dict[str, Any]] = []
    for key, src in src_pairs.items():
        if key not in db_pairs:
            fund_id, _ = key
            candidates = " | ".join(row["asset_name"] for row in db_by_fund.get(fund_id, [])[:10])
            issues.append(
                {
                    "domain": "fund_asset_link",
                    "severity": "review" if candidates else "update_candidate",
                    "issue_type": "source_pair_not_in_supabase_exact",
                    "fund_id": fund_id,
                    "source_asset_name": src["asset_name"],
                    "db_asset_candidates_for_fund": candidates,
                    "recommendation": "Check canonical merge/inferred link before deciding whether to update asset_fund_links.",
                }
            )
    for key, db in db_pairs.items():
        if key not in src_pairs:
            issues.append(
                {
                    "domain": "fund_asset_link",
                    "severity": "info",
                    "issue_type": "supabase_pair_not_in_today_source_exact",
                    "fund_id": db["fund_id"],
                    "asset_id": db["asset_id"],
                    "db_asset_name": db["asset_name"],
                    "relation_type": db["relation_type"],
                    "recommendation": "May be older, inferred, synthetic, or out-of-scope for today's active source export.",
                }
            )
    return issues


def aggregate_lender(frame: pd.DataFrame) -> dict[str, dict[str, int]]:
    result = defaultdict(lambda: {"rows": 0, "committed": 0, "drawn": 0, "remaining": 0})
    for _, row in frame.iterrows():
        fund_id = norm_id(row.get("펀드코드"))
        if not valid_fund_id(fund_id):
            continue
        result[fund_id]["rows"] += 1
        result[fund_id]["committed"] += num(row.get("대출약정금액(원)")) or 0
        result[fund_id]["drawn"] += num(row.get("대출인출금액(원)")) or 0
        result[fund_id]["remaining"] += num(row.get("대출잔여금액(원)")) or 0
    return dict(result)


def aggregate_beneficiary(frame: pd.DataFrame) -> dict[str, dict[str, int]]:
    result = defaultdict(lambda: {"rows": 0, "committed": 0, "invested": 0, "remaining": 0})
    for _, row in frame.iterrows():
        fund_id = norm_id(row.get("펀드코드"))
        if not valid_fund_id(fund_id):
            continue
        result[fund_id]["rows"] += 1
        result[fund_id]["committed"] += num(row.get("총약정금액")) or 0
        result[fund_id]["invested"] += num(row.get("투입금액")) or 0
        result[fund_id]["remaining"] += num(row.get("잔여약정금액")) or 0
    return dict(result)


def aggregate_db_exposure(rows: list[dict[str, Any]], kind: str) -> dict[str, dict[str, int]]:
    if kind == "lender":
        result = defaultdict(lambda: {"rows": 0, "committed": 0, "drawn": 0, "remaining": 0})
        for row in rows:
            fund_id = norm_id(row.get("fund_id"))
            if not fund_id:
                continue
            result[fund_id]["rows"] += 1
            result[fund_id]["committed"] += num(row.get("committed_amt")) or 0
            result[fund_id]["drawn"] += num(row.get("drawn_amt")) or 0
            result[fund_id]["remaining"] += num(row.get("remaining_amt")) or 0
        return dict(result)
    result = defaultdict(lambda: {"rows": 0, "committed": 0, "invested": 0, "remaining": 0})
    for row in rows:
        fund_id = norm_id(row.get("fund_id"))
        if not fund_id:
            continue
        result[fund_id]["rows"] += 1
        result[fund_id]["committed"] += num(row.get("committed_amt")) or 0
        result[fund_id]["invested"] += num(row.get("invested_amt")) or 0
        result[fund_id]["remaining"] += num(row.get("remaining_amt")) or 0
    return dict(result)


def compare_exposures(
    source_lender: pd.DataFrame,
    source_beneficiary: pd.DataFrame,
    db_lenders: list[dict[str, Any]],
    db_beneficiaries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    source_sets = {
        "lender": aggregate_lender(source_lender),
        "beneficiary": aggregate_beneficiary(source_beneficiary),
    }
    db_sets = {
        "lender": aggregate_db_exposure(db_lenders, "lender"),
        "beneficiary": aggregate_db_exposure(db_beneficiaries, "beneficiary"),
    }
    fields = {
        "lender": ["committed", "drawn", "remaining"],
        "beneficiary": ["committed", "invested", "remaining"],
    }
    issues: list[dict[str, Any]] = []
    for kind in ["lender", "beneficiary"]:
        source = source_sets[kind]
        db = db_sets[kind]
        for fund_id, src in source.items():
            target = db.get(fund_id)
            if not target:
                issues.append(
                    {
                        "domain": f"{kind}_exposure",
                        "severity": "update_candidate",
                        "issue_type": "source_fund_exposure_not_in_supabase",
                        "fund_id": fund_id,
                        "source_rows": src["rows"],
                        "db_rows": 0,
                        "recommendation": "Exposure for this fund exists in today's source but not in Supabase.",
                    }
                )
                continue
            for field in fields[kind]:
                if src[field] != target[field]:
                    issues.append(
                        {
                            "domain": f"{kind}_exposure",
                            "severity": "review",
                            "issue_type": "fund_exposure_sum_change_candidate",
                            "fund_id": fund_id,
                            "field": field,
                            "source_value": src[field],
                            "db_value": target[field],
                            "difference": src[field] - target[field],
                            "source_rows": src["rows"],
                            "db_rows": target["rows"],
                            "recommendation": "Review row-level exposure changes before replacing detail table.",
                        }
                    )
        for fund_id, target in db.items():
            if fund_id not in source:
                issues.append(
                    {
                        "domain": f"{kind}_exposure",
                        "severity": "info",
                        "issue_type": "supabase_exposure_not_in_today_source",
                        "fund_id": fund_id,
                        "source_rows": 0,
                        "db_rows": target["rows"],
                        "recommendation": "May be inactive/out-of-scope or removed from today's source export.",
                    }
                )
    return issues


def write_report(summary: dict[str, Any], issue_counts: Counter) -> None:
    lines = [
        "# 2026-06-08 DB Sources vs Supabase Update Candidate Report",
        "",
        f"- Generated at: {datetime.now().isoformat(timespec='seconds')}",
        f"- Source folder: `{SOURCE_DIR}`",
        f"- Output folder: `{OUT_DIR}`",
        "- Mode: read-only comparison. No Supabase write was performed.",
        "",
        "## Source Files",
        "",
    ]
    for key, info in summary["source_files"].items():
        lines.append(f"- `{key}`: `{info['file_name']}` ({info['rows']} rows, {info['columns']} columns)")
    lines.extend(["", "## Supabase Snapshot", ""])
    for table, count in summary["supabase_counts"].items():
        lines.append(f"- `{table}`: {count}")
    lines.extend(["", "## Issue Counts", ""])
    for (domain, issue_type, severity), count in issue_counts.most_common():
        lines.append(f"- `{domain}` / `{issue_type}` / `{severity}`: {count}")
    lines.extend(
        [
            "",
            "## Interpretation Guide",
            "",
            "- `update_candidate`: source has a row/value that is missing in Supabase and may require insert/update after review.",
            "- `review`: source and Supabase both have the entity, but values differ.",
            "- `info`: Supabase has rows not present in today's source. Do not delete without lifecycle/out-of-scope review.",
            "",
            "## Recommended Review Order",
            "",
            "1. `fund_aum_change_candidates.csv`: period-end AUM changes are likely legitimate if 2026-05-31 is the new base date.",
            "2. `fund_update_candidates.csv`: check new funds and fund master/status changes.",
            "3. `exposure_change_candidates.csv`: exposure totals changed; row-level review before replacing tables.",
            "4. `asset_update_candidates.csv`: physical/API fields require provenance review before overwriting.",
            "5. `fund_asset_pair_candidates.csv`: relationship changes may reflect canonical/inferred links rather than simple source errors.",
        ]
    )
    (OUT_DIR / "update_candidate_report.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    load_env()
    files = source_files()
    frames = {key: read_excel(path, header) for key, (path, header) in files.items()}

    db = {
        "funds": fetch_all("funds"),
        "asset_master": fetch_all("asset_master"),
        "asset_fund_links": fetch_all("asset_fund_links"),
        "lender_exposures": fetch_all("lender_exposures"),
        "beneficiary_exposures": fetch_all("beneficiary_exposures"),
        "asset_building_ledger": fetch_all("asset_building_ledger"),
    }

    write_csv(OUT_DIR / "source_workbook_inventory.csv", workbook_inventory(files, frames))

    fund_issues = compare_funds(frames["fund_master"], db["funds"])
    aum_issues = compare_aum(frames["fund_aum"], db["funds"])
    asset_issues = compare_assets(frames["asset_master_source"], db["asset_master"])
    fund_asset_issues = compare_fund_asset_pairs(frames["fund_asset_source"], db["asset_fund_links"], db["asset_master"])
    exposure_issues = compare_exposures(
        frames["lender_source"],
        frames["beneficiary_source"],
        db["lender_exposures"],
        db["beneficiary_exposures"],
    )

    write_csv(OUT_DIR / "fund_update_candidates.csv", fund_issues)
    write_csv(OUT_DIR / "fund_aum_change_candidates.csv", aum_issues)
    write_csv(OUT_DIR / "asset_update_candidates.csv", asset_issues)
    write_csv(OUT_DIR / "fund_asset_pair_candidates.csv", fund_asset_issues)
    write_csv(OUT_DIR / "exposure_change_candidates.csv", exposure_issues)

    all_issues = fund_issues + aum_issues + asset_issues + fund_asset_issues + exposure_issues
    write_csv(OUT_DIR / "all_update_candidates.csv", all_issues)

    summary = {
        "source_files": {
            key: {"file_name": path.name, "header": header, "rows": len(frames[key]), "columns": len(frames[key].columns)}
            for key, (path, header) in files.items()
        },
        "supabase_counts": {table: len(rows) for table, rows in db.items()},
        "issue_counts": dict(Counter(f"{row.get('domain')}|{row.get('issue_type')}|{row.get('severity')}" for row in all_issues)),
        "total_issues": len(all_issues),
    }
    (OUT_DIR / "update_candidate_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = Counter((row.get("domain", ""), row.get("issue_type", ""), row.get("severity", "")) for row in all_issues)
    write_report(summary, counts)
    print(json.dumps({"output_dir": str(OUT_DIR), "total_issues": len(all_issues), "issue_counts": summary["issue_counts"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
