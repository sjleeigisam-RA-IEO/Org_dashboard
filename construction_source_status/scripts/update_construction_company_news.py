from __future__ import annotations

import argparse
import email.utils
import html
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from update_construction_dart_awards import collect_target_companies, compact_text, company_aliases, normalize_company


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "outputs"
NEWS_CACHE_OUT = OUTPUT_DIR / "construction_company_news_cache.json"
KST = timezone(timedelta(hours=9))

GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"
USER_AGENT = "RA-dashboard/0.1"

ARTICLE_CATEGORY_TERMS = {
    "award_contract": [
        "수주",
        "계약",
        "공사",
        "건설",
        "정비사업",
        "개발사업",
        "해외수주",
    ],
    "performance_management": [
        "실적",
        "매출",
        "영업이익",
        "재무",
        "경영",
    ],
    "group_investment": [
        "그룹",
        "계열사",
        "자회사",
        "지주",
        "합작",
        "JV",
        "출자",
        "투자",
    ],
    "new_business_expansion": [
        "신사업",
        "신규사업",
        "사업확장",
        "사업 확대",
        "사업 다각화",
        "해외사업",
        "인프라",
        "플랜트",
        "데이터센터",
        "물류센터",
        "스마트시티",
        "반도체",
        "바이오",
    ],
    "ma_restructuring": [
        "M&A",
        "인수",
        "합병",
        "매각",
        "분할",
        "재편",
    ],
    "capex_energy": [
        "설비투자",
        "시설투자",
        "증설",
        "에너지",
        "수소",
        "태양광",
        "풍력",
        "전력",
        "배터리",
    ],
    "risk_safety": [
        "안전",
        "품질",
        "중대재해",
        "리스크",
    ],
}
INCLUDE_TERMS = sorted({term for terms in ARTICLE_CATEGORY_TERMS.values() for term in terms})
QUERY_TERMS = [
    "수주",
    "계약",
    "실적",
    "경영",
    "공사",
    "건설",
    "정비사업",
    "투자",
    "계열사",
    "그룹",
    "신사업",
    "사업확장",
    "M&A",
    "인수",
    "합병",
    "설비투자",
    "데이터센터",
    "에너지",
    "인프라",
]
STRATEGY_CATEGORY_IDS = {
    "group_investment",
    "new_business_expansion",
    "ma_restructuring",
    "capex_energy",
}
SOFT_EXCLUDE_TERMS = ["주가", "특징주", "급등", "급락", "목표가", "증권가", "리포트"]
SOFT_EXCLUDE_OVERRIDE_TERMS = {
    "수주",
    "계약",
    "실적",
    "공사",
    "투자",
    "신사업",
    "사업확장",
    "M&A",
    "인수",
    "합병",
    "설비투자",
    "데이터센터",
    "에너지",
    "인프라",
}


def normalize_title(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]", "", compact_text(value).lower())


def format_published(value: str) -> str:
    text = compact_text(value)
    if not text:
        return ""
    try:
        dt = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return text
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(KST)
    return dt.strftime("%Y.%m.%d")


def clean_title(title: str, source: str) -> str:
    title = compact_text(html.unescape(title))
    source = compact_text(source)
    if source and title.endswith(f" - {source}"):
        title = title[: -len(source) - 3].strip()
    return title


def classify_article(title: str, summary: str) -> dict[str, Any]:
    text = f"{title} {summary}"
    lower_text = text.lower()
    categories: list[str] = []
    matched_terms: list[str] = []
    for category, terms in ARTICLE_CATEGORY_TERMS.items():
        hits = [term for term in terms if term.lower() in lower_text]
        if not hits:
            continue
        categories.append(category)
        for term in hits:
            if term not in matched_terms:
                matched_terms.append(term)
    return {
        "categories": categories,
        "matched_terms": matched_terms,
        "primary_category": categories[0] if categories else "",
        "direction_signal": any(category in STRATEGY_CATEGORY_IDS for category in categories),
    }


def article_passes_filter(company_aliases: list[str], title: str, summary: str) -> bool:
    text = f"{title} {summary}"
    normalized_text = normalize_company(text)
    alias_hit = any(normalize_company(alias) and normalize_company(alias) in normalized_text for alias in company_aliases)
    if not alias_hit:
        return False
    classification = classify_article(title, summary)
    if not classification["matched_terms"]:
        return False
    if any(term in text for term in SOFT_EXCLUDE_TERMS) and not any(term in text for term in SOFT_EXCLUDE_OVERRIDE_TERMS):
        return False
    return True


def google_query_term(term: str) -> str:
    return f'"{term}"' if re.search(r"\s|&", term) else term


def fetch_news(company: str, aliases: list[str], *, days: int, limit: int, timeout: int) -> list[dict[str, Any]]:
    query_aliases: list[str] = []
    seen_aliases: set[str] = set()
    for alias in aliases:
        normalized = normalize_company(alias)
        if len(normalized) < 2 or normalized in {"주", "유", "재", "사"} or normalized in seen_aliases:
            continue
        query_aliases.append(alias)
        seen_aliases.add(normalized)
        if len(query_aliases) >= 3:
            break
    if not query_aliases:
        query_aliases = [company]
    alias_query = " OR ".join(f'"{alias}"' for alias in query_aliases)
    term_query = " OR ".join(google_query_term(term) for term in QUERY_TERMS)
    query = f"({alias_query}) ({term_query}) when:{days}d"
    params = {
        "q": query,
        "hl": "ko",
        "gl": "KR",
        "ceid": "KR:ko",
    }
    url = f"{GOOGLE_NEWS_RSS}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()

    root = ElementTree.fromstring(body)
    articles: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in root.findall(".//item"):
        source_node = item.find("source")
        source = compact_text(source_node.text if source_node is not None else "")
        title = clean_title(item.findtext("title") or "", source)
        link = compact_text(item.findtext("link") or "")
        summary = compact_text(re.sub(r"<[^>]+>", " ", html.unescape(item.findtext("description") or "")))
        if not article_passes_filter(aliases, title, summary):
            continue
        classification = classify_article(title, summary)
        key = normalize_title(title)
        if not key or key in seen:
            continue
        seen.add(key)
        articles.append(
            {
                "title": title,
                "url": link,
                "source": source,
                "published": format_published(item.findtext("pubDate") or ""),
                "summary": summary[:180],
                "primary_category": classification["primary_category"],
                "categories": classification["categories"],
                "matched_terms": classification["matched_terms"],
                "direction_signal": classification["direction_signal"],
            }
        )
        if len(articles) >= limit:
            break
    return articles


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update company-level construction news cache.")
    parser.add_argument("--days", type=int, default=365, help="Google News recency window.")
    parser.add_argument("--per-company", type=int, default=5, help="Maximum articles per company.")
    parser.add_argument("--company-limit", type=int, default=0, help="Limit companies for testing. 0 means all.")
    parser.add_argument("--delay", type=float, default=0.08, help="Delay between RSS requests.")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout seconds.")
    parser.add_argument("--output", type=Path, default=NEWS_CACHE_OUT, help="Output JSON cache path.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    targets = collect_target_companies()
    if args.company_limit > 0:
        targets = targets[: args.company_limit]

    companies: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for index, entry in enumerate(targets, start=1):
        aliases = company_aliases(entry["company"], entry.get("aliases") or [])
        try:
            articles = fetch_news(entry["company"], aliases, days=args.days, limit=args.per_company, timeout=args.timeout)
            print(f"[{index}/{len(targets)}] {entry['company']} -> {len(articles)} articles")
        except Exception as exc:
            articles = []
            errors.append({"company": entry["company"], "error": f"{type(exc).__name__}: {exc}"})
            print(f"[{index}/{len(targets)}] {entry['company']} -> error: {type(exc).__name__}")

        companies.append(
            {
                "company": entry["company"],
                "aliases": aliases,
                "source_name": "Google News",
                "source_url": "https://news.google.com/",
                "articles": articles[: args.per_company],
            }
        )
        if args.delay:
            time.sleep(args.delay)

    payload = {
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST"),
        "source_note": "회사명과 수주/계약/실적/경영 및 투자/계열사/신사업/확장/M&A/설비투자/데이터센터/에너지/인프라 관련 키워드로 Google News RSS를 조회해 생성한 기사 캐시입니다. 주가성 단신은 가능한 제외했습니다.",
        "query": {
            "days": args.days,
            "per_company": args.per_company,
            "query_terms": QUERY_TERMS,
            "article_categories": ARTICLE_CATEGORY_TERMS,
            "soft_exclude_terms": SOFT_EXCLUDE_TERMS,
        },
        "companies_collected": len(targets),
        "companies_with_articles": sum(1 for company in companies if company.get("articles")),
        "errors": errors,
        "companies": companies,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
