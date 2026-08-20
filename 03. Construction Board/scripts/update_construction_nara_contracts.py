from __future__ import annotations

import argparse
import json
import re
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from update_construction_dart_awards import collect_target_companies, compact_text, company_aliases, normalize_company


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "03. Construction Board" / "data"
NARA_CACHE_OUT = OUTPUT_DIR / "construction_nara_contracts_cache.json"
ENV_PATH = ROOT / ".env"
KST = timezone(timedelta(hours=9))

SERVICE_URL = "https://apis.data.go.kr/1230000/ao/CntrctInfoService/getCntrctInfoListCnstwk"
SERVICE_PAGE_URL = "https://www.data.go.kr/data/15129427/openapi.do"
USER_AGENT = "RA-dashboard/0.1"

DATE_FIELDS = ["cntrctCnclsDate", "cntrctDate", "rgstDt", "contractDate", "cntrctCnclsDt"]
PROJECT_FIELDS = ["cnstwkNm", "cntrctNm", "contractName", "prdctClsfcNoNm", "ntceNm", "bidNtceNm"]
CLIENT_FIELDS = ["cntrctInsttNm", "dminsttList", "dminsttNm", "dminsttInsttNm", "orderInsttNm", "demandInsttNm"]
COMPANY_FIELDS = ["corpList", "crdtrNm", "corpNm", "cntrctCorpNm", "entrpsNm", "bcncNm", "supplierNm", "cntrctEntrpsNm"]
AMOUNT_FIELDS = ["cntrctAmt", "contractAmt", "fnlCntrctAmt", "totCntrctAmt"]
METHOD_FIELDS = ["cntrctCnclsMthdNm", "cntrctMthdNm", "contractMethod", "cntrctSeNm"]
URL_FIELDS = ["cntrctInfoUrl", "cntrctDtlInfoUrl", "linkUrl", "detailUrl", "bidNtceUrl"]


def read_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def pick_public_data_key() -> str:
    value = read_env(ENV_PATH).get("DATA_GO_KR_KEY", "").strip()
    if not value:
        raise RuntimeError("DATA_GO_KR_KEY not found in .env")
    return value


def parse_int(value: Any) -> int:
    text = re.sub(r"[^0-9-]", "", compact_text(value))
    return int(text) if text else 0


def first_value(row: dict[str, Any], fields: list[str]) -> str:
    for field in fields:
        value = compact_text(row.get(field))
        if value:
            return value
    return ""


def normalize_date(value: Any) -> str:
    text = compact_text(value)
    if re.fullmatch(r"\d{8}", text):
        return f"{text[:4]}.{text[4:6]}.{text[6:8]}"
    return text


def normalize_query_datetime(value: str, end: bool = False) -> str:
    text = re.sub(r"[^0-9]", "", compact_text(value))
    if len(text) == 8:
        return f"{text}{'2359' if end else '0000'}"
    if len(text) == 12:
        return text
    return text


def format_krw(value: Any) -> str:
    amount = parse_int(value)
    if not amount:
        return compact_text(value) or "-"
    eok = amount / 100_000_000
    if eok >= 10:
        return f"{eok:,.0f}억원"
    return f"{eok:,.2f}억원"


def unwrap_items(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    response = payload.get("response") or {}
    body = response.get("body") or payload.get("body") or {}
    items = body.get("items") or {}
    if isinstance(items, dict):
        item = items.get("item") or []
    else:
        item = items
    if isinstance(item, dict):
        rows = [item]
    elif isinstance(item, list):
        rows = [row for row in item if isinstance(row, dict)]
    else:
        rows = []
    total_count = parse_int(body.get("totalCount") or payload.get("totalCount"))
    return rows, total_count


def http_get_json(api_key: str, params: dict[str, str], timeout: int) -> dict[str, Any]:
    merged = {
        "serviceKey": api_key,
        "type": "json",
        **params,
    }
    url = f"{SERVICE_URL}?{urllib.parse.urlencode(merged, safe='%')}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {exc.code}: {body[:300]}")
    payload = json.loads(text)
    response_error = payload.get("nkoneps.com.response.ResponseError")
    if response_error:
        header = response_error.get("header") or {}
        raise RuntimeError(f"Nara/G2B result {header.get('resultCode')}: {header.get('resultMsg')}")
    header = (payload.get("response") or {}).get("header") or {}
    if header and header.get("resultCode") not in {"00", "03"}:
        raise RuntimeError(f"Nara/G2B result {header.get('resultCode')}: {header.get('resultMsg')}")
    return payload


def fetch_contract_rows(api_key: str, *, start_date: str, end_date: str, max_pages: int, rows_per_page: int, timeout: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        payload = http_get_json(
            api_key,
            {
                "pageNo": str(page),
                "numOfRows": str(rows_per_page),
                "inqryDiv": "1",
                "inqryBgnDt": normalize_query_datetime(start_date),
                "inqryEndDt": normalize_query_datetime(end_date, end=True),
            },
            timeout=timeout,
        )
        page_rows, total_count = unwrap_items(payload)
        rows.extend(page_rows)
        if not page_rows or len(rows) >= total_count:
            break
    return rows


def row_company_text(row: dict[str, Any]) -> str:
    values = [compact_text(row.get(field)) for field in COMPANY_FIELDS]
    if not any(values):
        values = [compact_text(value) for value in row.values() if isinstance(value, str)]
    return " ".join(values)


def row_matches_company(row: dict[str, Any], aliases: list[str]) -> bool:
    text = normalize_company(row_company_text(row))
    clean_aliases = []
    for alias in aliases:
        normalized = normalize_company(alias)
        if len(normalized) < 2 or normalized in {"주", "유", "재", "사", "건설", "엔지니어링"}:
            continue
        clean_aliases.append(normalized)
    return any(alias and alias in text for alias in clean_aliases)


def make_award(row: dict[str, Any]) -> dict[str, str]:
    return {
        "project": first_value(row, PROJECT_FIELDS) or "-",
        "client": first_value(row, CLIENT_FIELDS) or "-",
        "amount": format_krw(first_value(row, AMOUNT_FIELDS)),
        "category": first_value(row, METHOD_FIELDS) or "나라장터 공사계약",
        "date": normalize_date(first_value(row, DATE_FIELDS)),
        "source_name": "나라장터 계약정보",
        "source_url": first_value(row, URL_FIELDS) or SERVICE_PAGE_URL,
        "amount_krw": str(parse_int(first_value(row, AMOUNT_FIELDS)) or ""),
    }


def award_key(award: dict[str, str]) -> tuple[str, str, str]:
    return (normalize_company(award.get("project")), normalize_company(award.get("client")), compact_text(award.get("date")))


def parse_args() -> argparse.Namespace:
    today = datetime.now(KST)
    parser = argparse.ArgumentParser(description="Update recent construction contracts from Nara/G2B contract API.")
    parser.add_argument("--start-date", default=f"{today.year}0101", help="Query start date, YYYYMMDD.")
    parser.add_argument("--end-date", default=today.strftime("%Y%m%d"), help="Query end date, YYYYMMDD.")
    parser.add_argument("--per-company", type=int, default=5, help="Maximum contracts per company.")
    parser.add_argument("--max-pages", type=int, default=30, help="Maximum API pages to fetch before client-side filtering.")
    parser.add_argument("--rows-per-page", type=int, default=100, help="Rows per API page.")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout seconds.")
    parser.add_argument("--output", type=Path, default=NARA_CACHE_OUT, help="Output JSON cache path.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    targets = collect_target_companies()
    payload: dict[str, Any] = {
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST"),
        "source_note": "조달청_나라장터 계약정보서비스의 공사 계약현황 조회 결과를 회사명 기준으로 필터링해 생성하는 자동 캐시입니다.",
        "source_url": SERVICE_PAGE_URL,
        "query": {
            "start_date": args.start_date,
            "end_date": args.end_date,
            "per_company": args.per_company,
            "max_pages": args.max_pages,
            "rows_per_page": args.rows_per_page,
        },
        "status": "pending",
        "companies": [],
        "errors": [],
    }

    try:
        api_key = pick_public_data_key()
        rows = fetch_contract_rows(
            api_key,
            start_date=args.start_date,
            end_date=args.end_date,
            max_pages=args.max_pages,
            rows_per_page=args.rows_per_page,
            timeout=args.timeout,
        )
    except Exception as exc:
        payload["status"] = "blocked"
        payload["errors"].append(
            {
                "stage": "fetch",
                "error": f"{type(exc).__name__}: {exc}",
                "hint": "활용신청 승인 반영 후 다시 실행하거나, 포털에서 서비스별 인증키 권한을 확인하세요.",
            }
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Nara/G2B fetch blocked: {payload['errors'][0]['error']}")
        print(f"Wrote {args.output}")
        return

    companies: list[dict[str, Any]] = []
    for entry in targets:
        aliases = company_aliases(entry["company"], entry.get("aliases") or [])
        awards: list[dict[str, str]] = []
        seen: set[tuple[str, str, str]] = set()
        for row in rows:
            if not row_matches_company(row, aliases):
                continue
            award = make_award(row)
            key = award_key(award)
            if key in seen:
                continue
            awards.append(award)
            seen.add(key)
            if len(awards) >= args.per_company:
                break
        if awards:
            companies.append(
                {
                    "company": entry["company"],
                    "aliases": aliases,
                    "source_name": "나라장터 계약정보",
                    "source_url": SERVICE_PAGE_URL,
                    "awards": awards,
                }
            )

    payload.update(
        {
            "status": "ok",
            "rows_fetched": len(rows),
            "companies_collected": len(targets),
            "companies_with_awards": len(companies),
            "companies": companies,
        }
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Fetched {len(rows)} Nara/G2B contract rows; matched {len(companies)} companies.")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
