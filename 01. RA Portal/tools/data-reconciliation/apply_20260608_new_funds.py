from __future__ import annotations

import argparse
import json
import math
import os
import re
import urllib.parse
import urllib.request
from urllib.error import HTTPError
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "00. Raw Data"
OUT_DIR = ROOT / "01. RA Portal" / "output" / "reconciliation_20260608_apply"
RUN_DATE = "20260608"
LOAD_DATE = "2026-06-08"


def clean(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).replace("\xa0", " ").strip()
    if not text or text.lower() in {"nan", "none", "null", "undefined"} or text == "-":
        return None
    return re.sub(r"\s+", " ", text)


def norm_id(value: Any) -> str | None:
    text = clean(value)
    if not text:
        return None
    if re.fullmatch(r"\d+\.0", text):
        text = text[:-2]
    return text


def valid_fund_id(value: Any) -> bool:
    text = norm_id(value) or ""
    return bool(re.fullmatch(r"\d{6}", text) or re.fullmatch(r"[A-Z]\d{5}", text))


def clean_int(value: Any) -> int | None:
    text = clean(value)
    if not text:
        return None
    text = text.replace(",", "")
    try:
        return int(round(float(text)))
    except ValueError:
        return None


def clean_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = clean(value)
    if not text:
        return None
    text = text[:10]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    if re.fullmatch(r"\d{8}", text):
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    return None


def clean_bool(value: Any) -> bool | None:
    text = clean(value)
    if text is None:
        return None
    upper = text.upper()
    if upper in {"Y", "YES", "TRUE", "1", "O"} or text == "예":
        return True
    if upper in {"N", "NO", "FALSE", "0", "X"} or text == "아니오":
        return False
    return None


def load_env() -> None:
    env_path = ROOT / ".env"
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def request_json(
    path: str,
    params: dict[str, str] | None = None,
    method: str = "GET",
    rows: list[dict[str, Any]] | None = None,
    range_header: str | None = None,
) -> list[dict[str, Any]]:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    query = urllib.parse.urlencode(params or {}, safe="*,.:()")
    target = f"{url}/rest/v1/{path}" + (f"?{query}" if query else "")
    data = None if rows is None else json.dumps(rows, ensure_ascii=False).encode("utf-8")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    if range_header:
        headers["Range"] = range_header
    req = urllib.request.Request(target, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase {method} {path} failed: HTTP {exc.code} {detail}") from exc
    return json.loads(body or "[]")


def fetch_all(table: str, select: str = "*") -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    size = 1000
    while True:
        batch = request_json(table, {"select": select}, "GET", range_header=f"{start}-{start + size - 1}")
        rows.extend(batch)
        if len(batch) < size:
            return rows
        start += size


def find_source(name_contains: str) -> Path:
    matches = sorted(p for p in SOURCE_DIR.glob(f"*{RUN_DATE}*.xlsx") if name_contains in p.name and not p.name.startswith("~$"))
    if not matches:
        raise FileNotFoundError(f"No source workbook matching {name_contains} and {RUN_DATE}")
    return matches[0]


def read_sources() -> tuple[pd.DataFrame, pd.DataFrame, Path, Path]:
    fund_path = find_source("펀드 관리")
    aum_path = find_source("펀드 AUM")
    funds = pd.read_excel(fund_path, header=0, dtype=object)
    aum = pd.read_excel(aum_path, header=1, dtype=object)
    funds.columns = [str(col).strip() for col in funds.columns]
    aum.columns = [str(col).strip() for col in aum.columns]
    return funds.dropna(how="all"), aum.dropna(how="all"), fund_path, aum_path


def first_by_fund_id(frame: pd.DataFrame) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for _, row in frame.iterrows():
        fund_id = norm_id(row.get("펀드코드"))
        if fund_id and valid_fund_id(fund_id) and fund_id not in result:
            result[fund_id] = row.to_dict()
    return result


def build_payload(src: dict[str, Any], aum: dict[str, Any] | None, fund_source: Path, aum_source: Path | None) -> dict[str, Any]:
    fund_id = norm_id(src.get("펀드코드"))
    if not fund_id:
        raise ValueError("Missing fund_id")

    payload: dict[str, Any] = {
        "fund_id": fund_id,
        "short_name": clean(src.get("약칭")),
        "fund_name": clean(src.get("펀드명")),
        "sector": clean(src.get("투자섹터")),
        "asset_name": clean(src.get("자산명")),
        "status": clean(src.get("운용상태")),
        "location": clean(src.get("국내/해외")),
        "setup_date": clean_date(src.get("최초 설정일")) or clean_date(src.get("설립일")),
        "maturity_date": clean_date(src.get("만기일")),
        "termination_date": clean_date(src.get("해지일")),
        "dept": clean(src.get("부서(운용)")) or clean(src.get("담당부서(투자)")),
        "manager": clean(src.get("담당자(운용)")) or clean(src.get("담당자(투자)")),
        "parent_fund_id": None,
        "project_mission_name": clean(src.get("자산명")),
        "notion_holding_type_class": clean(src.get("모자구분")),
        "notion_investment_strategy_class": clean(src.get("투자전략")),
        "notion_vehicle_class": clean(src.get("Vehicle구분")),
        "recruitment_type": clean(src.get("모집형태")),
        "legal_form": clean(src.get("법적형태")),
        "fund_class": clean(src.get("펀드분류")),
        "fund_type": clean(src.get("펀드유형")),
        "division": clean(src.get("담당부문(운용)")),
        "primary_region": clean(src.get("주요투자지역")),
        "is_development": clean_bool(src.get("개발여부")),
        "is_delegated": clean_bool(src.get("위탁운용여부")),
        "metadata": {
            "source_file": fund_source.name,
            "source_system": "00. Raw Data",
            "load_date": LOAD_DATE,
            "insert_reason": "20260608 신규 fund source row",
        },
    }

    if aum:
        payload.update(
            {
                "aum_base_date": clean_date(aum.get("기준일자")),
                "base_price": clean_int(aum.get("기준가")),
                "net_asset_value": clean_int(aum.get("순자산총액")),
                "aum_input_date": clean_date(aum.get("AUM\n입력일자")),
                "equity_won": clean_int(aum.get("Equity 총액(원)")),
                "loan_won": clean_int(aum.get("Loan 총액(원)")),
                "deposit_won": clean_int(aum.get("기준일자 임대보증금(원)")),
                "benchmark_aum": clean_int(aum.get("AUM(원)")),
                "invested_equity_won": clean_int(aum.get("Equity 총액(원).1")),
                "invested_loan_won": clean_int(aum.get("Loan 총액(원).1")),
                "invested_deposit_won": clean_int(aum.get("기준일자 임대보증금(원).1")),
                "invested_aum": clean_int(aum.get("AUM(원).1")),
                "aum_status": clean(aum.get("운용상태")),
                "aum_source": aum_source.name if aum_source else None,
            }
        )
        payload["metadata"]["aum_source_file"] = aum_source.name if aum_source else None

    return {key: value for key, value in payload.items() if value is not None}


def write_plan(rows: list[dict[str, Any]]) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / "new_funds_upsert_payload.json"
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def rectangularize(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    keys: list[str] = []
    for row in rows:
        for key in row:
            if key not in keys:
                keys.append(key)
    return [{key: row.get(key) for key in keys} for row in rows]


def main() -> None:
    parser = argparse.ArgumentParser(description="Insert 20260608 new funds only, with matching AUM fields when present.")
    parser.add_argument("--apply", action="store_true", help="Apply the upsert to Supabase. Without this, writes only a payload preview.")
    args = parser.parse_args()

    load_env()
    funds_df, aum_df, fund_path, aum_path = read_sources()
    fund_rows = first_by_fund_id(funds_df)
    aum_rows = first_by_fund_id(aum_df)
    existing = {norm_id(row.get("fund_id")) for row in fetch_all("funds", "fund_id")}

    payloads = [
        build_payload(src, aum_rows.get(fund_id), fund_path, aum_path if fund_id in aum_rows else None)
        for fund_id, src in sorted(fund_rows.items())
        if fund_id not in existing
    ]

    plan_path = write_plan(payloads)
    print(json.dumps({
        "payload_count": len(payloads),
        "with_aum": sum(1 for row in payloads if row.get("aum_base_date")),
        "payload_path": str(plan_path),
        "fund_ids": [row["fund_id"] for row in payloads],
        "apply": args.apply,
    }, ensure_ascii=False, indent=2))

    if not args.apply or not payloads:
        return

    inserted = request_json("funds", {"on_conflict": "fund_id"}, "POST", rectangularize(payloads))
    verify_ids = ",".join(row["fund_id"] for row in payloads)
    verified = request_json(
        "v_funds_enriched",
        {
            "select": "fund_id,fund_name,short_name,status,benchmark_aum,aum_base_date",
            "fund_id": f"in.({verify_ids})",
        },
        "GET",
    )
    verify_path = OUT_DIR / "new_funds_upsert_verify.json"
    verify_path.write_text(json.dumps(verified, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "upsert_returned": len(inserted),
        "verify_count": len(verified),
        "verify_path": str(verify_path),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
