from __future__ import annotations

import argparse
import json
import re
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from update_construction_dart_awards import (
    DART_VIEWER_URL,
    LIST_URL,
    CorpMatch,
    add_unique,
    build_corp_index,
    collect_target_companies,
    compact_text,
    company_aliases,
    document_rows,
    download_corp_code,
    fetch_document_text,
    format_report_date,
    http_get_json,
    lookback_start_date,
    match_company,
    parse_corp_codes,
    pick_dart_key,
    strip_document_text,
    validate_key,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "outputs"
DART_STRATEGY_CACHE_OUT = OUTPUT_DIR / "construction_dart_strategy_cache.json"
KST = timezone(timedelta(hours=9))

STRATEGY_REPORT_KEYWORDS = [
    "투자판단관련주요경영사항",
    "타법인주식및출자증권취득결정",
    "타법인주식및출자증권처분결정",
    "신규시설투자등",
    "유형자산취득결정",
    "유형자산처분결정",
    "영업양수결정",
    "영업양도결정",
    "회사합병결정",
    "회사분할결정",
    "유상증자결정",
    "전환사채권발행결정",
    "신주인수권부사채권발행결정",
    "특수관계인에대한출자",
    "특수관계인에대한자금대여",
    "특수관계인으로부터부동산매수",
    "특수관계인에대한담보제공",
]

CATEGORY_RULES = [
    ("investment_decision", "투자판단", ["투자판단"]),
    ("equity_investment", "출자/지분", ["타법인주식", "출자증권", "출자"]),
    ("asset_capex", "설비/자산투자", ["신규시설투자", "유형자산취득", "유형자산처분"]),
    ("ma_restructuring", "M&A/구조개편", ["합병", "분할", "영업양수", "영업양도"]),
    ("financing", "자금조달", ["유상증자", "전환사채", "신주인수권부사채"]),
    ("group_transaction", "그룹/계열거래", ["특수관계인"]),
]

INTERESTING_LABEL_TERMS = [
    "제목",
    "주요내용",
    "기타 투자판단",
    "이사회결의일",
    "사실확인일",
    "공사개요",
    "공사금액",
    "선정일자",
    "투자구분",
    "투자대상",
    "투자내용",
    "투자금액",
    "투자목적",
    "투자기간",
    "투자지역",
    "취득목적",
    "취득금액",
    "취득예정일자",
    "취득방법",
    "처분목적",
    "처분금액",
    "거래상대방",
    "상대회사",
    "회사명",
    "결정내용",
    "합병목적",
    "분할목적",
    "양수ㆍ도 목적",
    "양수목적",
    "양도목적",
    "자금조달의 목적",
    "시설자금",
    "운영자금",
    "타법인 증권 취득자금",
    "내부거래 목적",
    "사업내용",
    "주요사업",
]

TITLE_LABEL_HINTS = [
    "제목",
    "투자대상",
    "투자내용",
    "투자목적",
    "취득목적",
    "처분목적",
    "상대회사",
    "거래상대방",
    "회사명",
    "합병목적",
    "분할목적",
    "사업내용",
    "주요내용",
]


def clean_report_name(value: str) -> str:
    text = compact_text(value)
    text = re.sub(r"^\[[^\]]+\]\s*", "", text)
    return text


def report_date_key(report: dict[str, Any]) -> str:
    return compact_text(report.get("rcept_dt"))


def is_strategy_report(report_name: str) -> bool:
    text = clean_report_name(report_name)
    if "해지" in text or "철회" in text:
        return False
    return any(keyword in text for keyword in STRATEGY_REPORT_KEYWORDS)


def strategy_category(report_name: str) -> tuple[str, str]:
    text = clean_report_name(report_name)
    for key, label, hints in CATEGORY_RULES:
        if any(hint in text for hint in hints):
            return key, label
    return "dart_strategy", "전략공시"


def list_strategy_reports(api_key: str, corp_code: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
    params = {
        "crtfc_key": api_key,
        "corp_code": corp_code,
        "bgn_de": start_date,
        "end_de": end_date,
        "page_no": "1",
        "page_count": "100",
    }
    first = http_get_json(LIST_URL, params, timeout=60)
    if first.get("status") == "013":
        return []
    if first.get("status") != "000":
        raise RuntimeError(f"DART list status {first.get('status')}: {first.get('message')}")

    reports: list[dict[str, Any]] = []
    total_pages = int(first.get("total_page") or 1)
    for page in range(1, total_pages + 1):
        data = first
        if page > 1:
            params["page_no"] = str(page)
            data = http_get_json(LIST_URL, params, timeout=60)
        reports.extend(report for report in data.get("list", []) if is_strategy_report(report.get("report_nm", "")))
    return reports


def clean_label(value: str) -> str:
    text = re.sub(r"^\d+\.\s*", "", compact_text(value))
    text = re.sub(r"\s+", "", text)
    return text.rstrip(":：")


def extract_strategy_fields(document_text: str, *, limit: int = 6) -> list[dict[str, str]]:
    fields: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for cells in document_rows(document_text):
        for index, cell in enumerate(cells[:-1]):
            label = clean_label(cell)
            value = compact_text(cells[index + 1])
            if not label or not value or len(value) < 2:
                continue
            if not any(term.replace(" ", "") in label for term in INTERESTING_LABEL_TERMS):
                continue
            key = (label, value)
            if key in seen:
                continue
            fields.append({"label": label, "value": value})
            seen.add(key)
            if len(fields) >= limit:
                return fields
    return fields


def select_title_hint(fields: list[dict[str, str]]) -> str:
    for hint in TITLE_LABEL_HINTS:
        normalized_hint = hint.replace(" ", "")
        for field in fields:
            if normalized_hint in field["label"]:
                return field["value"]
    return fields[0]["value"] if fields else ""


def summarize_fields(fields: list[dict[str, str]], document_text: str) -> str:
    if fields:
        parts = []
        for field in fields[:4]:
            value = field["value"]
            if len(value) > 72:
                value = value[:69].rstrip() + "..."
            parts.append(f"{field['label']}: {value}")
        return " · ".join(parts)

    fallback = strip_document_text(document_text)
    fallback = re.sub(r"\.xforms\b.*?(?=\d+\.\s*[가-힣A-Za-z]|$)", " ", fallback, flags=re.S)
    fallback = re.sub(r"\{[^{}]*\}", " ", fallback)
    fallback = compact_text(fallback)
    return fallback[:180].rstrip()


def normalize_title(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", compact_text(value).lower())


def make_strategy_article(report: dict[str, Any], document_text: str) -> dict[str, Any]:
    report_name = clean_report_name(compact_text(report.get("report_nm")))
    receipt_no = compact_text(report.get("rcept_no"))
    category_key, _category_label = strategy_category(report_name)
    fields = extract_strategy_fields(document_text)
    hint = select_title_hint(fields)
    title = report_name
    if hint:
        brief = hint[:54].rstrip() + ("..." if len(hint) > 54 else "")
        title = brief
    return {
        "title": title,
        "url": f"{DART_VIEWER_URL}{receipt_no}" if receipt_no else "https://opendart.fss.or.kr/",
        "source": "OpenDART 전략공시",
        "published": format_report_date(compact_text(report.get("rcept_dt"))),
        "summary": summarize_fields(fields, document_text),
        "primary_category": category_key,
        "categories": ["dart_strategy", category_key],
        "matched_terms": [keyword for keyword in STRATEGY_REPORT_KEYWORDS if keyword in report_name],
        "direction_signal": True,
        "receipt_no": receipt_no,
        "report_name": report_name,
    }


def fetch_company_strategy(
    api_key: str,
    match: CorpMatch,
    *,
    start_date: str,
    end_date: str,
    per_company: int,
    delay: float,
) -> list[dict[str, Any]]:
    reports = list_strategy_reports(api_key, match.corp_code, start_date, end_date)
    articles: list[dict[str, Any]] = []
    seen: set[str] = set()
    for report in sorted(reports, key=report_date_key, reverse=True):
        receipt_no = compact_text(report.get("rcept_no"))
        if not receipt_no:
            continue
        try:
            document_text = fetch_document_text(api_key, receipt_no)
        except Exception:
            document_text = ""
        article = make_strategy_article(report, document_text)
        key = normalize_title(article["title"]) or receipt_no
        if key in seen:
            continue
        articles.append(article)
        seen.add(key)
        if len(articles) >= per_company:
            break
        if delay:
            time.sleep(delay)
    return articles


def parse_args() -> argparse.Namespace:
    today = datetime.now(KST)
    parser = argparse.ArgumentParser(description="Update company-level strategy and investment signals from OpenDART.")
    parser.add_argument("--start-date", default="", help="DART query start date, YYYYMMDD. Default: today minus --lookback-years.")
    parser.add_argument("--end-date", default=today.strftime("%Y%m%d"), help="DART query end date, YYYYMMDD. Default: today.")
    parser.add_argument("--lookback-years", type=int, default=5, help="Default lookback window when --start-date is omitted.")
    parser.add_argument("--per-company", type=int, default=5, help="Maximum strategy disclosures per company.")
    parser.add_argument("--company-limit", type=int, default=0, help="Limit matched companies for testing. 0 means no limit.")
    parser.add_argument("--delay", type=float, default=0.04, help="Delay between document API calls.")
    parser.add_argument("--refresh-corp-code", action="store_true", help="Download fresh OpenDART corpCode.xml.")
    parser.add_argument("--output", type=Path, default=DART_STRATEGY_CACHE_OUT, help="Output JSON cache path.")
    args = parser.parse_args()
    if args.lookback_years < 1:
        raise ValueError("--lookback-years must be at least 1.")
    if not args.start_date:
        args.start_date = lookback_start_date(today, args.lookback_years)
    return args


def main() -> None:
    args = parse_args()
    env_file, key_name, api_key = pick_dart_key()
    validation = validate_key(api_key)
    if validation.get("status") != "000":
        raise RuntimeError(f"OpenDART key validation failed: {validation.get('status')} {validation.get('message')}")
    print(f"OpenDART key validated from {env_file}:{key_name}.")

    corp_xml = download_corp_code(api_key, refresh=args.refresh_corp_code)
    corp_rows = parse_corp_codes(corp_xml)
    corp_index = build_corp_index(corp_rows)
    targets = collect_target_companies()

    matched: list[tuple[dict[str, Any], CorpMatch]] = []
    unmatched: list[dict[str, Any]] = []
    for entry in targets:
        match = match_company(entry, corp_index)
        if match:
            matched.append((entry, match))
        else:
            unmatched.append({"company": entry["company"], "sources": entry.get("sources", [])})

    if args.company_limit > 0:
        matched = matched[: args.company_limit]

    print(f"Collected {len(targets)} companies, matched {len(matched)} to OpenDART corp codes.")

    companies: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for index, (entry, match) in enumerate(matched, start=1):
        try:
            articles = fetch_company_strategy(
                api_key,
                match,
                start_date=args.start_date,
                end_date=args.end_date,
                per_company=args.per_company,
                delay=args.delay,
            )
            print(f"[{index}/{len(matched)}] {entry['company']} -> {len(articles)} DART strategy disclosures")
        except Exception as exc:
            errors.append({"company": entry["company"], "error": f"{type(exc).__name__}: {exc}"})
            print(f"[{index}/{len(matched)}] {entry['company']} -> error: {type(exc).__name__}")
            continue

        if not articles:
            continue
        aliases = company_aliases(entry["company"], entry.get("aliases") or [])
        add_unique(aliases, match.corp_name)
        companies.append(
            {
                "company": entry["company"],
                "aliases": aliases,
                "source_name": "OpenDART 전략공시",
                "source_url": "https://opendart.fss.or.kr/",
                "dart": {
                    "corp_code": match.corp_code,
                    "corp_name": match.corp_name,
                    "corp_eng_name": match.corp_eng_name,
                    "stock_code": match.stock_code,
                    "match_score": round(match.score, 4),
                    "match_method": match.method,
                    "alias_used": match.alias_used,
                },
                "articles": articles,
            }
        )

    payload = {
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST"),
        "source_note": "OpenDART API에서 회사별 투자판단, 출자, 시설투자, M&A/구조개편, 자금조달, 특수관계인 거래성 공시를 조회해 생성한 기업 방향성 캐시입니다.",
        "query": {
            "start_date": args.start_date,
            "end_date": args.end_date,
            "lookback_years": args.lookback_years,
            "per_company": args.per_company,
            "report_keywords": STRATEGY_REPORT_KEYWORDS,
            "key_source": f"{env_file}:{key_name}",
        },
        "companies_collected": len(targets),
        "companies_matched": len(matched),
        "companies_with_strategy_disclosures": len(companies),
        "unmatched_companies": unmatched,
        "errors": errors,
        "companies": companies,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
