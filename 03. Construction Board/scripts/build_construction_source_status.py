from __future__ import annotations

import html
import io
import json
import re
import ssl
import urllib.parse
import urllib.request
import http.cookiejar
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import pandas as pd
import pdfplumber


HERE = Path(__file__).resolve()
ROOT = HERE.parents[1]
if HERE.parent.name == "scripts" and HERE.parent.parent.name == "03. Construction Board":
    ROOT = HERE.parents[2]
OUTPUT_DIR = ROOT / "03. Construction Board" / "data"
HTML_OUT = ROOT / "03. Construction Board" / "index.html"
JSON_OUT = OUTPUT_DIR / "construction_source_status_data.json"
SOURCE_MAP_PATH = ROOT / "03. Construction Board" / "data" / "construction_company_source_map.json"
PDF_COMMENTS_PATH = ROOT / "03. Construction Board" / "data" / "construction_pdf_comments.json"
PUBLIC_CONFIG_PATH = ROOT / "01. RA Portal" / "portfolio-analysis" / "config.js"
AWARDS_CACHE_OUT = OUTPUT_DIR / "construction_awards_cache.json"
DART_AWARDS_CACHE_OUT = OUTPUT_DIR / "construction_dart_awards_cache.json"
NARA_CONTRACTS_CACHE_OUT = OUTPUT_DIR / "construction_nara_contracts_cache.json"
NEWS_CACHE_OUT = OUTPUT_DIR / "construction_company_news_cache.json"
DART_STRATEGY_CACHE_OUT = OUTPUT_DIR / "construction_dart_strategy_cache.json"
CREDIT_RATINGS_CACHE_OUT = OUTPUT_DIR / "construction_credit_ratings_cache.json"
ONLINE_UPDATE_MARKS_OUT = OUTPUT_DIR / "construction_online_update_marks.json"
MARKET_INDICATORS_CACHE_OUT = OUTPUT_DIR / "construction_market_indicators_cache.json"
DEFAULT_COMMENT_AUTHOR = "개발솔루션센터 센터장"

AREA_UNIT_UNSUITABLE_KEYWORDS = {
    "도로",
    "철도",
    "전철",
    "지하철",
    "gtx",
    "터널",
    "교량",
    "하천",
    "발전",
    "태양광",
    "보일러",
    "플랜트",
    "송전",
    "상수도",
    "하수",
    "폐기물",
}

GENERIC_COMPANY_LOOKUP_KEYS = {
    "주",
    "주식회사",
    "회사",
    "건설",
    "엔지니어링",
    "건축사사무소",
    "종합건축사사무소",
    "씨엠",
    "cm",
    "토건",
}

MARKET_UNIT_COST_REFERENCES = [
    {
        "name": "KOSIS 건설공사비지수",
        "role": "과거 단가 보정",
        "status": "지수",
        "update_cycle": "월간 확인",
        "url": "https://kosis.kr/serviceInfo/newContrainDataDetail.do?boardIdx=2004001&boardOrgId=397",
        "description": "확인된 과거 프로젝트 단가를 현재 기준으로 보정할 때 쓰는 공사비 상승률 기준입니다.",
    },
    {
        "name": "국토교통부 기본형건축비",
        "role": "공동주택 기준선",
        "status": "고시",
        "update_cycle": "고시 확인",
        "url": "https://www.molit.go.kr/USR/I0204/m_45/dtl.jsp?idx=18905",
        "description": "공동주택 공사비를 볼 때 시장 기준선으로 함께 비교할 수 있는 공공 고시입니다.",
    },
    {
        "name": "조달청 공사비정보광장",
        "role": "공공공사 유형별 단가",
        "status": "참조",
        "update_cycle": "분기/수시 확인",
        "url": "https://pcae.g2b.go.kr",
        "description": "공공 건축물의 유형별 공사비 수준을 회사별 실측 단가와 비교하는 참조값으로 씁니다.",
    },
    {
        "name": "서울시 공사비 책정 가이드라인",
        "role": "공공건축 예산 기준",
        "status": "참조",
        "update_cycle": "연간 확인",
        "url": "https://news.seoul.go.kr/citybuild/technical/construction_cost_estimation_guidelines",
        "description": "서울시 공공건축 예산 검토용 기준으로, 용도별 기준 단가 비교에 적합합니다.",
    },
    {
        "name": "건축HUB 건축인허가정보",
        "role": "연면적 보강",
        "status": "API 후보",
        "update_cycle": "수주건별 조회",
        "url": "https://www.data.go.kr/catalog/15136267/openapi.json",
        "description": "DART나 기사에는 없는 연면적을 프로젝트명/위치와 조합해 보강하는 후보 API입니다.",
    },
]

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
KST = timezone(timedelta(hours=9))

ARTICLE_TOPIC_STOPWORDS = {
    "주식회사",
    "회사명",
    "제목",
    "주요내용",
    "단독",
    "종합",
    "속보",
    "공시",
    "전략공시",
    "투자판단",
    "그룹",
    "계열거래",
    "관련",
    "선정일자",
    "예상",
    "이사회결의일",
    "또는",
    "사실확인일",
}
ARTICLE_EVENT_TERMS = (
    "재건축",
    "재개발",
    "정비사업",
    "시공사",
    "우선협상대상자",
    "수주",
    "계약",
    "낙찰",
    "선정",
    "투자",
    "출자",
    "시설투자",
    "인수",
    "합병",
)
ARTICLE_PROJECT_SUFFIXES = (
    "재건축정비사업",
    "재개발정비사업",
    "도시정비사업",
    "정비사업",
    "아파트",
    "복합개발사업",
    "개발사업",
    "건설공사",
    "공사",
    "사업",
)


@dataclass
class FetchResult:
    ok: bool
    data: Any = None
    error: str | None = None


def request(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None) -> urllib.request.Request:
    merged = {"User-Agent": USER_AGENT}
    if headers:
        merged.update(headers)
    return urllib.request.Request(url, data=data, headers=merged)


def fetch_bytes(url: str, *, opener: urllib.request.OpenerDirector | None = None) -> bytes:
    opener = opener or urllib.request.build_opener()
    return opener.open(request(url), timeout=60).read()


def fetch_text(url: str, *, encoding: str = "utf-8", opener: urllib.request.OpenerDirector | None = None) -> str:
    return fetch_bytes(url, opener=opener).decode(encoding, "replace")


def parse_int(value: Any) -> int:
    if value is None:
        return 0
    text = str(value).strip()
    if not text or text in {"-", "nan", "None"}:
        return 0
    text = re.sub(r"[^0-9-]", "", text)
    return int(text) if text else 0


def format_num(value: Any) -> str:
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return str(value)


def compact_text(value: Any) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"\s+", " ", text).strip()


def multiline_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\\r\\n", "\n").replace("\\n", "\n")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t\f\v]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line)


def seed_comment_text(value: Any) -> str:
    text = multiline_text(value)
    if "\n" not in text:
        text = re.sub(r"(?<=[.!?])\s+(?=[0-9A-Za-z가-힣])", "\n", text)
    return text


def normalize_company(value: Any) -> str:
    return re.sub(r"\s+", "", compact_text(value))


def normalize_identifier(value: Any) -> str:
    text = re.sub(r"[^0-9A-Za-z가-힣]", "", compact_text(value))
    if text.isdigit():
        return str(int(text))
    return text


def normalize_award_company(value: Any) -> str:
    text = compact_text(value).lower()
    text = re.sub(r"\(주\)|㈜|주식회사", "", text)
    text = re.sub(r"co\.?,?\s*ltd\.?|corporation|inc\.?", "", text)
    return re.sub(r"[^0-9a-z가-힣]", "", text)


def load_pdf_comments() -> dict[str, Any]:
    if not PDF_COMMENTS_PATH.exists():
        return {"source": {"author": DEFAULT_COMMENT_AUTHOR}, "comments": {}}
    try:
        payload = json.loads(PDF_COMMENTS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"source": {"author": DEFAULT_COMMENT_AUTHOR}, "comments": {}}

    normalized_comments: dict[str, list[dict[str, Any]]] = {}
    for key, items in (payload.get("comments") or {}).items():
        normalized_key = normalize_award_company(key)
        if not normalized_key or not isinstance(items, list):
            continue
        clean_items = []
        for item in items:
            if isinstance(item, dict) and multiline_text(item.get("text")):
                clean_items.append(item)
        if clean_items:
            normalized_comments[normalized_key] = clean_items
    payload["comments"] = normalized_comments
    payload.setdefault("source", {}).setdefault("author", DEFAULT_COMMENT_AUTHOR)
    return payload


PDF_COMMENTS = load_pdf_comments()


def get_pdf_comments(company_key: str) -> list[dict[str, Any]]:
    comments = PDF_COMMENTS.get("comments") or {}
    items = comments.get(company_key) or []
    return items if isinstance(items, list) else []


def build_seed_comment_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    comments = PDF_COMMENTS.get("comments") or {}
    for company_key, items in comments.items():
        count = len(items) if isinstance(items, list) else 0
        if count:
            counts[f"company-comment:{company_key}"] = count
    return counts


def load_public_supabase_config() -> dict[str, str]:
    if not PUBLIC_CONFIG_PATH.exists():
        return {"url": "", "key": ""}
    try:
        text = PUBLIC_CONFIG_PATH.read_text(encoding="utf-8")
    except OSError:
        return {"url": "", "key": ""}
    url_match = re.search(r'SUPABASE_URL\s*=\s*"([^"]+)"', text)
    key_match = re.search(r'SUPABASE_KEY\s*=\s*"([^"]+)"', text)
    return {
        "url": url_match.group(1) if url_match else "",
        "key": key_match.group(1) if key_match else "",
    }


def rank_change(current_rank: int, previous_rank: int | None) -> str:
    if not previous_rank:
        return "신규/권외"
    diff = previous_rank - current_rank
    if diff > 0:
        return f"▲{diff}"
    if diff < 0:
        return f"▼{abs(diff)}"
    return "0"


def attach_previous_rank(rows: list[dict[str, Any]], previous_rows: list[dict[str, Any]]) -> None:
    def match_keys(row: dict[str, Any]) -> list[str]:
        keys: list[str] = []
        identifier = row.get("registration_no")
        if identifier:
            keys.append(f"id:{normalize_identifier(identifier)}")
        company = row.get("company")
        if company:
            keys.append(f"company:{normalize_company(company)}")
        return keys

    previous_by_key: dict[str, int] = {}
    for row in previous_rows:
        rank = parse_int(row.get("rank"))
        if not rank:
            continue
        for key in match_keys(row):
            if key not in previous_by_key or rank < previous_by_key[key]:
                previous_by_key[key] = rank

    for row in rows:
        previous_rank = next((previous_by_key[key] for key in match_keys(row) if key in previous_by_key), None)
        row["previous_rank"] = previous_rank
        row["rank_change"] = rank_change(parse_int(row.get("rank")), previous_rank)


def flatten_columns(columns: pd.Index) -> list[str]:
    flat: list[str] = []
    for col in columns:
        if not isinstance(col, tuple):
            flat.append(compact_text(col))
            continue
        parts: list[str] = []
        for part in col:
            text = compact_text(part)
            if not text or text == "nan" or text.startswith("Unnamed"):
                continue
            if not parts or parts[-1] != text:
                parts.append(text)
        flat.append(" ".join(parts))
    return flat


def guarded(name: str, fn: Callable[[], Any]) -> FetchResult:
    try:
        return FetchResult(ok=True, data=fn())
    except Exception as exc:  # Keep the artifact buildable even when one source is flaky.
        return FetchResult(ok=False, error=f"{name}: {type(exc).__name__}: {exc}")


def read_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def company_lookup_keys(entry: dict[str, Any]) -> list[str]:
    names = [entry.get("company"), *(entry.get("aliases") or [])]
    keys = []
    for name in names:
        key = normalize_award_company(name)
        if not key or key in GENERIC_COMPANY_LOOKUP_KEYS or len(key) < 2:
            continue
        if key not in keys:
            keys.append(key)
    return keys


def load_recent_award_lookup() -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}

    source_map = read_json_file(SOURCE_MAP_PATH)
    for entry in source_map.get("companies", []):
        packed = {
            "source_name": entry.get("source_name") or "산군",
            "source_url": entry.get("source_url") or entry.get("sankun_url") or "",
            "awards": [],
        }
        for key in company_lookup_keys(entry):
            lookup.setdefault(key, packed)

    for cache_path in (AWARDS_CACHE_OUT, DART_AWARDS_CACHE_OUT, NARA_CONTRACTS_CACHE_OUT):
        awards_cache = read_json_file(cache_path)
        generated_at = awards_cache.get("generated_at") or awards_cache.get("updated_at") or ""
        for entry in awards_cache.get("companies", []):
            merge_recent_awards_entry(lookup, entry, generated_at)

    return lookup


def award_identity(award: dict[str, Any]) -> tuple[str, str, str]:
    return (
        normalize_award_company(award.get("project")),
        normalize_award_company(award.get("client")),
        compact_text(award.get("date")),
    )


def merge_recent_awards_entry(lookup: dict[str, dict[str, Any]], entry: dict[str, Any], updated_at: str) -> None:
    base = {
        "source_name": entry.get("source_name") or "외부 소스",
        "source_url": entry.get("source_url") or "",
        "awards": [],
        "updated_at": updated_at,
    }
    for key in company_lookup_keys(entry):
        packed = lookup.setdefault(key, dict(base))
        if entry.get("source_name"):
            packed["source_name"] = entry["source_name"]
        if entry.get("source_url"):
            packed["source_url"] = entry["source_url"]
        if updated_at:
            packed["updated_at"] = updated_at
        seen = {award_identity(award) for award in packed.get("awards", [])}
        for award in entry.get("awards") or []:
            identity = award_identity(award)
            if identity in seen:
                continue
            packed.setdefault("awards", []).append(award)
            seen.add(identity)


def award_date_key(award: dict[str, Any]) -> int:
    text = compact_text(award.get("date"))
    match = re.search(r"(20\d{2})[.\-/년 ]?(\d{1,2})?[.\-/월 ]?(\d{1,2})?", text)
    if not match:
        return 0
    year = parse_int(match.group(1))
    month = parse_int(match.group(2)) if match.group(2) else 0
    day = parse_int(match.group(3)) if match.group(3) else 0
    return year * 10000 + month * 100 + day


def recent_award_cutoff_key(years: int = 5) -> int:
    today = datetime.now(KST)
    try:
        cutoff = today.replace(year=today.year - years)
    except ValueError:
        cutoff = today.replace(year=today.year - years, day=28)
    return cutoff.year * 10000 + cutoff.month * 100 + cutoff.day


def attach_recent_awards_to_rows(rows: list[dict[str, Any]], award_lookup: dict[str, dict[str, Any]]) -> None:
    cutoff_key = recent_award_cutoff_key(5)
    for row in rows:
        keys = [normalize_award_company(row.get("company"))]
        keys.extend(normalize_award_company(alias) for alias in row.get("aliases", []) or [])
        entry = next((award_lookup[key] for key in keys if key in award_lookup), None)
        if not entry:
            row["recent_awards"] = []
            row["recent_awards_status"] = "unmapped"
            attach_unit_cost_data_to_row(row, [])
            continue
        recent_awards = [
            award
            for award in sorted(entry.get("awards", []), key=award_date_key, reverse=True)
            if award_date_key(award) >= cutoff_key
        ]
        row["recent_awards"] = recent_awards[:5]
        attach_unit_cost_data_to_row(row, recent_awards)
        row["recent_awards_source"] = {
            "name": entry.get("source_name") or "외부 소스",
            "url": entry.get("source_url") or "",
            "updated_at": entry.get("updated_at") or "",
        }
        row["recent_awards_status"] = "ready" if row["recent_awards"] else "source_only"


def load_article_lookup() -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}

    for cache_path in (NEWS_CACHE_OUT, DART_STRATEGY_CACHE_OUT):
        article_cache = read_json_file(cache_path)
        generated_at = article_cache.get("generated_at") or ""
        for entry in article_cache.get("companies", []):
            merge_article_entry(lookup, entry, generated_at)

    for packed in lookup.values():
        source_names = packed.get("source_names") or []
        if len(source_names) > 1:
            packed["source_name"] = " + ".join(source_names[:2])
        elif source_names:
            packed["source_name"] = source_names[0]
        else:
            packed["source_name"] = "뉴스/전략공시"
        source_urls = packed.get("source_urls") or []
        packed["source_url"] = source_urls[0] if len(source_urls) == 1 else ""
        articles = sorted(packed.get("articles", []), key=article_date_key, reverse=True)
        packed["articles"] = unique_display_articles(articles, limit=5)
    return lookup


def load_credit_rating_lookup() -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    cache = read_json_file(CREDIT_RATINGS_CACHE_OUT)
    generated_at = cache.get("generated_at") or ""

    def entry_score(entry: dict[str, Any]) -> int:
        if entry.get("status") == "ready" and entry.get("rating_label"):
            return 3
        if entry.get("sources"):
            return 2
        return 1

    for entry in cache.get("companies", []) or []:
        packed = {
            "company": entry.get("company"),
            "aliases": entry.get("aliases") or [],
            "status": entry.get("status") or "empty",
            "rating_label": entry.get("rating_label") or "",
            "representative": entry.get("representative") or {},
            "sources": entry.get("sources") or [],
            "messages": entry.get("messages") or [],
            "updated_at": generated_at,
        }
        for key in company_lookup_keys(entry):
            current = lookup.get(key)
            if not current or entry_score(packed) > entry_score(current):
                lookup[key] = packed

    meta = {
        "ok": bool(cache),
        "generated_at": generated_at,
        "source_note": cache.get("source_note") or "",
        "companies_collected": cache.get("companies_collected") or 0,
        "companies_with_rating": cache.get("companies_with_rating") or 0,
        "query": cache.get("query") or {},
    }
    return lookup, meta


def article_identity(article: dict[str, Any]) -> str:
    return normalize_award_company(article.get("url")) or normalize_award_company(article.get("title"))


def article_date_key(article: dict[str, Any]) -> int:
    text = compact_text(article.get("published") or article.get("date"))
    match = re.search(r"(20\d{2})[.\-/년 ]?(\d{1,2})?[.\-/월 ]?(\d{1,2})?", text)
    if not match:
        return 0
    year = parse_int(match.group(1))
    month = parse_int(match.group(2)) if match.group(2) else 0
    day = parse_int(match.group(3)) if match.group(3) else 0
    return year * 10000 + month * 100 + day


def article_plain_text(article: dict[str, Any]) -> str:
    text = " ".join(
        compact_text(article.get(key))
        for key in ("title", "summary")
        if compact_text(article.get(key))
    )
    text = re.sub(r"\[[^\]]+\]|\([^)]*\)", " ", text)
    return text.lower()


def article_words(article: dict[str, Any]) -> list[str]:
    return re.findall(r"[0-9a-z가-힣]+", article_plain_text(article))


def article_project_terms(article: dict[str, Any]) -> set[str]:
    terms: set[str] = set()
    for word in article_words(article):
        for match in re.findall(r"[가-힣a-z]+[0-9]+(?:단지|bl|블록|구역|지구|공구)", word):
            terms.add(match)
        for suffix in ARTICLE_PROJECT_SUFFIXES:
            if word.endswith(suffix) and len(word) > len(suffix) + 1:
                terms.add(word[: -len(suffix)])
    return {term for term in terms if len(term) >= 3}


def article_event_terms(article: dict[str, Any]) -> set[str]:
    text = article_plain_text(article)
    return {term for term in ARTICLE_EVENT_TERMS if term in text}


def article_topic_terms(article: dict[str, Any]) -> set[str]:
    terms: set[str] = set(article_project_terms(article))
    for word in article_words(article):
        if len(word) < 2 or word in ARTICLE_TOPIC_STOPWORDS:
            continue
        for suffix in ARTICLE_PROJECT_SUFFIXES:
            if word.endswith(suffix) and len(word) > len(suffix) + 1:
                word = word[: -len(suffix)]
                break
        if len(word) >= 2 and word not in ARTICLE_TOPIC_STOPWORDS:
            terms.add(word)
    terms.update(article_event_terms(article))
    return terms


def is_redundant_article(candidate: dict[str, Any], selected: dict[str, Any]) -> bool:
    candidate_projects = article_project_terms(candidate)
    selected_projects = article_project_terms(selected)
    shared_projects = candidate_projects & selected_projects
    if shared_projects:
        candidate_events = article_event_terms(candidate)
        selected_events = article_event_terms(selected)
        if candidate_events & selected_events:
            return True

    candidate_terms = article_topic_terms(candidate)
    selected_terms = article_topic_terms(selected)
    if not candidate_terms or not selected_terms:
        return False
    shared = candidate_terms & selected_terms
    overlap_base = min(len(candidate_terms), len(selected_terms))
    return len(shared) >= 4 and len(shared) / overlap_base >= 0.55


def unique_display_articles(articles: list[dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for article in articles:
        if any(is_redundant_article(article, existing) for existing in selected):
            continue
        selected.append(article)
        if len(selected) >= limit:
            break
    return selected


def merge_article_entry(lookup: dict[str, dict[str, Any]], entry: dict[str, Any], updated_at: str) -> None:
    source_name = entry.get("source_name") or "뉴스/전략공시"
    source_url = entry.get("source_url") or ""
    for key in company_lookup_keys(entry):
        packed = lookup.setdefault(
            key,
            {
                "source_names": [],
                "source_urls": [],
                "articles": [],
                "updated_at": "",
            },
        )
        if source_name not in packed["source_names"]:
            packed["source_names"].append(source_name)
        if source_url and source_url not in packed["source_urls"]:
            packed["source_urls"].append(source_url)
        if updated_at and updated_at > packed.get("updated_at", ""):
            packed["updated_at"] = updated_at
        seen = {article_identity(article) for article in packed.get("articles", [])}
        for article in entry.get("articles") or []:
            identity = article_identity(article)
            if identity in seen:
                continue
            packed.setdefault("articles", []).append(article)
            seen.add(identity)


def attach_articles_to_rows(rows: list[dict[str, Any]], article_lookup: dict[str, dict[str, Any]]) -> None:
    for row in rows:
        keys = [normalize_award_company(row.get("company"))]
        keys.extend(normalize_award_company(alias) for alias in row.get("aliases", []) or [])
        entry = next((article_lookup[key] for key in keys if key in article_lookup), None)
        if not entry:
            row["related_articles"] = []
            row["related_articles_status"] = "unmapped"
            continue
        row["related_articles"] = entry.get("articles", [])[:5]
        row["related_articles_source"] = {
            "name": entry.get("source_name") or "뉴스",
            "url": entry.get("source_url") or "",
            "updated_at": entry.get("updated_at") or "",
        }
        row["related_articles_status"] = "ready" if row["related_articles"] else "empty"


def attach_credit_ratings_to_rows(rows: list[dict[str, Any]], rating_lookup: dict[str, dict[str, Any]]) -> None:
    for row in rows:
        keys = [normalize_award_company(row.get("company"))]
        keys.extend(normalize_award_company(alias) for alias in row.get("aliases", []) or [])
        entry = next((rating_lookup[key] for key in keys if key in rating_lookup), None)
        if not entry:
            row["credit_rating_label"] = "미확인"
            row["credit_rating_status"] = "unmapped"
            row["credit_rating_representative"] = {}
            row["credit_rating_sources"] = []
            row["credit_rating_messages"] = ["신용등급 캐시에 매칭된 회사명이 없습니다."]
            row["credit_rating_updated_at"] = ""
            continue
        row["credit_rating_label"] = entry.get("rating_label") or "미확인"
        row["credit_rating_status"] = entry.get("status") or "empty"
        row["credit_rating_representative"] = entry.get("representative") or {}
        row["credit_rating_sources"] = entry.get("sources") or []
        row["credit_rating_messages"] = entry.get("messages") or []
        row["credit_rating_updated_at"] = entry.get("updated_at") or ""


def attach_recent_awards(results: dict[str, Any]) -> None:
    award_lookup = load_recent_award_lookup()
    article_lookup = load_article_lookup()
    sections = [
        ("cak", "rows"),
        ("cm", "rows"),
        ("kacem", "rows"),
    ]
    for source_key, row_key in sections:
        result = results.get(source_key)
        if isinstance(result, FetchResult) and result.ok and result.data:
            attach_recent_awards_to_rows(result.data.get(row_key, []), award_lookup)
            attach_articles_to_rows(result.data.get(row_key, []), article_lookup)

    etis = results.get("etis")
    if isinstance(etis, FetchResult) and etis.ok and etis.data:
        attach_recent_awards_to_rows(etis.data.get("overall_rows", []), award_lookup)
        attach_recent_awards_to_rows(etis.data.get("construction_rows", []), award_lookup)
        attach_articles_to_rows(etis.data.get("overall_rows", []), article_lookup)
        attach_articles_to_rows(etis.data.get("construction_rows", []), article_lookup)


def attach_credit_ratings(results: dict[str, Any]) -> None:
    rating_lookup, meta = load_credit_rating_lookup()
    results["credit_ratings"] = meta
    cak = results.get("cak")
    if isinstance(cak, FetchResult) and cak.ok and cak.data:
        attach_credit_ratings_to_rows(cak.data.get("rows", []), rating_lookup)


GENERIC_COMPANY_MARK_KEYS = GENERIC_COMPANY_LOOKUP_KEYS


def row_online_update_keys(row: dict[str, Any]) -> list[str]:
    names = [row.get("company"), *(row.get("aliases") or [])]
    keys: list[str] = []
    for name in names:
        key = normalize_award_company(name)
        if not key or key in GENERIC_COMPANY_MARK_KEYS:
            continue
        if len(key) < 2:
            continue
        if key not in keys:
            keys.append(key)
    return keys


def load_online_update_marks() -> dict[str, dict[str, Any]]:
    cache = read_json_file(ONLINE_UPDATE_MARKS_OUT)
    marks: dict[str, dict[str, Any]] = {}
    for entry in cache.get("companies") or []:
        key = normalize_award_company(entry.get("company_key") or entry.get("company"))
        if not key or key in GENERIC_COMPANY_MARK_KEYS:
            continue
        marks[key] = entry
    return marks


def online_update_award_identity(award: dict[str, Any]) -> str:
    return normalize_award_company(award.get("receipt_no")) or "|".join(
        normalize_award_company(award.get(field))
        for field in ("project", "client", "date", "amount")
    )


def online_update_article_identity(article: dict[str, Any]) -> str:
    return (
        normalize_award_company(article.get("receipt_no"))
        or normalize_award_company(article.get("title"))
        or normalize_award_company(article.get("url"))
    )


def online_update_item_key_sets(mark: dict[str, Any]) -> dict[str, list[str]]:
    keys = {"award": set(), "article": set()}
    for source in mark.get("sources") or []:
        item_type = compact_text(source.get("item_type"))
        if item_type not in keys:
            continue
        for item_key in source.get("item_keys") or []:
            key = compact_text(item_key)
            if key:
                keys[item_type].add(key)
    return {item_type: sorted(values) for item_type, values in keys.items()}


def attach_online_update_marks_to_rows(rows: list[dict[str, Any]], marks: dict[str, dict[str, Any]]) -> None:
    for row in rows:
        mark = next((marks[key] for key in row_online_update_keys(row) if key in marks), None)
        row["online_update_mark"] = mark or {}
        item_keys = online_update_item_key_sets(mark or {})
        row["online_update_award_keys"] = item_keys["award"]
        row["online_update_article_keys"] = item_keys["article"]


def attach_online_update_marks(results: dict[str, Any]) -> None:
    marks = load_online_update_marks()
    results["online_update_marks"] = {
        "ok": bool(marks),
        "companies_with_updates": len(marks),
    }
    sections = [
        ("cak", "rows"),
        ("cm", "rows"),
        ("kacem", "rows"),
    ]
    for source_key, row_key in sections:
        result = results.get(source_key)
        if isinstance(result, FetchResult) and result.ok and result.data:
            attach_online_update_marks_to_rows(result.data.get(row_key, []), marks)

    etis = results.get("etis")
    if isinstance(etis, FetchResult) and etis.ok and etis.data:
        attach_online_update_marks_to_rows(etis.data.get("overall_rows", []), marks)
        attach_online_update_marks_to_rows(etis.data.get("construction_rows", []), marks)


def fetch_cak_top30() -> dict[str, Any]:
    landing_url = "https://www.cak.or.kr/lay1/S1T54C56/sublink.do"
    ajax_url = "https://www.cak.or.kr/biz/ajax/srchBizList.do"
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    html_text = fetch_text(landing_url, opener=opener)
    token_match = re.search(r'<meta[^>]+name=["\']_csrf["\'][^>]+content=["\']([^"\']+)', html_text)
    if not token_match:
        raise RuntimeError("CAK CSRF token not found")

    params = {
        "srh_year": "",
        "srh_upjong": "",
        "srh_sigong": "10",  # 토건
        "srh_local": "",
        "srh_name": "",
        "srh_sort": "sigong",
        "srh_sort_dir": "DESC",
        "pageUnit": "30",
        "cpage": "1",
        "firstIndex": "1",
    }
    payload = urllib.parse.urlencode(params).encode()
    req = request(
        ajax_url,
        data=payload,
        headers={
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRF-TOKEN": token_match.group(1),
            "Referer": landing_url,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Accept": "application/json, text/javascript, */*; q=0.01",
        },
    )
    raw = opener.open(req, timeout=60).read().decode("utf-8", "replace")
    payload_json = json.loads(raw)
    rows = []
    for rank, row in enumerate(payload_json.get("bizList", [])[:30], start=1):
        rows.append(
            {
                "rank": rank,
                "company": compact_text(row.get("sangho")),
                "registration_no": normalize_identifier(row.get("upjongno")),
                "representative": compact_text(row.get("nm")),
                "business_type": compact_text(row.get("upjongnm")),
                "region": compact_text(row.get("citynm")),
                "amount_million_krw": parse_int(row.get("handoamt")),
            }
        )
    latest_year = parse_int(payload_json.get("maxyear"))
    previous_year = latest_year - 1 if latest_year else None
    previous_rows = fetch_cak_notice_xlsx_rows(previous_year) if previous_year else []
    attach_previous_rank(rows, previous_rows)
    return {
        "title": "대한건설협회 토건 시공능력평가 상위 30",
        "latest_year": str(latest_year),
        "previous_year": str(previous_year) if previous_year else "",
        "basis_date": payload_json.get("maxYearVO", {}).get("gijundate"),
        "total_count": payload_json.get("totCnt"),
        "unit": "백만원",
        "source_url": landing_url,
        "ajax_url": ajax_url,
        "previous_source_url": find_cak_notice_xlsx_urls().get(previous_year, ""),
        "rows": rows,
    }


def find_cak_notice_xlsx_urls() -> dict[int, str]:
    list_url = "https://www.cak.or.kr/lay1/bbs/S1T10C14/A/4/list.do"
    html_text = fetch_text(list_url)
    found: dict[int, str] = {}
    for match in re.finditer(r"(\d{4})년도 종합건설사업자 시공능력평가액 공시", html_text):
        year = parse_int(match.group(1))
        block = html_text[match.start() : match.start() + 1800]
        file_match = re.search(r'href="(/download\.do\?uuid=[^"]+\.xlsx)"', block)
        if file_match and year not in found:
            found[year] = urllib.parse.urljoin(list_url, file_match.group(1).replace("&amp;", "&"))
    return found


def fetch_cak_notice_xlsx_rows(year: int | None) -> list[dict[str, Any]]:
    if not year:
        return []
    urls = find_cak_notice_xlsx_urls()
    url = urls.get(year)
    if not url:
        return []
    data = fetch_bytes(url)
    df = pd.read_excel(io.BytesIO(data), sheet_name="토건", header=None)
    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        rank = parse_int(row.iloc[0])
        company = compact_text(row.iloc[1] if len(row) > 1 else "")
        if rank <= 0 or not company or company in {"상호", "nan"}:
            continue
        rows.append({"rank": rank, "company": company, "registration_no": normalize_identifier(row.iloc[5] if len(row) > 5 else "")})
    return rows


def fetch_cm_year_ranked_rows(gongsi_year: int) -> tuple[list[dict[str, Any]], int, str]:
    base_url = "http://www.kiscon.net/pcm/detail_search.asp"
    frames: list[pd.DataFrame] = []
    for page in range(1, 4):
        query_obj = {"GONGSI_YEAR": gongsi_year}
        if page > 1:
            query_obj.update(
                {
                    "page": page,
                    "target": "",
                    "keyword": "전체",
                    "order": "2",
                    "SANGHO": "",
                    "OWNER": "",
                    "MAIN_FIELD": "",
                    "UPCHE_TYPE": "",
                    "AREA_CODE": "",
                }
            )
        url = f"{base_url}?{urllib.parse.urlencode(query_obj)}"
        html_text = fetch_text(url)
        table = pd.read_html(io.StringIO(html_text))[1]
        table.columns = flatten_columns(table.columns)
        frames.append(table)

    df = pd.concat(frames, ignore_index=True)
    company_col = "업체명"
    total_service_col = "총건설 사업 관리실적 (용역형)"
    amount_year = gongsi_year - 1
    amount_col = f"{amount_year}년도 건설사 업관리 실적"
    cm_risk_col = f"{amount_year}년도 시공 책임형 건설사업 관리실적"
    people_col = f"{amount_year}년도 총인력 보유현 황(명)"
    df[amount_col] = df[amount_col].map(parse_int)
    df[cm_risk_col] = df[cm_risk_col].map(parse_int)
    df[people_col] = df[people_col].map(parse_int)
    ranked = df.sort_values(amount_col, ascending=False)

    rows = []
    for rank, row in enumerate(ranked.to_dict("records"), start=1):
        rows.append(
            {
                "rank": rank,
                "company": compact_text(row[company_col]),
                "service_cm_amount_million_krw": parse_int(row[amount_col]),
                "cm_at_risk_amount_million_krw": parse_int(row[cm_risk_col]),
                "total_service_cm_amount_million_krw": parse_int(row[total_service_col]),
                "people": parse_int(row[people_col]),
            }
        )
    return rows, len(df), base_url


def fetch_cm_top30() -> dict[str, Any]:
    current_year = 2025
    previous_year = current_year - 1
    rows_all, total_count, base_url = fetch_cm_year_ranked_rows(current_year)
    previous_rows, _, _ = fetch_cm_year_ranked_rows(previous_year)
    rows = rows_all[:30]
    attach_previous_rank(rows, previous_rows)
    return {
        "title": "KISCON/CM능력공시 2024년 용역형 CM 실적 상위 30",
        "latest_notice": f"{current_year} 건설사업관리 공시업체 검색",
        "latest_year": str(current_year),
        "previous_year": str(previous_year),
        "covered_period": "1996.12.30 ~ 2024.12.31, 2024년도 실적 별도 표기",
        "total_count": int(total_count),
        "unit": "백만원",
        "source_url": f"{base_url}?GONGSI_YEAR={current_year}",
        "previous_source_url": f"{base_url}?GONGSI_YEAR={previous_year}",
        "cmak_notice_url": "https://www.cmak.or.kr/html/business/bcmnotice.asp",
        "rows": rows,
    }


def extract_pdf_rankings(url: str, parser: Callable[[list[Any]], dict[str, Any] | None], limit: int = 30) -> list[dict[str, Any]]:
    data = fetch_bytes(url)
    rows: list[dict[str, Any]] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for raw_row in table:
                    parsed = parser(raw_row)
                    if not parsed:
                        continue
                    rows.append(parsed)
                    if len(rows) >= limit:
                        return rows
    return rows


def parse_etis_row(row: list[Any]) -> dict[str, Any] | None:
    if len(row) < 5 or not str(row[0]).strip().isdigit():
        return None
    return {
        "rank": parse_int(row[0]),
        "registration_no": compact_text(row[1]),
        "company": compact_text(row[2]),
        "count": parse_int(row[3]),
        "amount_million_krw": parse_int(row[4]),
    }


def fetch_etis_rankings() -> dict[str, Any]:
    latest_year = 2025
    previous_year = latest_year - 1
    overall_pdf = f"https://www.etis.or.kr/webs/pdfdata/{latest_year}siljuk_all.pdf"
    construction_pdf = f"https://www.etis.or.kr/webs/pdfdata/{latest_year}siljuk_con.pdf"
    previous_overall_pdf = f"https://www.etis.or.kr/webs/pdfdata/{previous_year}siljuk_all.pdf"
    previous_construction_pdf = f"https://www.etis.or.kr/webs/pdfdata/{previous_year}siljuk_con.pdf"
    overall_rows = extract_pdf_rankings(overall_pdf, parse_etis_row, limit=30)
    construction_rows = extract_pdf_rankings(construction_pdf, parse_etis_row, limit=30)
    attach_previous_rank(overall_rows, extract_pdf_rankings(previous_overall_pdf, parse_etis_row, limit=100))
    attach_previous_rank(construction_rows, extract_pdf_rankings(previous_construction_pdf, parse_etis_row, limit=100))
    return {
        "title": "ETIS 2025년도 엔지니어링 수주실적",
        "latest_year": str(latest_year),
        "previous_year": str(previous_year),
        "unit": "백만원",
        "selected_page_url": "https://www.etis.or.kr/webs/statistics/receive_eng_next.jsp",
        "overall_rank_url": "https://www.etis.or.kr/webs/statistics/siljuk_ranking.jsp?leftParam=911&topParam=3",
        "construction_rank_url": "https://www.etis.or.kr/webs/statistics/siljuk_ranking2.jsp?leftParam=912&topParam=3",
        "overall_pdf_url": overall_pdf,
        "construction_pdf_url": construction_pdf,
        "previous_overall_pdf_url": previous_overall_pdf,
        "previous_construction_pdf_url": previous_construction_pdf,
        "overall_rows": overall_rows,
        "construction_rows": construction_rows,
    }


def parse_kacem_record_links(record_html: str) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    for match in re.finditer(r'<a\s+href="([^"]+)"[^>]*>([^<]*분기\s*바로가기)</a>', record_html):
        href, label = match.groups()
        links.append(
            {
                "label": compact_text(label.replace("바로가기", "")),
                "url": urllib.parse.urljoin("http://www.ekacem.or.kr/storehouse/record.asp", href),
            }
        )
    return links


def parse_kacem_row(row: list[Any]) -> dict[str, Any] | None:
    if len(row) < 14 or not str(row[0]).strip().isdigit():
        return None
    return {
        "rank": parse_int(row[0]),
        "company": compact_text(row[1]),
        "total_count": parse_int(row[2]),
        "total_amount_100m_krw": parse_int(row[3]),
        "public_design_count": parse_int(row[4]),
        "public_design_amount_100m_krw": parse_int(row[5]),
        "public_cm_count": parse_int(row[6]),
        "public_cm_amount_100m_krw": parse_int(row[7]),
        "private_supervision_count": parse_int(row[8]),
        "private_supervision_amount_100m_krw": parse_int(row[9]),
        "private_multiuse_count": parse_int(row[10]),
        "private_multiuse_amount_100m_krw": parse_int(row[11]),
        "private_cm_count": parse_int(row[12]),
        "private_cm_amount_100m_krw": parse_int(row[13]),
    }


def fetch_kacem_rankings() -> dict[str, Any]:
    record_url = "http://www.ekacem.or.kr/storehouse/record.asp"
    record_html = fetch_text(record_url, encoding="cp949")
    links = parse_kacem_record_links(record_html)
    if not links:
        raise RuntimeError("KACEM quarterly PDF links not found")
    latest = links[0]
    year_match = re.search(r"(\d{4})년\s+(\d)/4분기", latest["label"])
    previous_label = ""
    previous_url = ""
    if year_match:
        previous_label = f"{parse_int(year_match.group(1)) - 1}년 {year_match.group(2)}/4분기"
        previous_url = next((item["url"] for item in links if item["label"] == previous_label), "")
    rows = extract_pdf_rankings(latest["url"], parse_kacem_row, limit=30)
    if previous_url:
        attach_previous_rank(rows, extract_pdf_rankings(previous_url, parse_kacem_row, limit=100))
    return {
        "title": "한국건설엔지니어링협회 분기 수주실적 상위 30",
        "latest_label": latest["label"],
        "previous_label": previous_label,
        "unit": "억원",
        "record_url": record_url,
        "latest_pdf_url": latest["url"],
        "previous_pdf_url": previous_url,
        "available_links": links[:6],
        "rows": rows,
    }


def money_bar(value: int, max_value: int) -> str:
    width = 0 if max_value <= 0 else max(2, round(value / max_value * 100))
    return f'<span class="bar" style="--w:{width}%"></span>'


def css_token(value: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "-", value.lower()).strip("-") or "value"


def rating_tone_class(value: Any) -> str:
    text = compact_text(value).upper()
    if not text:
        return "empty"
    if text.startswith(("AAA", "AA")):
        return "grade-aa"
    if text.startswith("A"):
        return "grade-a"
    if text.startswith("BBB"):
        return "grade-bbb"
    if text.startswith(("BB", "B")):
        return "grade-b"
    if text.startswith(("CCC", "CC", "C", "D")):
        return "grade-c"
    return "empty"


def parse_recent_item_date(value: Any) -> datetime | None:
    text = compact_text(value)
    match = re.search(r"(20\d{2})\D+(\d{1,2})\D+(\d{1,2})", text)
    if not match:
        return None
    try:
        return datetime(
            parse_int(match.group(1)),
            parse_int(match.group(2)),
            parse_int(match.group(3)),
            tzinfo=KST,
        )
    except ValueError:
        return None


def recent_update_reasons(row: dict[str, Any], days: int = 31) -> list[tuple[datetime, str]]:
    cutoff = datetime.now(KST) - timedelta(days=days)
    company_key = normalize_award_company(row.get("company"))
    comment_source = PDF_COMMENTS.get("source") or {}
    reasons: list[tuple[datetime, str]] = []

    def add_reason(item_date: datetime | None, kind: str, title: Any = "") -> None:
        if not item_date or item_date < cutoff:
            return
        date_text = item_date.strftime("%Y-%m-%d")
        title_text = compact_text(title)
        if len(title_text) > 34:
            title_text = f"{title_text[:34]}..."
        label = f"{kind} {date_text}"
        if title_text:
            label = f"{label}: {title_text}"
        reasons.append((item_date, label))

    for comment in get_pdf_comments(company_key):
        item_date = parse_recent_item_date(comment.get("date") or comment_source.get("date"))
        add_reason(item_date, "Comment", comment.get("body") or comment.get("summary"))
    return sorted(reasons, key=lambda item: item[0], reverse=True)


def row_has_recent_update(row: dict[str, Any], days: int = 31) -> bool:
    return bool(recent_update_reasons(row, days))


def recent_update_title(row: dict[str, Any], days: int = 31) -> str:
    reasons = recent_update_reasons(row, days)
    if not reasons:
        return "최근 1개월 내 Comment 없음"
    return "최근 Comment: " + " / ".join(label for _, label in reasons[:3])


def add_status_column(columns: list[tuple[str, str, str]]) -> list[tuple[str, str, str]]:
    has_comment_status = any(key == "row_status" for key, _, _ in columns)
    has_recent_update = any(key == "recent_update" for key, _, _ in columns)
    if has_comment_status and has_recent_update:
        return columns
    enriched: list[tuple[str, str, str]] = []
    for column in columns:
        enriched.append(column)
        if column[0] == "company":
            if not has_comment_status:
                enriched.append(("row_status", "Comment", "status"))
            if not has_recent_update:
                enriched.append(("recent_update", "New", "recent"))
    return enriched


def render_row_status(row: dict[str, Any]) -> str:
    company_key = normalize_award_company(row.get("company"))
    comment_key = f"company-comment:{company_key}"
    seed_count = len(get_pdf_comments(company_key))
    count_class = " has-comments" if seed_count else ""
    return (
        f'<div class="row-status" data-comment-key="{html.escape(comment_key)}">'
        f'<span class="comment-count{count_class}" title="Comment {seed_count}개" aria-label="코멘트 {seed_count}개">({seed_count})</span>'
        f"</div>"
    )


def render_recent_update(row: dict[str, Any]) -> str:
    company_key = normalize_award_company(row.get("company"))
    comment_key = f"company-comment:{company_key}"
    new_badge = ""
    if row_has_recent_update(row):
        title = html.escape(recent_update_title(row), quote=True)
        new_badge = f'<span class="new-badge" title="{title}" aria-label="{title}">N</span>'
    return (
        f'<div class="update-status" data-comment-key="{html.escape(comment_key)}">'
        f"{new_badge}</div>"
    )


def render_company_update_card(row: dict[str, Any]) -> str:
    mark = row.get("online_update_mark") or {}
    if not mark or not parse_int(mark.get("added_count")):
        return ""
    source_labels = []
    for source in mark.get("sources") or []:
        label = compact_text(source.get("label"))
        count = parse_int(source.get("added_count"))
        if label and count:
            source_labels.append(f"{label} {count}건")
    title_text = "이번 온라인 갱신 추가"
    if source_labels:
        title_text = f"{title_text}: {', '.join(source_labels)}"
    title = html.escape(title_text, quote=True)
    return f'<span class="company-update-card" title="{title}" aria-label="{title}">UPDATE</span>'


def online_update_meta_class(row: dict[str, Any], item_type: str, item: dict[str, Any], base_class: str) -> str:
    key = (
        online_update_award_identity(item)
        if item_type == "award"
        else online_update_article_identity(item)
    )
    lookup_key = "online_update_award_keys" if item_type == "award" else "online_update_article_keys"
    if key and key in set(row.get(lookup_key) or []):
        return f"{base_class} is-online-update"
    return base_class


def change_class(value: Any) -> str:
    text = str(value or "")
    if text.startswith("▲"):
        return "change up"
    if text.startswith("▼"):
        return "change down"
    if text == "0":
        return "change same"
    return "change new"


def render_value(value: Any, kind: str, max_amount: int = 0) -> str:
    if kind == "number":
        return format_num(value)
    if kind == "rank":
        parsed = parse_int(value)
        return format_num(parsed) if parsed else "-"
    if kind == "change":
        text = str(value or "")
        return f'<span class="{change_class(text)}">{html.escape(text)}</span>'
    if kind == "moneybar":
        return f"{format_num(value)}{money_bar(parse_int(value), max_amount)}"
    if kind == "money":
        return format_num(value)
    if kind == "rating":
        text = compact_text(value)
        rating_class = rating_tone_class(text)
        return f'<span class="rating-pill {rating_class}">{html.escape(text or "미확인")}</span>'
    text = compact_text(value)
    return html.escape(text if text else "-")


def parse_float(value: Any) -> float:
    text = compact_text(value)
    if not text:
        return 0.0
    text = re.sub(r"[^0-9.\-]", "", text)
    try:
        return float(text)
    except ValueError:
        return 0.0


def format_area(value: Any) -> str:
    area = parse_float(value)
    if area <= 0:
        return ""
    return f"{area:,.1f}㎡"


def format_unit_cost(value: Any) -> str:
    cost = parse_float(value)
    if cost <= 0:
        return ""
    manwon = cost / 10_000
    if manwon >= 1000:
        return f"{manwon:,.0f}만원/㎡"
    return f"{manwon:,.1f}만원/㎡"


def format_unit_cost_py(value: Any) -> str:
    return format_unit_cost(value).replace("/㎡", "/평")


def award_year(award: dict[str, Any]) -> int:
    return award_date_key(award) // 10000


def is_area_unit_unsuitable(award: dict[str, Any]) -> bool:
    text = " ".join(
        compact_text(award.get(key)).lower()
        for key in ("project", "category", "report_name", "region")
    )
    return any(keyword in text for keyword in AREA_UNIT_UNSUITABLE_KEYWORDS)


def calculated_unit_cost_m2(award: dict[str, Any]) -> int:
    unit_cost = parse_float(award.get("unit_cost_krw_per_m2"))
    if unit_cost > 0:
        return int(round(unit_cost))

    amount_krw = parse_float(award.get("amount_krw"))
    floor_area_m2 = parse_float(award.get("floor_area_m2"))
    if amount_krw > 0 and floor_area_m2 > 0:
        return int(round(amount_krw / floor_area_m2))
    return 0


def calculated_unit_cost_py(award: dict[str, Any], unit_cost_m2: int = 0) -> int:
    unit_cost = parse_float(award.get("unit_cost_krw_per_py"))
    if unit_cost > 0:
        return int(round(unit_cost))
    unit_cost_m2 = unit_cost_m2 or calculated_unit_cost_m2(award)
    return int(round(unit_cost_m2 * 3.305785)) if unit_cost_m2 else 0


def unit_cost_area_source(award: dict[str, Any]) -> str:
    explicit = compact_text(
        award.get("floor_area_source")
        or award.get("area_source")
        or award.get("floor_area_source_name")
    )
    if explicit:
        return explicit

    source_name = compact_text(award.get("source_name"))
    source_url = compact_text(award.get("source_url")).lower()
    if "dart" in source_name.lower() or "dart.fss" in source_url:
        return "DART 원문"
    if "나라장터" in source_name:
        return "나라장터 계약정보"
    if "정비사업" in source_name:
        return "정비사업 공고"
    if "건축" in source_name or "인허가" in source_name:
        return source_name
    return source_name or "외부 소스"


def unit_cost_confidence(award: dict[str, Any]) -> tuple[str, str]:
    explicit = compact_text(
        award.get("floor_area_confidence")
        or award.get("area_confidence")
        or award.get("unit_cost_confidence")
    ).lower()
    if explicit in {"high", "medium", "low"}:
        return explicit, {"high": "High", "medium": "Medium", "low": "Low"}[explicit]

    source = unit_cost_area_source(award)
    source_url = compact_text(award.get("source_url")).lower()
    source_lower = source.lower()
    if "dart" in source_lower or "dart.fss" in source_url or "건축물대장" in source:
        return "high", "High"
    if "건축hub" in source_lower or "인허가" in source or "정비사업" in source or "나라장터" in source:
        return "medium", "Medium"
    return "low", "Low"


def unit_cost_status_summary(awards: list[dict[str, Any]]) -> dict[str, int]:
    summary = {
        "total": len(awards),
        "calculated": 0,
        "trusted": 0,
        "area_missing": 0,
        "unsuitable": 0,
    }
    for award in awards:
        unit_cost_m2 = calculated_unit_cost_m2(award)
        if unit_cost_m2:
            summary["calculated"] += 1
            if unit_cost_confidence(award)[0] in {"high", "medium"}:
                summary["trusted"] += 1
        elif is_area_unit_unsuitable(award):
            summary["unsuitable"] += 1
        else:
            summary["area_missing"] += 1
    return summary


def build_unit_cost_records(awards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for award in sorted(awards, key=award_date_key, reverse=True):
        unit_cost_m2 = calculated_unit_cost_m2(award)
        floor_area_m2 = parse_float(award.get("floor_area_m2"))
        amount_krw = parse_float(award.get("amount_krw"))
        if not unit_cost_m2 or not floor_area_m2 or not amount_krw:
            continue
        if is_area_unit_unsuitable(award):
            continue

        confidence, confidence_label = unit_cost_confidence(award)
        records.append(
            {
                "project": compact_text(award.get("project")),
                "client": compact_text(award.get("client")),
                "date": compact_text(award.get("date")),
                "year": award_year(award),
                "amount": compact_text(award.get("amount")),
                "amount_krw": int(round(amount_krw)),
                "floor_area_m2": floor_area_m2,
                "unit_cost_krw_per_m2": unit_cost_m2,
                "unit_cost_krw_per_py": calculated_unit_cost_py(award, unit_cost_m2),
                "source_name": compact_text(award.get("source_name")),
                "source_url": compact_text(award.get("source_url")),
                "area_source": unit_cost_area_source(award),
                "area_basis": compact_text(award.get("floor_area_basis") or "연면적"),
                "confidence": confidence,
                "confidence_label": confidence_label,
            }
        )
    return records


def trusted_unit_cost_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [record for record in records if record.get("confidence") in {"high", "medium"}]


def select_representative_unit_cost(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    trusted = trusted_unit_cost_records(records)
    return trusted[0] if trusted else None


def median_number(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    center = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[center]
    return (ordered[center - 1] + ordered[center]) / 2


def build_unit_cost_trend(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[int, list[float]] = {}
    for record in trusted_unit_cost_records(records):
        year = parse_int(record.get("year"))
        unit_cost_py = parse_float(record.get("unit_cost_krw_per_py"))
        if year and unit_cost_py:
            grouped.setdefault(year, []).append(unit_cost_py)

    trend = []
    for year, values in sorted(grouped.items()):
        trend.append(
            {
                "year": year,
                "count": len(values),
                "median_unit_cost_krw_per_py": int(round(median_number(values))),
            }
        )
    return trend


def attach_unit_cost_data_to_row(row: dict[str, Any], awards: list[dict[str, Any]]) -> None:
    records = build_unit_cost_records(awards)
    row["unit_cost_records"] = records
    row["unit_cost_trend"] = build_unit_cost_trend(records)
    row["representative_unit_cost"] = select_representative_unit_cost(records)
    row["unit_cost_summary"] = unit_cost_status_summary(awards)


def market_unit_cost_identity(record: dict[str, Any]) -> str:
    parts = [
        normalize_award_company(record.get("project")),
        normalize_award_company(record.get("client")),
        compact_text(record.get("date")),
        str(int(round(parse_float(record.get("amount_krw"))))),
        str(round(parse_float(record.get("floor_area_m2")), 2)),
        compact_text(record.get("source_url")),
    ]
    return "|".join(parts)


def collect_market_unit_cost_records(results: dict[str, Any]) -> list[dict[str, Any]]:
    rows_by_source: list[tuple[str, list[dict[str, Any]]]] = []

    for source_key, row_key, label in [
        ("cak", "rows", "시공능력"),
        ("cm", "rows", "CM"),
        ("kacem", "rows", "KACEM 분기"),
    ]:
        result = results.get(source_key)
        if isinstance(result, FetchResult) and result.ok and result.data:
            rows_by_source.append((label, result.data.get(row_key, [])))

    etis = results.get("etis")
    if isinstance(etis, FetchResult) and etis.ok and etis.data:
        rows_by_source.append(("ETIS 전체", etis.data.get("overall_rows", [])))
        rows_by_source.append(("ETIS 건설", etis.data.get("construction_rows", [])))

    unique: dict[str, dict[str, Any]] = {}
    for source_label, rows in rows_by_source:
        for row in rows:
            company = compact_text(row.get("company"))
            for record in trusted_unit_cost_records(row.get("unit_cost_records") or []):
                if not parse_float(record.get("unit_cost_krw_per_py")):
                    continue
                item = dict(record)
                item["company"] = company
                item["source_tab"] = source_label
                key = market_unit_cost_identity(item)
                if key not in unique:
                    unique[key] = item

    return sorted(
        unique.values(),
        key=lambda item: (award_date_key(item), parse_float(item.get("unit_cost_krw_per_py"))),
        reverse=True,
    )


def build_market_unit_cost_trend(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[int, list[float]] = {}
    for record in records:
        year = parse_int(record.get("year"))
        value = parse_float(record.get("unit_cost_krw_per_py"))
        if year and value:
            grouped.setdefault(year, []).append(value)

    trend = []
    for year, values in sorted(grouped.items()):
        trend.append(
            {
                "year": year,
                "count": len(values),
                "median_unit_cost_krw_per_py": int(round(median_number(values))),
                "min_unit_cost_krw_per_py": int(round(min(values))),
                "max_unit_cost_krw_per_py": int(round(max(values))),
            }
        )
    return trend


def build_market_unit_cost_data(results: dict[str, Any]) -> dict[str, Any]:
    records = collect_market_unit_cost_records(results)
    values_py = [parse_float(record.get("unit_cost_krw_per_py")) for record in records]
    values_m2 = [parse_float(record.get("unit_cost_krw_per_m2")) for record in records]
    values_py = [value for value in values_py if value > 0]
    values_m2 = [value for value in values_m2 if value > 0]
    companies = sorted({compact_text(record.get("company")) for record in records if compact_text(record.get("company"))})

    return {
        "title": "공사비 지표",
        "subtitle": "회사별 확인 단가와 시장 기준지표를 분리해 비교하는 탭입니다.",
        "record_count": len(records),
        "company_count": len(companies),
        "median_unit_cost_krw_per_py": int(round(median_number(values_py))) if values_py else 0,
        "median_unit_cost_krw_per_m2": int(round(median_number(values_m2))) if values_m2 else 0,
        "latest_record": records[0] if records else None,
        "records": records[:20],
        "trend": build_market_unit_cost_trend(records),
        "references": MARKET_UNIT_COST_REFERENCES,
        "indicators": load_market_indicators(),
    }


def load_market_indicators() -> dict[str, Any]:
    payload = read_json_file(MARKET_INDICATORS_CACHE_OUT)
    if payload.get("series"):
        return payload
    return {
        "generated_at": "",
        "status": "not_collected",
        "source_note": "KOSIS/국토부/조달청 시장 지표 캐시가 아직 생성되지 않았습니다.",
        "series": [
            {
                "id": "kosis_construction_cost_index_total",
                "group": "KOSIS",
                "label": "건설공사비지수",
                "unit": "2020=100",
                "frequency": "월",
                "source_name": "KOSIS/한국건설기술연구원",
                "source_url": "https://kosis.kr/serviceInfo/newContrainDataDetail.do?boardIdx=2004001&boardOrgId=397",
                "description": "KOSIS API 캐시 생성 후 월별 지수가 표시됩니다.",
                "points": [],
            },
            {
                "id": "molit_basic_construction_cost",
                "group": "MOLIT",
                "label": "기본형건축비",
                "unit": "만원/㎡",
                "frequency": "고시",
                "source_name": "국토교통부",
                "source_url": "https://www.molit.go.kr/USR/NEWS/m_71/dtl.jsp?id=95092223",
                "description": "국토교통부 고시 기준선입니다.",
                "points": [],
            },
            {
                "id": "pps_cost_square_status",
                "group": "PPS",
                "label": "조달청 공사비정보광장",
                "unit": "상태",
                "frequency": "원문 확인",
                "source_name": "조달청",
                "source_url": "https://pcae.g2b.go.kr",
                "description": "유형별 공사비 기준은 접근권한 확인 후 시계열화합니다.",
                "points": [],
                "status_note": "캐시 없음",
            },
        ],
        "errors": [],
    }


def market_indicator_series(indicators: dict[str, Any], series_id: str) -> dict[str, Any]:
    for series in indicators.get("series") or []:
        if compact_text(series.get("id")) == series_id:
            return series
    return {}


def market_indicator_points(series: dict[str, Any]) -> list[dict[str, Any]]:
    points = [point for point in series.get("points") or [] if parse_float(point.get("value")) > 0]
    return sorted(points, key=lambda item: compact_text(item.get("period")))


def latest_market_indicator_point(series: dict[str, Any]) -> dict[str, Any] | None:
    points = market_indicator_points(series)
    return points[-1] if points else None


def format_indicator_period(period: Any) -> str:
    text = compact_text(period)
    if re.fullmatch(r"\d{4}-\d{2}", text):
        return text.replace("-", ".")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text.replace("-", ".")
    return text


def format_market_indicator_value(series: dict[str, Any], value: Any) -> str:
    number = parse_float(value)
    unit = compact_text(series.get("unit"))
    if number <= 0:
        return "-"
    if unit == "2020=100":
        return f"{number:,.2f}"
    if unit == "만원/㎡":
        return f"{number:,.1f}만원/㎡"
    if unit == "억원":
        return f"{number:,.1f}억원"
    return f"{number:,.2f}"


def format_market_indicator_delta(point: dict[str, Any]) -> str:
    for key, label in [("yoy_pct", "YoY"), ("change_pct", "직전")]:
        value = parse_float(point.get(key))
        if value:
            sign = "+" if value > 0 else ""
            return f"{label} {sign}{value:.2f}%"
    count = parse_int(point.get("count"))
    if count:
        return f"{count:,}건"
    return ""


def format_market_indicator_base_change(series: dict[str, Any], point: dict[str, Any] | None) -> str:
    if compact_text(series.get("unit")) != "2020=100" or not point:
        return ""
    value = parse_float(point.get("value"))
    if value <= 0:
        return ""
    diff = value - 100
    sign = "+" if diff >= 0 else ""
    return f"2020년 평균 대비 {sign}{diff:.2f}%"


def market_indicator_anchor(series: dict[str, Any]) -> dict[str, Any]:
    base = series.get("base") if isinstance(series.get("base"), dict) else {}
    anchor = base.get("unit_cost_anchor") if isinstance(base.get("unit_cost_anchor"), dict) else {}
    return anchor


def format_market_anchor(anchor: dict[str, Any]) -> str:
    if not anchor:
        return ""
    period = format_indicator_period(anchor.get("period"))
    value = parse_float(anchor.get("value"))
    value_py = parse_float(anchor.get("value_py"))
    parts = []
    if period:
        parts.append(period)
    if value:
        parts.append(f"{value:,.1f}만원/㎡")
    if value_py:
        parts.append(f"{value_py:,.1f}만원/평")
    return " · ".join(parts)


def market_indicator_tooltip(series: dict[str, Any], point: dict[str, Any] | None = None) -> str:
    label = compact_text(series.get("label")) or "지표"
    unit = compact_text(series.get("unit"))
    source = compact_text(series.get("source_name"))
    frequency = compact_text(series.get("frequency"))
    description = compact_text(series.get("description"))
    point = point or latest_market_indicator_point(series)
    lines = [label]
    if point:
        latest = " ".join(
            part
            for part in [
                format_indicator_period(point.get("period")),
                format_market_indicator_value(series, point.get("value")),
                format_market_indicator_delta(point),
            ]
            if part
        )
        if latest:
            lines.append(f"최근값: {latest}")
    if unit == "2020=100":
        base = series.get("base") if isinstance(series.get("base"), dict) else {}
        lines.append(f"기준: {compact_text(base.get('label')) or '2020년 연평균=100'}")
        base_change = format_market_indicator_base_change(series, point)
        if base_change:
            lines.append(f"해석: {base_change}")
        meaning = compact_text(base.get("meaning")) or "지수는 단가 자체가 아니라 기준연도 대비 공사비 투입 가격 수준입니다."
        lines.append(meaning)
        anchor = market_indicator_anchor(series)
        anchor_text = format_market_anchor(anchor)
        if anchor_text:
            lines.append(f"단가 앵커: 국토부 기본형건축비 {anchor_text}")
            public_py = parse_float(anchor.get("public_py_amount"))
            if public_py:
                lines.append(f"공급면적 참고: {public_py:,.1f}만원/3.3㎡")
    elif unit == "만원/㎡":
        lines.append("기준: 분양가상한제 공동주택 기본형건축비")
        if point and compact_text(point.get("note")):
            lines.append(compact_text(point.get("note")))
        if point and parse_float(point.get("value_py")):
            lines.append(f"평 환산: {parse_float(point.get('value_py')):,.1f}만원/평")
    elif compact_text(series.get("id")) == "nara_public_contract_amount":
        lines.append("기준: 현재 대시보드 회사명 매칭 캐시의 월별 공사 계약금액 합계")
        lines.append("전체 나라장터 시장 통계가 아니라, 수집 대상 회사에 매칭된 공사 계약만 포함합니다.")
    elif compact_text(series.get("id")) == "pps_cost_square_status":
        lines.append(compact_text(series.get("status_note")) or "원문/접근권한 확인 후 자동 수집 연결이 필요합니다.")
    elif description:
        lines.append(description)
    source_line = " · ".join(part for part in [source, frequency] if part)
    if source_line:
        lines.append(f"출처: {source_line}")
    return "\n".join(line for line in lines if line)


def hover_detail_attrs(text: str) -> str:
    detail = "\n".join(compact_text(line) for line in str(text or "").splitlines() if compact_text(line))
    if not detail:
        return ""
    escaped = html.escape(detail, quote=True)
    return f' tabindex="0" title="{escaped}" data-tooltip="{escaped}"'


def render_kosis_basis_note(indicators: dict[str, Any]) -> str:
    kosis_total = market_indicator_series(indicators, "kosis_construction_cost_index_total")
    molit_basic = market_indicator_series(indicators, "molit_basic_construction_cost")
    latest_kosis = latest_market_indicator_point(kosis_total)
    latest_molit = latest_market_indicator_point(molit_basic)
    anchor = market_indicator_anchor(kosis_total)
    anchor_text = format_market_anchor(anchor)
    latest_kosis_value = format_market_indicator_value(kosis_total, latest_kosis.get("value")) if latest_kosis else "-"
    latest_kosis_period = format_indicator_period(latest_kosis.get("period")) if latest_kosis else "-"
    base_change = format_market_indicator_base_change(kosis_total, latest_kosis) or "2020년 평균 대비 변동률"
    latest_molit_text = ""
    if latest_molit:
        latest_molit_text = f"{format_indicator_period(latest_molit.get('period'))} {format_market_indicator_value(molit_basic, latest_molit.get('value'))}"
        if parse_float(latest_molit.get("value_py")):
            latest_molit_text += f" · {parse_float(latest_molit.get('value_py')):,.1f}만원/평"
    tooltip = market_indicator_tooltip(kosis_total, latest_kosis)
    return f"""
      <div class="market-basis-note has-hover-detail"{hover_detail_attrs(tooltip)}>
        <div>
          <span>KOSIS 기준</span>
          <strong>2020년 연평균 = 100</strong>
          <p>{html.escape(latest_kosis_period)} 건설공사비지수 {html.escape(latest_kosis_value)}는 {html.escape(base_change)}라는 뜻입니다. 지수는 단가 자체가 아니라 공사비 투입 가격의 상대 수준입니다.</p>
        </div>
        <dl>
          <div><dt>기준연도 단가 앵커</dt><dd>{html.escape(anchor_text or "-")}</dd></div>
          <div><dt>최근 기본형건축비</dt><dd>{html.escape(latest_molit_text or "-")}</dd></div>
        </dl>
      </div>
    """


def render_market_indicator_card(series: dict[str, Any], *, emphasis: bool = False) -> str:
    point = latest_market_indicator_point(series)
    label = compact_text(series.get("label")) or "-"
    group = compact_text(series.get("group")) or compact_text(series.get("source_name")) or "지표"
    source_url = compact_text(series.get("source_url"))
    source_name = compact_text(series.get("source_name")) or "원문"
    source_html = html.escape(source_name)
    if source_url:
        source_html = f'<a href="{html.escape(source_url)}" target="_blank" rel="noreferrer">{html.escape(source_name)}</a>'
    class_name = "market-indicator-card is-emphasis" if emphasis else "market-indicator-card"
    if not point:
        status = compact_text(series.get("status_note")) or "수집 대기"
        return f"""
        <article class="{class_name} is-empty has-hover-detail"{hover_detail_attrs(market_indicator_tooltip(series))}>
          <span>{html.escape(group)}</span>
          <strong>{html.escape(label)}</strong>
          <p>{html.escape(status)}</p>
          <footer>{source_html}</footer>
        </article>
        """

    value = format_market_indicator_value(series, point.get("value"))
    period = format_indicator_period(point.get("period"))
    delta = format_market_indicator_delta(point)
    caption = " · ".join(part for part in [period, delta] if part)
    if compact_text(series.get("unit")) == "만원/㎡" and parse_float(point.get("value_py")):
        caption = " · ".join(part for part in [caption, f"{parse_float(point.get('value_py')):,.1f}만원/평"] if part)
    return f"""
    <article class="{class_name} has-hover-detail"{hover_detail_attrs(market_indicator_tooltip(series, point))}>
      <span>{html.escape(group)}</span>
      <strong>{html.escape(value)}</strong>
      <p>{html.escape(label)} · {html.escape(caption)}</p>
      <footer>{source_html}</footer>
    </article>
    """


def render_market_indicator_chart(series: dict[str, Any], *, limit: int = 18) -> str:
    points = market_indicator_points(series)[-limit:]
    label = compact_text(series.get("label")) or "지표"
    frequency = compact_text(series.get("frequency")) or ""
    if not points:
        return f"""
        <section class="market-indicator-chart empty">
          <div class="market-cost-section-head">
            <h3>{html.escape(label)}</h3>
            <span>{html.escape(frequency or "수집 대기")}</span>
          </div>
          <p>{html.escape(compact_text(series.get("status_note")) or "표시할 시계열 데이터가 아직 없습니다.")}</p>
        </section>
        """

    values = [parse_float(point.get("value")) for point in points]
    min_value = min(values)
    max_value = max(values)
    span = max(max_value - min_value, 1)
    bars = []
    for point in points:
        value = parse_float(point.get("value"))
        height = 22 + int(round(((value - min_value) / span) * 78))
        bars.append(
            f"""
            <div class="market-indicator-bar has-hover-detail" style="--h:{height}%"{hover_detail_attrs(market_indicator_tooltip(series, point))}>
              <span></span>
              <strong>{html.escape(format_indicator_period(point.get("period")))}</strong>
              <em>{html.escape(format_market_indicator_value(series, value))}</em>
              <small>{html.escape(format_market_indicator_delta(point))}</small>
            </div>
            """
        )
    return f"""
    <section class="market-indicator-chart">
      <div class="market-cost-section-head">
        <h3>{html.escape(label)}</h3>
        <span>{html.escape(frequency)}</span>
      </div>
      <div class="market-indicator-bars">{"".join(bars)}</div>
    </section>
    """


def render_kosis_category_strip(indicators: dict[str, Any]) -> str:
    series_items = [
        series
        for series in indicators.get("series") or []
        if compact_text(series.get("group")) == "KOSIS"
        and compact_text(series.get("id")) != "kosis_construction_cost_index_total"
    ]
    if not series_items:
        return ""
    cards = []
    for series in series_items[:4]:
        point = latest_market_indicator_point(series)
        if not point:
            continue
        cards.append(
            f"""
            <li class="has-hover-detail"{hover_detail_attrs(market_indicator_tooltip(series, point))}>
              <span>{html.escape(compact_text(series.get("label")))}</span>
              <strong>{html.escape(format_market_indicator_value(series, point.get("value")))}</strong>
              <em>{html.escape(format_market_indicator_delta(point))}</em>
            </li>
            """
        )
    if not cards:
        return ""
    return f"""
    <section class="market-indicator-strip">
      <div class="market-cost-section-head">
        <h3>KOSIS 세부 지수</h3>
        <span>최근월</span>
      </div>
      <ul>{"".join(cards)}</ul>
    </section>
    """


def render_market_indicator_panel(indicators: dict[str, Any]) -> str:
    kosis_total = market_indicator_series(indicators, "kosis_construction_cost_index_total")
    molit_basic = market_indicator_series(indicators, "molit_basic_construction_cost")
    nara_amount = market_indicator_series(indicators, "nara_public_contract_amount")
    pps_status = market_indicator_series(indicators, "pps_cost_square_status")
    generated_at = compact_text(indicators.get("generated_at")) or "캐시 없음"
    status = compact_text(indicators.get("status")) or "unknown"
    errors = indicators.get("errors") or []
    error_html = ""
    if errors:
        error_html = f'<p class="market-indicator-error">{html.escape(" / ".join(compact_text(error) for error in errors if compact_text(error)))}</p>'

    return f"""
    <section class="market-indicators">
      <div class="market-cost-section-head">
        <h3>시장 기준지표</h3>
        <span>{html.escape(status)} · {html.escape(generated_at)}</span>
      </div>
      {error_html}
      {render_kosis_basis_note(indicators)}
      <div class="market-indicator-cards">
        {render_market_indicator_card(kosis_total, emphasis=True)}
        {render_market_indicator_card(molit_basic)}
        {render_market_indicator_card(nara_amount)}
        {render_market_indicator_card(pps_status)}
      </div>
      <div class="market-indicator-grid">
        {render_market_indicator_chart(kosis_total)}
        {render_market_indicator_chart(molit_basic, limit=8)}
      </div>
      <div class="market-indicator-grid">
        {render_market_indicator_chart(nara_amount, limit=12)}
        {render_kosis_category_strip(indicators)}
      </div>
    </section>
    """


def render_award_metrics(award: dict[str, Any]) -> str:
    metrics = []
    amount = compact_text(award.get("amount"))
    area = format_area(award.get("floor_area_m2"))
    unit_m2 = format_unit_cost(award.get("unit_cost_krw_per_m2"))
    unit_py = format_unit_cost(award.get("unit_cost_krw_per_py")).replace("/㎡", "/평")
    for label, value in [
        ("금액", amount),
        ("연면적", area),
        ("단가", unit_m2),
        ("평단가", unit_py),
    ]:
        if value:
            metrics.append(f'<span><em>{html.escape(label)}</em>{html.escape(value)}</span>')
    if not metrics:
        metrics.append("<span><em>단가</em>산정 불가</span>")
    return f'<div class="award-metrics">{"".join(metrics)}</div>'


def render_recent_awards(row: dict[str, Any]) -> str:
    awards = row.get("recent_awards") or []
    source = row.get("recent_awards_source") or {}
    source_name = source.get("name") or "외부 소스"
    source_url = source.get("url") or ""
    source_link = ""
    if source_url:
        source_link = (
            f'<a href="{html.escape(source_url)}" target="_blank" rel="noreferrer">'
            f"{html.escape(source_name)}</a>"
        )
    else:
        source_link = html.escape(source_name)

    if not awards:
        if row.get("recent_awards_status") == "source_only":
            message = f"{source_link} 매핑은 있으나, 캐시에 표시할 최근 수주 항목이 아직 없습니다."
        else:
            message = "아직 매핑된 최근 수주 데이터가 없습니다."
        return f"""
        <section class="detail-feed recent-awards empty">
          <div class="detail-feed-head recent-awards-head">
            <h3>최근 수주/계약 5건</h3>
          </div>
          <p>{message}</p>
        </section>
        """

    items = []
    for award in awards[:5]:
        project = html.escape(compact_text(award.get("project")) or "-")
        client = html.escape(compact_text(award.get("client")) or "-")
        category = html.escape(compact_text(award.get("category")) or "수주")
        date = html.escape(compact_text(award.get("date")) or "")
        award_url = compact_text(award.get("source_url")) or source_url
        source_badge = html.escape(compact_text(award.get("source_name")) or source_name)
        if award_url:
            source_badge = (
                f'<a href="{html.escape(award_url)}" target="_blank" rel="noreferrer">{source_badge}</a>'
            )
        meta = " · ".join(part for part in [date, category] if part)
        meta_class = online_update_meta_class(row, "award", award, "item-meta")
        metrics = render_award_metrics(award)
        items.append(
            f"""
            <li>
              <div class="award-main">
                {f'<span class="{meta_class}">{html.escape(meta)}</span>' if meta else ''}
                <strong>{project}</strong>
                <span class="item-subtitle">{client}</span>
              </div>
              {metrics}
              <div class="award-meta">{source_badge}</div>
            </li>
            """
        )
    return f"""
    <section class="detail-feed recent-awards">
      <div class="detail-feed-head recent-awards-head">
        <h3>최근 수주/계약 5건</h3>
        <span>{source_link}</span>
      </div>
      <ul>{"".join(items)}</ul>
    </section>
    """


def render_related_articles(row: dict[str, Any]) -> str:
    articles = row.get("related_articles") or []
    source = row.get("related_articles_source") or {}
    source_name = source.get("name") or "뉴스"
    source_url = source.get("url") or ""
    source_link = html.escape(source_name)
    if source_url:
        source_link = f'<a href="{html.escape(source_url)}" target="_blank" rel="noreferrer">{source_link}</a>'

    if not articles:
        return f"""
        <section class="detail-feed related-news empty">
          <div class="detail-feed-head recent-awards-head">
            <h3>기사/전략 정보 5건</h3>
          </div>
          <p>아직 매핑된 관련 기사 또는 전략공시가 없습니다.</p>
        </section>
        """

    items = []
    for article in articles[:5]:
        title = html.escape(compact_text(article.get("title")) or "-")
        link = compact_text(article.get("url")) or "#"
        source_label = html.escape(compact_text(article.get("source")) or "뉴스")
        published = html.escape(compact_text(article.get("published")) or "")
        summary = html.escape(compact_text(article.get("summary")) or "")
        meta = " · ".join(part for part in [published, source_label] if part)
        meta_class = online_update_meta_class(row, "article", article, "news-meta")
        items.append(
            f"""
            <li>
              {f'<span class="{meta_class}">{html.escape(meta)}</span>' if meta else ''}
              <a href="{html.escape(link)}" target="_blank" rel="noreferrer">{title}</a>
              {f'<p>{summary}</p>' if summary else ''}
            </li>
            """
        )
    return f"""
    <section class="detail-feed related-news">
      <div class="detail-feed-head recent-awards-head">
        <h3>기사/전략 정보 5건</h3>
        <span>{source_link}</span>
      </div>
      <ul>{"".join(items)}</ul>
    </section>
    """


def format_amount_krw(value: Any) -> str:
    amount = parse_float(value)
    if amount <= 0:
        return ""
    if amount >= 100_000_000:
        return f"{amount / 100_000_000:,.0f}억원"
    return f"{amount:,.0f}원"


def render_confidence_pill(record: dict[str, Any]) -> str:
    confidence = css_token(compact_text(record.get("confidence")) or "low")
    label = compact_text(record.get("confidence_label")) or "Low"
    return f'<span class="unit-cost-confidence confidence-{html.escape(confidence)}">{html.escape(label)}</span>'


def render_unit_cost_entry(row: dict[str, Any], detail_id: str) -> str:
    records = row.get("unit_cost_records") or []
    representative = row.get("representative_unit_cost") or {}
    summary = row.get("unit_cost_summary") or {}
    trusted_count = len(trusted_unit_cost_records(records))
    template_id = f"{detail_id}-unit-cost"

    if representative:
        button_class = "unit-cost-button"
        primary = format_unit_cost_py(representative.get("unit_cost_krw_per_py")) or "단가 확인"
        secondary = " · ".join(
            part
            for part in [
                compact_text(representative.get("date")),
                compact_text(representative.get("confidence_label")),
                f"확인 {trusted_count}건",
            ]
            if part
        )
    else:
        button_class = "unit-cost-button is-empty"
        primary = "단가 후보 없음"
        secondary = (
            f"계산 {summary.get('calculated', 0)}건 · "
            f"면적 미확인 {summary.get('area_missing', 0)}건"
        )

    return f"""
    <div class="unit-cost-entry">
      <button class="{button_class}" type="button" data-unit-cost-template="{html.escape(template_id)}">
        <span>공사비 단가</span>
        <strong>{html.escape(primary)}</strong>
        <em>{html.escape(secondary)}</em>
      </button>
      <template id="{html.escape(template_id)}">{render_unit_cost_modal_content(row)}</template>
    </div>
    """


def render_unit_cost_hero(row: dict[str, Any]) -> str:
    record = row.get("representative_unit_cost") or {}
    summary = row.get("unit_cost_summary") or {}
    if not record:
        total = summary.get("total", 0)
        area_missing = summary.get("area_missing", 0)
        unsuitable = summary.get("unsuitable", 0)
        return f"""
        <section class="unit-cost-hero empty">
          <div>
            <p>최근 신뢰 단가</p>
            <h3>아직 계산 가능한 단가가 없습니다.</h3>
          </div>
          <dl>
            <div><dt>검토 수주</dt><dd>{html.escape(str(total))}건</dd></div>
            <div><dt>면적 미확인</dt><dd>{html.escape(str(area_missing))}건</dd></div>
            <div><dt>면적단가 부적합</dt><dd>{html.escape(str(unsuitable))}건</dd></div>
          </dl>
        </section>
        """

    source_url = compact_text(record.get("source_url"))
    source_name = compact_text(record.get("source_name")) or "원문"
    source_html = html.escape(source_name)
    if source_url:
        source_html = f'<a href="{html.escape(source_url)}" target="_blank" rel="noreferrer">{source_html}</a>'
    return f"""
    <section class="unit-cost-hero">
      <div>
        <p>최근 신뢰 단가</p>
        <h3>{html.escape(format_unit_cost_py(record.get("unit_cost_krw_per_py")) or "-")}</h3>
        <span>{html.escape(compact_text(record.get("project")) or "-")}</span>
      </div>
      <dl>
        <div><dt>공시/계약일</dt><dd>{html.escape(compact_text(record.get("date")) or "-")}</dd></div>
        <div><dt>공사총액</dt><dd>{html.escape(compact_text(record.get("amount")) or format_amount_krw(record.get("amount_krw")) or "-")}</dd></div>
        <div><dt>확인 연면적</dt><dd>{html.escape(format_area(record.get("floor_area_m2")) or "-")}</dd></div>
        <div><dt>㎡당 단가</dt><dd>{html.escape(format_unit_cost(record.get("unit_cost_krw_per_m2")) or "-")}</dd></div>
        <div><dt>면적 출처</dt><dd>{source_html}</dd></div>
        <div><dt>신뢰도</dt><dd>{render_confidence_pill(record)}</dd></div>
      </dl>
    </section>
    """


def render_unit_cost_chart(row: dict[str, Any]) -> str:
    trend = row.get("unit_cost_trend") or []
    if not trend:
        return """
        <section class="unit-cost-chart-wrap empty">
          <div class="unit-cost-section-head">
            <h3>연도별 단가 추이</h3>
            <span>High/Medium 기준</span>
          </div>
          <p>연도별로 비교할 수 있는 신뢰 단가 표본이 아직 없습니다.</p>
        </section>
        """

    max_value = max(parse_float(point.get("median_unit_cost_krw_per_py")) for point in trend) or 1
    bars = []
    for point in trend:
        value = parse_float(point.get("median_unit_cost_krw_per_py"))
        height = max(8, min(100, int(round((value / max_value) * 100))))
        bars.append(
            f"""
            <div class="unit-cost-chart-bar" style="--h:{height}%">
              <span></span>
              <strong>{html.escape(str(point.get("year") or ""))}</strong>
              <em>{html.escape(format_unit_cost_py(value))}</em>
              <small>{html.escape(str(point.get("count") or 0))}건</small>
            </div>
            """
        )
    return f"""
    <section class="unit-cost-chart-wrap">
      <div class="unit-cost-section-head">
        <h3>연도별 단가 추이</h3>
        <span>신뢰 단가 중앙값</span>
      </div>
      <div class="unit-cost-chart">{"".join(bars)}</div>
    </section>
    """


def render_unit_cost_record_list(row: dict[str, Any]) -> str:
    records = trusted_unit_cost_records(row.get("unit_cost_records") or [])
    if not records:
        return """
        <section class="unit-cost-records empty">
          <div class="unit-cost-section-head">
            <h3>확인 근거</h3>
            <span>최근 5년</span>
          </div>
          <p>금액과 연면적을 함께 확인한 수주가 아직 없습니다. 다음 면적 보강 단계에서 건축HUB, 인허가, 정비사업 공고를 조합해 후보를 늘릴 수 있습니다.</p>
        </section>
        """

    items = []
    for record in records[:10]:
        source_url = compact_text(record.get("source_url"))
        source_name = html.escape(compact_text(record.get("source_name")) or "원문")
        source = source_name
        if source_url:
            source = f'<a href="{html.escape(source_url)}" target="_blank" rel="noreferrer">{source_name}</a>'
        meta = " · ".join(
            part
            for part in [
                compact_text(record.get("date")),
                compact_text(record.get("area_source")),
                compact_text(record.get("area_basis")),
            ]
            if part
        )
        items.append(
            f"""
            <li>
              <div class="unit-cost-record-main">
                <span>{html.escape(meta)}</span>
                <strong>{html.escape(compact_text(record.get("project")) or "-")}</strong>
                <p>{html.escape(compact_text(record.get("client")) or "-")}</p>
                <div>{render_confidence_pill(record)}{source}</div>
              </div>
              <dl>
                <div><dt>총액</dt><dd>{html.escape(compact_text(record.get("amount")) or format_amount_krw(record.get("amount_krw")) or "-")}</dd></div>
                <div><dt>연면적</dt><dd>{html.escape(format_area(record.get("floor_area_m2")) or "-")}</dd></div>
                <div><dt>평단가</dt><dd>{html.escape(format_unit_cost_py(record.get("unit_cost_krw_per_py")) or "-")}</dd></div>
              </dl>
            </li>
            """
        )
    return f"""
    <section class="unit-cost-records">
      <div class="unit-cost-section-head">
        <h3>확인 근거</h3>
        <span>최근 5년 · {html.escape(str(len(records)))}건</span>
      </div>
      <ul>{"".join(items)}</ul>
    </section>
    """


def render_unit_cost_modal_content(row: dict[str, Any]) -> str:
    company = compact_text(row.get("company")) or "회사"
    summary = row.get("unit_cost_summary") or {}
    records = row.get("unit_cost_records") or []
    trusted_count = len(trusted_unit_cost_records(records))
    return f"""
    <div class="unit-cost-modal-content">
      <div class="unit-cost-modal-head">
        <div>
          <p>공사비 단가</p>
          <h2>{html.escape(company)}</h2>
        </div>
        <span>신뢰 {html.escape(str(trusted_count))}건 / 계산 {html.escape(str(summary.get("calculated", 0)))}건</span>
      </div>
      {render_unit_cost_hero(row)}
      {render_unit_cost_chart(row)}
      {render_unit_cost_record_list(row)}
    </div>
    """


def render_market_metric_card(label: str, value: str, caption: str, *, emphasis: bool = False) -> str:
    class_name = "market-cost-card is-emphasis" if emphasis else "market-cost-card"
    return f"""
    <article class="{class_name}">
      <span>{html.escape(label)}</span>
      <strong>{html.escape(value or "-")}</strong>
      <p>{html.escape(caption)}</p>
    </article>
    """


def render_market_latest_record(record: dict[str, Any] | None) -> str:
    if not record:
        return """
        <section class="market-cost-latest empty">
          <div class="market-cost-section-head">
            <h3>최근 확인 단가</h3>
            <span>High/Medium 기준</span>
          </div>
          <p>아직 공사총액과 연면적이 함께 확인된 표본이 없습니다.</p>
        </section>
        """

    source_url = compact_text(record.get("source_url"))
    source_name = html.escape(compact_text(record.get("source_name")) or "원문")
    source = source_name
    if source_url:
        source = f'<a href="{html.escape(source_url)}" target="_blank" rel="noreferrer">{source_name}</a>'
    meta = " · ".join(
        part
        for part in [
            compact_text(record.get("date")),
            compact_text(record.get("company")),
            compact_text(record.get("source_tab")),
        ]
        if part
    )
    return f"""
    <section class="market-cost-latest">
      <div class="market-cost-section-head">
        <h3>최근 확인 단가</h3>
        <span>{render_confidence_pill(record)}</span>
      </div>
      <div>
        <span>{html.escape(meta)}</span>
        <strong>{html.escape(format_unit_cost_py(record.get("unit_cost_krw_per_py")) or "-")}</strong>
        <p>{html.escape(compact_text(record.get("project")) or "-")}</p>
        <dl>
          <div><dt>공사총액</dt><dd>{html.escape(compact_text(record.get("amount")) or format_amount_krw(record.get("amount_krw")) or "-")}</dd></div>
          <div><dt>연면적</dt><dd>{html.escape(format_area(record.get("floor_area_m2")) or "-")}</dd></div>
          <div><dt>근거</dt><dd>{source}</dd></div>
        </dl>
      </div>
    </section>
    """


def render_market_unit_cost_trend(data: dict[str, Any]) -> str:
    trend = data.get("trend") or []
    if not trend:
        return """
        <section class="market-cost-trend empty">
          <div class="market-cost-section-head">
            <h3>확인 단가 추이</h3>
            <span>연도별 중앙값</span>
          </div>
          <p>연도별 비교에 필요한 신뢰 단가 표본이 아직 없습니다.</p>
        </section>
        """

    max_value = max(parse_float(point.get("median_unit_cost_krw_per_py")) for point in trend) or 1
    bars = []
    for point in trend:
        value = parse_float(point.get("median_unit_cost_krw_per_py"))
        height = max(8, min(100, int(round((value / max_value) * 100))))
        bars.append(
            f"""
            <div class="market-cost-bar" style="--h:{height}%">
              <span></span>
              <strong>{html.escape(str(point.get("year") or ""))}</strong>
              <em>{html.escape(format_unit_cost_py(value))}</em>
              <small>{html.escape(str(point.get("count") or 0))}건</small>
            </div>
            """
        )
    return f"""
    <section class="market-cost-trend">
      <div class="market-cost-section-head">
        <h3>확인 단가 추이</h3>
        <span>연도별 중앙값</span>
      </div>
      <div class="market-cost-chart">{"".join(bars)}</div>
    </section>
    """


def render_market_unit_cost_records(data: dict[str, Any]) -> str:
    records = data.get("records") or []
    if not records:
        return """
        <section class="market-cost-records empty">
          <div class="market-cost-section-head">
            <h3>최근 근거</h3>
            <span>최신순</span>
          </div>
          <p>표시할 확인 단가 근거가 없습니다.</p>
        </section>
        """

    items = []
    for record in records[:5]:
        source_url = compact_text(record.get("source_url"))
        source_name = html.escape(compact_text(record.get("source_name")) or "원문")
        source = source_name
        if source_url:
            source = f'<a href="{html.escape(source_url)}" target="_blank" rel="noreferrer">{source_name}</a>'
        meta = " · ".join(
            part
            for part in [
                compact_text(record.get("date")),
                compact_text(record.get("company")),
                compact_text(record.get("source_tab")),
            ]
            if part
        )
        items.append(
            f"""
            <li>
              <div>
                <span>{html.escape(meta)}</span>
                <strong>{html.escape(compact_text(record.get("project")) or "-")}</strong>
                <p>{html.escape(compact_text(record.get("client")) or "-")}</p>
              </div>
              <dl>
                <div><dt>평단가</dt><dd>{html.escape(format_unit_cost_py(record.get("unit_cost_krw_per_py")) or "-")}</dd></div>
                <div><dt>㎡단가</dt><dd>{html.escape(format_unit_cost(record.get("unit_cost_krw_per_m2")) or "-")}</dd></div>
                <div><dt>근거</dt><dd>{source}</dd></div>
              </dl>
            </li>
            """
        )
    return f"""
    <section class="market-cost-records">
      <div class="market-cost-section-head">
        <h3>최근 근거</h3>
        <span>최신 5건</span>
      </div>
      <ul>{"".join(items)}</ul>
    </section>
    """


def render_market_reference_sources(data: dict[str, Any]) -> str:
    items = []
    for source in data.get("references") or []:
        url = compact_text(source.get("url"))
        name = html.escape(compact_text(source.get("name")) or "-")
        name_html = name
        if url:
            name_html = f'<a href="{html.escape(url)}" target="_blank" rel="noreferrer">{name}</a>'
        items.append(
            f"""
            <li>
              <div>
                <span>{html.escape(compact_text(source.get("status")) or "참조")}</span>
                <strong>{name_html}</strong>
              </div>
              <p>{html.escape(compact_text(source.get("description")) or "")}</p>
              <footer>
                <span>{html.escape(compact_text(source.get("role")) or "-")}</span>
                <span>{html.escape(compact_text(source.get("update_cycle")) or "-")}</span>
              </footer>
            </li>
            """
        )
    return f"""
    <section class="market-cost-sources">
      <div class="market-cost-section-head">
        <h3>기준 지표 소스</h3>
        <span>연결 후보</span>
      </div>
      <ul>{"".join(items)}</ul>
    </section>
    """


def render_market_unit_cost_panel(data: dict[str, Any]) -> str:
    latest = data.get("latest_record")
    record_count = parse_int(data.get("record_count"))
    company_count = parse_int(data.get("company_count"))
    median_py = format_unit_cost_py(data.get("median_unit_cost_krw_per_py"))
    median_m2 = format_unit_cost(data.get("median_unit_cost_krw_per_m2"))
    return f"""
    <div class="market-cost-tab">
      {render_market_indicator_panel(data.get("indicators") or load_market_indicators())}
      <section class="market-cost-group-title">
        <div>
          <span>Company Unit Cost</span>
          <h3>회사별 확인 단가</h3>
        </div>
        <p>공사총액과 연면적이 함께 확인된 수주건만 계산합니다.</p>
      </section>
      <section class="market-cost-summary" aria-label="공사비 단가 요약">
        {render_market_metric_card("확인 단가", f"{record_count:,}건", "공사총액과 연면적을 함께 확인한 표본", emphasis=True)}
        {render_market_metric_card("대상 회사", f"{company_count:,}개", "상위표 안에서 신뢰 단가가 있는 회사")}
        {render_market_metric_card("중앙 평단가", median_py, "현재 확인 표본의 중앙값")}
        {render_market_metric_card("중앙 ㎡단가", median_m2, "평단가와 함께 보는 면적 단가")}
      </section>
      <div class="market-cost-main">
        {render_market_latest_record(latest)}
        {render_market_unit_cost_trend(data)}
      </div>
      <div class="market-cost-main">
        {render_market_unit_cost_records(data)}
        {render_market_reference_sources(data)}
      </div>
      <section class="market-cost-method">
        <strong>단가 산정 기준</strong>
        <p>회사별 수주건은 공사총액과 연면적이 함께 확인된 경우에만 실측 단가로 집계합니다. KOSIS 건설공사비지수, 국토교통부 기본형건축비, 나라장터 월별 계약액은 시장 기준지표로 분리하고, 조달청/서울시/건축HUB는 단가와 면적 보강 후보로 관리합니다.</p>
      </section>
    </div>
    """


CREDIT_PRODUCT_LABELS = {
    "company_bond": "회사채",
    "company_bond_alt": "회사채",
    "corporate_credit": "기업신용등급",
    "commercial_paper": "기업어음",
    "short_term_bond": "단기사채",
    "dart_bond": "DART 채무증권",
    "abs": "ABS",
    "ifsr": "보험금지급능력",
}


def rating_product_label(value: Any) -> str:
    key = compact_text(value)
    if not key:
        return ""
    return CREDIT_PRODUCT_LABELS.get(key, key)


def render_rating_item(item: dict[str, Any]) -> str:
    rating = compact_text(item.get("rating"))
    if not rating:
        return ""
    outlook = compact_text(item.get("outlook"))
    label = f"{rating} / {outlook}" if outlook else rating
    agency = compact_text(item.get("agency"))
    product = rating_product_label(item.get("product"))
    date = compact_text(item.get("date"))
    meta = " · ".join(part for part in [agency, product, date] if part)
    source_url = compact_text(item.get("source_url"))
    badge = f'<span class="rating-pill {rating_tone_class(label)} small">{html.escape(label)}</span>'
    if source_url:
        badge = f'<a href="{html.escape(source_url)}" target="_blank" rel="noreferrer">{badge}</a>'
    return f"<li>{badge}<span>{html.escape(meta)}</span></li>"


def render_credit_rating(row: dict[str, Any]) -> str:
    if "credit_rating_status" not in row:
        return ""

    label = compact_text(row.get("credit_rating_label")) or "미확인"
    status = compact_text(row.get("credit_rating_status")) or "empty"
    updated_at = compact_text(row.get("credit_rating_updated_at"))
    representative = row.get("credit_rating_representative") or {}
    sources = row.get("credit_rating_sources") or []
    messages = row.get("credit_rating_messages") or []
    rep_meta = " · ".join(
        part
        for part in [
            compact_text(representative.get("agency")),
            rating_product_label(representative.get("product")),
            compact_text(representative.get("source")),
        ]
        if part
    )
    if updated_at:
        rep_meta = f"{rep_meta} · 갱신 {updated_at}" if rep_meta else f"갱신 {updated_at}"

    source_items = []
    for source in sources:
        source_name = compact_text(source.get("source")) or "외부 소스"
        matched_name = compact_text(source.get("matched_name"))
        ok_label = "확인" if source.get("ok") else "미확인"
        message = compact_text(source.get("message"))
        if message.lower() == "ok":
            message = ""
        source_meta = " · ".join(part for part in [matched_name, message] if part)
        rating_items = "".join(render_rating_item(item) for item in (source.get("items") or [])[:4])
        if not rating_items:
            rating_items = '<li><span class="rating-pill empty small">미확인</span><span>공개 등급 필드가 비어 있습니다.</span></li>'
        source_items.append(
            f"""
            <li>
              <div class="credit-source-head">
                <strong>{html.escape(source_name)}</strong>
                <span class="source-state">{html.escape(ok_label)}</span>
              </div>
              {f'<p>{html.escape(source_meta)}</p>' if source_meta else ''}
              <ul>{rating_items}</ul>
            </li>
            """
        )

    message_html = ""
    if status != "ready" and messages:
        message_html = "<p>" + html.escape(" / ".join(compact_text(message) for message in messages[:3] if compact_text(message))) + "</p>"

    return f"""
    <section class="credit-ratings status-{html.escape(css_token(status))}">
      <div class="credit-rating-head">
        <div>
          <h3>신용등급</h3>
          {f'<p>{html.escape(rep_meta)}</p>' if rep_meta else ''}
        </div>
        <span class="rating-pill {rating_tone_class(label)}">{html.escape(label)}</span>
      </div>
      {message_html}
      <ul class="credit-source-list">{"".join(source_items)}</ul>
    </section>
    """


def render_comment_box(row: dict[str, Any]) -> str:
    company = compact_text(row.get("company"))
    key = normalize_award_company(company)
    source = PDF_COMMENTS.get("source") or {}
    seed_items = []
    for item in get_pdf_comments(key):
        author = compact_text(item.get("author") or source.get("author") or DEFAULT_COMMENT_AUTHOR)
        date = compact_text(item.get("date") or source.get("date"))
        interviewee_role = compact_text(item.get("interviewee_role"))
        meta = " · ".join(part for part in [date, interviewee_role] if part)
        seed_items.append(
            f"""
        <li data-seed-comment="true">
          <div class="comment-meta">
            <span class="comment-author">{html.escape(author)}</span>
            {f'<span>{html.escape(meta)}</span>' if meta else ''}
          </div>
          <p>{html.escape(seed_comment_text(item.get("text")))}</p>
        </li>
            """
        )
    empty_attr = " hidden" if seed_items else ""
    return f"""
    <section class="company-comment" data-comment-key="company-comment:{html.escape(key)}" data-company-key="{html.escape(key)}" data-company-name="{html.escape(company)}">
      <div>
        <h3>Comment</h3>
        <p class="comment-saved" aria-live="polite"></p>
        <div class="comment-auth" data-comment-auth>
          <span class="comment-auth-status">로그인 확인 중</span>
          <a class="comment-login-link" href="./login.html?redirect=./">로그인</a>
          <button class="comment-logout-button" type="button" hidden>로그아웃</button>
        </div>
      </div>
      <div class="comment-list-wrap">
        <ul class="comment-list">{''.join(seed_items)}</ul>
        <p class="comment-empty"{empty_attr}>아직 코멘트가 없습니다.</p>
      </div>
      <div class="comment-controls">
        <div class="comment-relationship">
          <label class="comment-check-field">
            <input class="comment-collaboration-input" type="checkbox" aria-label="우리회사 협업사">
            <span>우리회사 협업사</span>
          </label>
          <label class="comment-project-field">
            <span>관련 프로젝트</span>
            <input class="comment-project-input" type="text" placeholder="프로젝트명 입력(선택)" aria-label="관련 프로젝트">
          </label>
        </div>
        <label class="comment-author-field">
          <span>작성자</span>
          <input type="text" value="" placeholder="실명/소속 입력(선택)" aria-label="작성자">
        </label>
        <textarea rows="2" placeholder="{html.escape(company)}에 대한 메모를 남기세요."></textarea>
        <button type="button">저장</button>
      </div>
    </section>
    """


def render_detail_panel(row: dict[str, Any], fields: list[tuple[str, str, str]], detail_id: str) -> str:
    items = []
    for key, label, kind in fields:
        items.append(
            f"""
            <div class="detail-item">
              <dt>{html.escape(label)}</dt>
              <dd>{render_value(row.get(key), kind)}</dd>
            </div>
            """
        )
    return f"""
    <div class="detail-summary">
      <dl class="detail-grid">{"".join(items)}</dl>
      {render_unit_cost_entry(row, detail_id)}
    </div>
    <div class="detail-split">
      {render_recent_awards(row)}
      {render_related_articles(row)}
    </div>
    {render_comment_box(row)}
    """


def render_rank_table(
    rows: list[dict[str, Any]],
    columns: list[tuple[str, str, str]],
    table_id: str,
    amount_key: str | None = None,
    detail_fields: list[tuple[str, str, str]] | None = None,
) -> str:
    columns = add_status_column(columns)
    max_amount = max((parse_int(row.get(amount_key)) for row in rows), default=0) if amount_key else 0
    head = "".join(
        f'<th scope="col" class="col-{css_token(key)} cell-{css_token(kind)}">{html.escape(label)}</th>'
        for key, label, kind in columns
    )
    body_rows = []
    detail_fields = detail_fields or []
    for index, row in enumerate(rows, 1):
        detail_id = f"{table_id}-detail-{index}"
        cells = []
        for key, _, kind in columns:
            if key == "row_status":
                content = render_row_status(row)
            elif key == "recent_update":
                content = render_recent_update(row)
            else:
                content = render_value(row.get(key, ""), kind, max_amount)
            if key == "company":
                content = (
                    f'<button class="row-toggle" type="button" aria-expanded="false" '
                    f'aria-controls="{html.escape(detail_id)}">'
                    f'<span class="toggle-symbol" aria-hidden="true"></span>'
                    f'<span class="company-name">{content}</span>'
                    f"{render_company_update_card(row)}"
                    f"</button>"
                )
            cell_class = f'col-{css_token(key)} cell-{css_token(kind)}'
            cells.append(f'<td class="{cell_class}">{content}</td>')
        body_rows.append(
            f'<tr class="rank-row" data-detail-row="{html.escape(detail_id)}" aria-expanded="false">'
            f"{''.join(cells)}</tr>"
        )
        if detail_fields:
            body_rows.append(
                f'<tr id="{html.escape(detail_id)}" class="detail-row" hidden>'
                f'<td colspan="{len(columns)}"><div class="detail-panel">{render_detail_panel(row, detail_fields, detail_id)}</div></td>'
                f"</tr>"
            )
    return (
        f'<table class="rank-table" data-table-id="{html.escape(table_id)}">'
        f"<thead><tr>{head}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>"
    )


def tab_panel(tab_id: str, title: str, subtitle: str, table: str, source_url: str, active: bool) -> str:
    active_attr = " active" if active else ""
    hidden_attr = "" if active else " hidden"
    return f"""
    <section id="{html.escape(tab_id)}" class="tab-panel{active_attr}" role="tabpanel"{hidden_attr}>
      <div class="section-head">
        <div>
          <h2>{html.escape(title)}</h2>
          <p>{html.escape(subtitle)}</p>
        </div>
        <a href="{html.escape(source_url)}" target="_blank" rel="noreferrer">원문</a>
      </div>
      <div class="table-wrap">{table}</div>
    </section>
    """


def content_tab_panel(tab_id: str, title: str, subtitle: str, content: str, active: bool) -> str:
    active_attr = " active" if active else ""
    hidden_attr = "" if active else " hidden"
    return f"""
    <section id="{html.escape(tab_id)}" class="tab-panel{active_attr}" role="tabpanel"{hidden_attr}>
      <div class="section-head">
        <div>
          <h2>{html.escape(title)}</h2>
          <p>{html.escape(subtitle)}</p>
        </div>
      </div>
      <div class="panel-body">{content}</div>
    </section>
    """


def render_html(data: dict[str, Any]) -> str:
    cak = data["cak"].data if data["cak"].ok else None
    cm = data["cm"].data if data["cm"].ok else None
    etis = data["etis"].data if data["etis"].ok else None
    kacem = data["kacem"].data if data["kacem"].ok else None
    market_unit_cost = data.get("market_unit_cost") or build_market_unit_cost_data(data)

    error_blocks = []
    for key, result in data.items():
        if isinstance(result, FetchResult) and not result.ok:
            error_blocks.append(f"<li><strong>{html.escape(key)}</strong>: {html.escape(result.error or '')}</li>")
    errors_html = ""
    if error_blocks:
        errors_html = f'<aside class="errors"><h2>수집 오류</h2><ul>{"".join(error_blocks)}</ul></aside>'

    tabs: list[dict[str, str]] = []
    source_notes: list[str] = []
    credit_ratings = data.get("credit_ratings") or {}
    if cak:
        tabs.append(
            {
                "id": "tab-cak",
                "label": "시공능력",
                "title": cak["title"],
                "subtitle": f"단위: {cak['unit']}. 조회 기준: {cak['basis_date']}. 전년순위는 {cak['previous_year']}년 공시자료 xlsx의 토건 순위를 등록번호 우선, 회사명 보조로 매칭했습니다.",
                "source_url": cak["source_url"],
                "table": render_rank_table(
                    cak["rows"],
                    [
                        ("rank", "순위", "number"),
                        ("previous_rank", "전년순위", "rank"),
                        ("rank_change", "변동", "change"),
                        ("company", "회사명", "text"),
                        ("credit_rating_label", "신용등급", "rating"),
                        ("amount_million_krw", "시평액", "moneybar"),
                        ("region", "지역", "text"),
                        ("representative", "대표자", "text"),
                    ],
                    "cak",
                    "amount_million_krw",
                    [
                        ("amount_million_krw", "시공능력평가액(백만원)", "money"),
                        ("registration_no", "등록번호", "text"),
                        ("business_type", "업종", "text"),
                        ("credit_rating_label", "신용등급", "rating"),
                        ("region", "지역", "text"),
                        ("representative", "대표자", "text"),
                        ("rank", "현재순위", "rank"),
                        ("previous_rank", "전년순위", "rank"),
                        ("rank_change", "변동", "change"),
                    ],
                ),
            }
        )
        source_notes.append(
            f'<li><strong>대한건설협회</strong>: 현재 순위는 <a href="{html.escape(cak["source_url"])}" target="_blank" rel="noreferrer">건설업체 검색</a>의 공개 AJAX JSON을 사용했습니다. 전년순위는 <a href="{html.escape(cak.get("previous_source_url", ""))}" target="_blank" rel="noreferrer">{html.escape(cak["previous_year"])}년 공시자료 xlsx</a>의 토건 시트 기준입니다.</li>'
        )
        if credit_ratings.get("ok"):
            query = credit_ratings.get("query") or {}
            source_notes.append(
                f'<li><strong>신용등급</strong>: KIS/NICE 공개 회사별 등급검색을 우선 사용하고, 공개 등급이 비는 회사는 <a href="{html.escape(query.get("opendart_source_url", "https://opendart.fss.or.kr/"))}" target="_blank" rel="noreferrer">OpenDART 채무증권 API</a>의 최근 {html.escape(str(query.get("lookback_years", 5)))}년 신용등급 필드로 보조했습니다. 현재 캐시 기준 {html.escape(str(credit_ratings.get("companies_with_rating", 0)))}/{html.escape(str(credit_ratings.get("companies_collected", 0)))}개 회사에서 등급을 확인했습니다.</li>'
            )
    if cm:
        tabs.append(
            {
                "id": "tab-cm",
                "label": "CM",
                "title": cm["title"],
                "subtitle": f"단위: {cm['unit']}. 전년순위는 KISCON {cm['previous_year']} 공시연도에서 같은 방식으로 재정렬했습니다.",
                "source_url": cm["source_url"],
                "table": render_rank_table(
                    cm["rows"],
                    [
                        ("rank", "순위", "number"),
                        ("previous_rank", "전년순위", "rank"),
                        ("rank_change", "변동", "change"),
                        ("company", "회사명", "text"),
                        ("service_cm_amount_million_krw", "2024 용역형 CM", "moneybar"),
                        ("cm_at_risk_amount_million_krw", "2024 시공책임형 CM", "number"),
                        ("people", "인력", "number"),
                    ],
                    "cm",
                    "service_cm_amount_million_krw",
                    [
                        ("service_cm_amount_million_krw", "2024 용역형 CM(백만원)", "money"),
                        ("cm_at_risk_amount_million_krw", "2024 시공책임형 CM(백만원)", "money"),
                        ("total_service_cm_amount_million_krw", "용역형 CM 누계(백만원)", "money"),
                        ("people", "기술인 수", "number"),
                        ("rank", "현재순위", "rank"),
                        ("previous_rank", "전년순위", "rank"),
                        ("rank_change", "변동", "change"),
                    ],
                ),
            }
        )
        source_notes.append(
            f'<li><strong>CM/KISCON</strong>: <a href="{html.escape(cm["source_url"])}" target="_blank" rel="noreferrer">KISCON 공시업체 검색</a>에서 {html.escape(cm["latest_year"])} 공시연도 전체 업체를 읽어 2024년도 용역형 CM 실적순으로 정렬했습니다. 전년순위는 <a href="{html.escape(cm["previous_source_url"])}" target="_blank" rel="noreferrer">{html.escape(cm["previous_year"])} 공시연도</a> 기준입니다.</li>'
        )
    if etis:
        tabs.append(
            {
                "id": "tab-etis-all",
                "label": "ETIS 전체",
                "title": "ETIS 2025 엔지니어링 수주실적 전체 상위 30",
                "subtitle": f"단위: {etis['unit']}. 전체 순위라 원자력/정보통신 등 비건설 분야도 포함됩니다. 전년순위는 {etis['previous_year']} 전체 PDF 기준입니다.",
                "source_url": etis["overall_rank_url"],
                "table": render_rank_table(
                    etis["overall_rows"],
                    [
                        ("rank", "순위", "number"),
                        ("previous_rank", "전년순위", "rank"),
                        ("rank_change", "변동", "change"),
                        ("company", "업체명", "text"),
                        ("count", "건수", "number"),
                        ("amount_million_krw", "금액", "moneybar"),
                        ("registration_no", "신고번호", "text"),
                    ],
                    "etis-all",
                    "amount_million_krw",
                    [
                        ("amount_million_krw", "수주금액(백만원)", "money"),
                        ("count", "수주건수", "number"),
                        ("registration_no", "신고번호", "text"),
                        ("rank", "현재순위", "rank"),
                        ("previous_rank", "전년순위", "rank"),
                        ("rank_change", "변동", "change"),
                    ],
                ),
            }
        )
        tabs.append(
            {
                "id": "tab-etis-con",
                "label": "ETIS 건설",
                "title": "ETIS 2025 엔지니어링 수주실적 건설부문 상위 30",
                "subtitle": f"단위: {etis['unit']}. 공사 관련 설계/엔지니어링사를 볼 때는 이 표가 더 적합합니다. 전년순위는 {etis['previous_year']} 건설부문 PDF 기준입니다.",
                "source_url": etis["construction_rank_url"],
                "table": render_rank_table(
                    etis["construction_rows"],
                    [
                        ("rank", "순위", "number"),
                        ("previous_rank", "전년순위", "rank"),
                        ("rank_change", "변동", "change"),
                        ("company", "업체명", "text"),
                        ("count", "건수", "number"),
                        ("amount_million_krw", "금액", "moneybar"),
                        ("registration_no", "신고번호", "text"),
                    ],
                    "etis-con",
                    "amount_million_krw",
                    [
                        ("amount_million_krw", "건설부문 수주금액(백만원)", "money"),
                        ("count", "수주건수", "number"),
                        ("registration_no", "신고번호", "text"),
                        ("rank", "현재순위", "rank"),
                        ("previous_rank", "전년순위", "rank"),
                        ("rank_change", "변동", "change"),
                    ],
                ),
            }
        )
        source_notes.append(
            f'<li><strong>ETIS</strong>: <a href="{html.escape(etis["selected_page_url"])}" target="_blank" rel="noreferrer">ETIS 통계 페이지</a>의 공식 PDF를 표 추출했습니다. 전년순위는 각각 <a href="{html.escape(etis["previous_overall_pdf_url"])}" target="_blank" rel="noreferrer">전체</a>, <a href="{html.escape(etis["previous_construction_pdf_url"])}" target="_blank" rel="noreferrer">건설부문</a>의 {html.escape(etis["previous_year"])}년 PDF 기준입니다.</li>'
        )
    if kacem:
        tabs.append(
            {
                "id": "tab-kacem",
                "label": "KACEM 분기",
                "title": f"KACEM {kacem['latest_label']} 수주실적 상위 30",
                "subtitle": f"단위: {kacem['unit']}. 전년순위는 전년 동기({kacem['previous_label']}) PDF 기준입니다.",
                "source_url": kacem["latest_pdf_url"],
                "table": render_rank_table(
                    kacem["rows"][:30],
                    [
                        ("rank", "순위", "number"),
                        ("previous_rank", "전년순위", "rank"),
                        ("rank_change", "변동", "change"),
                        ("company", "회사명", "text"),
                        ("total_count", "총건수", "number"),
                        ("total_amount_100m_krw", "총금액", "moneybar"),
                        ("public_design_amount_100m_krw", "공공 설계등", "number"),
                        ("public_cm_amount_100m_krw", "공공 CM", "number"),
                    ],
                    "kacem",
                    "total_amount_100m_krw",
                    [
                        ("total_count", "총건수", "number"),
                        ("total_amount_100m_krw", "총금액(억원)", "money"),
                        ("public_design_count", "공공 설계등 건수", "number"),
                        ("public_design_amount_100m_krw", "공공 설계등 금액(억원)", "money"),
                        ("public_cm_count", "공공 CM 건수", "number"),
                        ("public_cm_amount_100m_krw", "공공 CM 금액(억원)", "money"),
                        ("private_supervision_count", "민간 감리 건수", "number"),
                        ("private_supervision_amount_100m_krw", "민간 감리 금액(억원)", "money"),
                        ("private_multiuse_count", "민간 다중이용 건수", "number"),
                        ("private_multiuse_amount_100m_krw", "민간 다중이용 금액(억원)", "money"),
                        ("private_cm_count", "민간 CM 건수", "number"),
                        ("private_cm_amount_100m_krw", "민간 CM 금액(억원)", "money"),
                        ("rank", "현재순위", "rank"),
                        ("previous_rank", "전년순위", "rank"),
                        ("rank_change", "변동", "change"),
                    ],
                ),
            }
        )
        source_notes.append(
            f'<li><strong>KACEM</strong>: <a href="{html.escape(kacem["record_url"])}" target="_blank" rel="noreferrer">건설엔지니어링 통계</a>의 최신 분기 PDF를 표 추출했습니다. 전년순위는 <a href="{html.escape(kacem.get("previous_pdf_url", ""))}" target="_blank" rel="noreferrer">{html.escape(kacem.get("previous_label", ""))}</a> PDF 기준입니다. PDF 주석상 민간 기술형 입찰, 턴키, 해외 수주실적은 제외됩니다.</li>'
        )
    tabs.append(
        {
            "id": "tab-cost-index",
            "label": "공사비 지표",
            "title": "공사비 지표",
            "subtitle": market_unit_cost.get("subtitle", ""),
            "content": render_market_unit_cost_panel(market_unit_cost),
        }
    )

    tab_buttons = []
    tab_panels = []
    for index, item in enumerate(tabs):
        selected = "true" if index == 0 else "false"
        active_class = " active" if index == 0 else ""
        tab_buttons.append(
            f'<button class="tab-button{active_class}" type="button" role="tab" aria-selected="{selected}" aria-controls="{html.escape(item["id"])}" data-tab="{html.escape(item["id"])}">{html.escape(item["label"])}</button>'
        )
        if "content" in item:
            tab_panels.append(
                content_tab_panel(item["id"], item["title"], item["subtitle"], item["content"], index == 0)
            )
        else:
            tab_panels.append(
                tab_panel(item["id"], item["title"], item["subtitle"], item["table"], item["source_url"], index == 0)
            )

    source_notes.append(
        '<li><strong>최근 수주/계약</strong>: 산군/보도 수동 캐시, OpenDART 단일판매ㆍ공급계약체결 공시, 나라장터 계약정보서비스 공사 계약현황 캐시를 회사명으로 합쳐 최근 5년 이내 자료 중 최신 5건만 표시합니다. 공사비 단가는 DART 원문에서 연면적이 추출되는 경우에만 계약금액 ÷ 연면적으로 산정합니다.</li>'
    )
    source_notes.append(
        '<li><strong>공사비 지표</strong>: 회사별 확인 단가는 공사총액과 연면적이 함께 있는 수주건만 집계합니다. KOSIS 건설공사비지수, 국토교통부 기본형건축비, 나라장터 월별 계약액은 시장 기준지표로 표시하고, 조달청 공사비정보광장, 서울시 기준단가, 건축HUB 인허가정보는 향후 단가/면적 보강 후보로 분리했습니다.</li>'
    )
    source_notes.append(
        '<li><strong>기사/전략 정보</strong>: Google News RSS에서 회사명과 수주/계약/실적/경영/투자/계열사/신사업 키워드로 검색한 기사와 OpenDART 투자판단ㆍ출자ㆍ시설투자ㆍM&Aㆍ특수관계인 거래성 공시를 합쳐 표시합니다. 같은 프로젝트ㆍ이벤트로 보이는 유사 기사군은 대표 1건만 남기고 최대 5건까지 노출합니다.</li>'
    )
    source_notes.append(
        f'<li><strong>Comment</strong>: 회사별 기본 기록과 사용자가 남긴 메모를 한 목록으로 표시합니다. {html.escape(DEFAULT_COMMENT_AUTHOR)} 작성자명은 공식 기록에만 사용합니다.</li>'
    )

    disclaimer_html = ""
    if source_notes:
        disclaimer_html = f"""
    <section class="disclaimer">
      <h2>출처 및 유의사항</h2>
      <ul>{''.join(source_notes)}</ul>
      <p>전년순위는 등록번호가 있는 소스는 등록번호를 우선 사용하고, 없으면 회사명 정규화 매칭으로 보조합니다. 사명 변경, 합병, 표기 차이가 있으면 일부 행은 신규/권외로 표시될 수 있습니다.</p>
    </section>
        """

    seed_comment_counts_json = json.dumps(build_seed_comment_counts(), ensure_ascii=False)
    default_comment_author_json = json.dumps(DEFAULT_COMMENT_AUTHOR, ensure_ascii=False)
    public_supabase_config = load_public_supabase_config()
    comment_api_url = ""
    if public_supabase_config["url"]:
        comment_api_url = public_supabase_config["url"].rstrip("/") + "/rest/v1/construction_company_comments"
    comment_api_url_json = json.dumps(comment_api_url, ensure_ascii=False)
    comment_api_key_json = json.dumps(public_supabase_config["key"], ensure_ascii=False)

    css = """
    :root {
      color-scheme: dark;
      --ink: var(--text, #e5e5e5);
      --paper: var(--panel, #262626);
      --band: var(--bg, #1f1f1e);
      --blue: var(--accent, #2997ff);
      --teal: var(--accent-2, #82afb9);
      --amber: var(--accent, #2997ff);
      --construction-panel-strong: var(--panel-strong, #272727);
      --construction-item: var(--item, #222);
      --construction-soft: var(--soft, #a1a1aa);
      --construction-radius: 8px;
      --construction-shadow: var(--shadow, 0 18px 48px rgba(0, 0, 0, 0.22));
      --construction-selected-bg: rgba(41, 151, 255, 0.11);
      --construction-selected-bg-soft: rgba(130, 175, 185, 0.08);
      --construction-selected-border: rgba(41, 151, 255, 0.58);
      --comment-accent: #ffd84d;
      --comment-accent-soft: #ffe89a;
      --comment-bg: rgba(255, 216, 77, 0.075);
      --comment-border: rgba(255, 216, 77, 0.44);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font, "Segoe UI", "Malgun Gothic", Arial, sans-serif);
      color: var(--ink);
      background: var(--band);
      line-height: 1.45;
    }
    body.modal-open {
      overflow: hidden;
    }
    body.auth-pending header,
    body.auth-pending main {
      visibility: hidden;
    }
    body.auth-pending::before {
      content: "로그인 확인 중";
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--muted);
      font-size: 14px;
      font-weight: 800;
    }
    header {
      width: min(1440px, calc(100% - 32px));
      margin: 28px auto 0;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-xl, 24px);
      box-shadow: var(--construction-shadow);
      padding: 26px 28px;
    }
    header h1 {
      margin: 0;
      font-size: clamp(30px, 4vw, 46px);
      line-height: 1.06;
      letter-spacing: 0;
    }
    .header-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
    }
    .dashboard-auth-bar {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 34px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.25;
      white-space: nowrap;
    }
    .dashboard-auth-bar button {
      border: 1px solid rgba(255, 69, 58, 0.28);
      border-radius: var(--construction-radius);
      background: rgba(255, 69, 58, 0.1);
      color: #ff8a80;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 900;
      padding: 7px 10px;
    }
    .dashboard-auth-bar button:hover {
      background: rgba(255, 69, 58, 0.18);
      color: #ffc1bc;
    }
    main {
      width: min(1440px, calc(100% - 32px));
      margin: 0 auto;
      padding: 18px 0 56px;
    }
    a {
      color: var(--blue);
      text-decoration: none;
      font-weight: 650;
    }
    .tab-strip {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      padding: 6px;
      margin-bottom: 12px;
      border: 1px solid var(--line);
      border-radius: var(--construction-radius);
      background: var(--construction-panel-strong);
    }
    .tab-button {
      border: 0;
      border-radius: var(--construction-radius);
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      flex: 0 0 auto;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      padding: 10px 13px;
    }
    .tab-button.active {
      background: #3c3c3c;
      color: #fff;
    }
    .tab-panel {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg, 16px);
      overflow: hidden;
      box-shadow: var(--construction-shadow);
    }
    .tab-panel[hidden] { display: none; }
    .panel-body {
      padding: 18px;
    }
    .market-cost-tab {
      display: grid;
      gap: 16px;
      min-width: 0;
    }
    .market-cost-summary,
    .market-cost-main,
    .market-indicator-cards,
    .market-indicator-grid {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .market-cost-summary {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .market-indicator-cards {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .market-indicator-grid {
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
    }
    .market-cost-main {
      grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.2fr);
      align-items: stretch;
    }
    .market-cost-group-title,
    .market-indicators,
    .market-basis-note,
    .market-cost-card,
    .market-indicator-card,
    .market-indicator-chart,
    .market-indicator-strip,
    .market-cost-latest,
    .market-cost-trend,
    .market-cost-records,
    .market-cost-sources,
    .market-cost-method {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: var(--construction-radius);
      background: var(--construction-panel-strong);
    }
    .market-cost-group-title {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 14px;
      padding: 14px 16px;
      border-color: rgba(130, 175, 185, 0.2);
      background: linear-gradient(90deg, rgba(41, 151, 255, 0.08), transparent 66%);
    }
    .market-cost-group-title span {
      display: block;
      margin-bottom: 4px;
      color: var(--construction-soft);
      font-size: 11px;
      font-weight: 850;
    }
    .market-cost-group-title h3 {
      margin: 0;
      color: #fff;
      font-size: 17px;
      letter-spacing: 0;
    }
    .market-cost-group-title p {
      max-width: 420px;
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.45;
      text-align: right;
    }
    .market-indicators {
      display: grid;
      gap: 12px;
      padding: 16px;
      border-color: rgba(41, 151, 255, 0.28);
      background:
        linear-gradient(135deg, rgba(41, 151, 255, 0.10), transparent 52%),
        var(--construction-panel-strong);
    }
    .market-basis-note {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.65fr);
      gap: 12px;
      padding: 14px;
      border-color: rgba(255, 216, 77, 0.34);
      background:
        linear-gradient(135deg, rgba(255, 216, 77, 0.10), transparent 52%),
        var(--construction-item);
    }
    .market-basis-note > div,
    .market-basis-note dl {
      min-width: 0;
    }
    .market-basis-note span {
      display: block;
      margin-bottom: 5px;
      color: var(--comment-accent);
      font-size: 11px;
      font-weight: 900;
      line-height: 1.25;
    }
    .market-basis-note strong {
      display: block;
      color: #fff;
      font-size: 18px;
      line-height: 1.15;
    }
    .market-basis-note p {
      margin: 7px 0 0;
      color: var(--construction-soft);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.48;
    }
    .market-basis-note dl {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
      margin: 0;
    }
    .market-basis-note dl div {
      min-width: 0;
      padding: 9px 10px;
      border: 1px solid rgba(130, 175, 185, 0.16);
      border-radius: var(--construction-radius);
      background: rgba(255, 255, 255, 0.025);
    }
    .market-basis-note dt {
      margin: 0 0 4px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 850;
    }
    .market-basis-note dd {
      margin: 0;
      color: var(--ink);
      font-size: 12px;
      font-weight: 850;
      line-height: 1.35;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .market-cost-card {
      display: grid;
      align-content: start;
      gap: 6px;
      min-height: 104px;
      padding: 14px;
    }
    .market-indicator-card {
      display: grid;
      align-content: start;
      gap: 7px;
      min-height: 118px;
      padding: 14px;
      border-color: rgba(130, 175, 185, 0.22);
      background: var(--construction-item);
    }
    .market-cost-card.is-emphasis {
      border-color: rgba(41, 151, 255, 0.48);
      background:
        linear-gradient(135deg, rgba(41, 151, 255, 0.18), transparent 58%),
        var(--construction-panel-strong);
    }
    .market-indicator-card.is-emphasis {
      border-color: rgba(255, 216, 77, 0.44);
      background:
        linear-gradient(135deg, rgba(255, 216, 77, 0.12), rgba(41, 151, 255, 0.10) 64%),
        var(--construction-item);
    }
    .market-indicator-card.is-empty {
      border-style: dashed;
      opacity: 0.9;
    }
    .market-cost-card span,
    .market-indicator-card span,
    .market-cost-latest > div > span,
    .market-cost-records li > div > span {
      color: var(--teal);
      font-size: 11px;
      font-weight: 900;
      line-height: 1.25;
    }
    .market-cost-card strong,
    .market-indicator-card strong {
      color: var(--ink);
      font-size: 24px;
      line-height: 1.08;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .market-indicator-card strong {
      color: #fff;
      font-size: 22px;
    }
    .market-cost-card p,
    .market-indicator-card p,
    .market-cost-latest p,
    .market-cost-records p,
    .market-cost-sources p,
    .market-cost-method p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .market-indicator-card footer {
      align-self: end;
      color: var(--construction-soft);
      font-size: 11px;
      font-weight: 850;
      line-height: 1.35;
    }
    .market-indicator-card footer a {
      color: var(--blue);
      text-decoration: none;
    }
    .market-indicator-error {
      margin: -3px 0 0;
      padding: 9px 11px;
      border: 1px solid rgba(255, 216, 77, 0.28);
      border-radius: var(--construction-radius);
      background: rgba(255, 216, 77, 0.075);
      color: var(--comment-accent);
      font-size: 12px;
      font-weight: 750;
      line-height: 1.45;
    }
    .has-hover-detail {
      position: relative;
      cursor: help;
      outline: none;
    }
    .has-hover-detail::after {
      content: attr(data-tooltip);
      position: absolute;
      top: calc(100% + 9px);
      left: 0;
      z-index: 80;
      width: min(360px, calc(100vw - 48px));
      padding: 11px 12px;
      border: 1px solid rgba(255, 216, 77, 0.30);
      border-radius: 8px;
      background: rgba(14, 19, 27, 0.98);
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.36);
      color: #edf7ff;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.45;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-4px);
      transition: opacity 120ms ease, transform 120ms ease;
      visibility: hidden;
      white-space: pre-line;
    }
    .has-hover-detail:hover::after,
    .has-hover-detail:focus-visible::after {
      opacity: 1;
      transform: translateY(0);
      visibility: visible;
    }
    .market-indicator-bar.has-hover-detail::after,
    .market-indicator-strip .has-hover-detail::after {
      left: 50%;
      text-align: left;
      transform: translate(-50%, -4px);
    }
    .market-indicator-bar.has-hover-detail:hover::after,
    .market-indicator-bar.has-hover-detail:focus-visible::after,
    .market-indicator-strip .has-hover-detail:hover::after,
    .market-indicator-strip .has-hover-detail:focus-visible::after {
      transform: translate(-50%, 0);
    }
    .market-cost-latest,
    .market-cost-trend,
    .market-cost-records,
    .market-cost-sources,
    .market-cost-method,
    .market-indicator-chart,
    .market-indicator-strip {
      padding: 14px;
    }
    .market-cost-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    .market-cost-section-head h3 {
      margin: 0;
      color: var(--teal);
      font-size: 15px;
      letter-spacing: 0;
    }
    .market-cost-section-head > span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      text-align: right;
    }
    .market-cost-latest > div:last-child {
      display: grid;
      gap: 8px;
    }
    .market-cost-latest strong {
      color: #fff;
      font-size: 24px;
      line-height: 1.1;
    }
    .market-cost-latest dl,
    .market-cost-records dl {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin: 0;
    }
    .market-cost-latest dl div,
    .market-cost-records dl div {
      min-width: 0;
      padding: 8px;
      border: 1px solid rgba(130, 175, 185, 0.16);
      border-radius: var(--construction-radius);
      background: rgba(255, 255, 255, 0.025);
    }
    .market-cost-latest dt,
    .market-cost-records dt {
      margin: 0 0 3px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
    }
    .market-cost-latest dd,
    .market-cost-records dd {
      margin: 0;
      color: var(--ink);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.3;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .market-cost-chart {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(82px, 1fr));
      gap: 10px;
      align-items: end;
      min-height: 172px;
      padding-top: 6px;
    }
    .market-indicator-bars {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(62px, 1fr));
      gap: 8px;
      align-items: end;
      min-height: 190px;
      padding-top: 6px;
    }
    .market-cost-bar {
      display: grid;
      grid-template-rows: 108px auto auto auto;
      gap: 4px;
      align-items: end;
      min-width: 0;
      text-align: center;
    }
    .market-cost-bar span {
      display: block;
      width: min(40px, 70%);
      height: var(--h);
      min-height: 10px;
      justify-self: center;
      border-radius: 7px 7px 3px 3px;
      background: linear-gradient(180deg, #ffd84d, #2997ff);
      box-shadow: 0 8px 22px rgba(41, 151, 255, 0.18);
    }
    .market-indicator-bar {
      display: grid;
      grid-template-rows: 112px auto auto auto;
      gap: 4px;
      align-items: end;
      min-width: 0;
      text-align: center;
    }
    .market-indicator-bar span {
      display: block;
      width: min(34px, 68%);
      height: var(--h);
      min-height: 12px;
      justify-self: center;
      border-radius: 7px 7px 3px 3px;
      background: linear-gradient(180deg, #ffd84d 0%, #2997ff 82%);
      box-shadow: 0 8px 20px rgba(41, 151, 255, 0.16);
    }
    .market-cost-bar strong,
    .market-cost-bar em,
    .market-cost-bar small,
    .market-indicator-bar strong,
    .market-indicator-bar em,
    .market-indicator-bar small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .market-cost-bar strong,
    .market-indicator-bar strong {
      color: var(--ink);
      font-size: 12px;
    }
    .market-cost-bar em,
    .market-indicator-bar em {
      color: var(--construction-soft);
      font-size: 11px;
      font-style: normal;
      font-weight: 750;
    }
    .market-cost-bar small,
    .market-indicator-bar small {
      color: var(--muted);
      font-size: 10px;
      font-weight: 750;
    }
    .market-indicator-strip ul {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .market-indicator-strip li {
      min-width: 0;
      padding: 10px;
      border: 1px solid rgba(130, 175, 185, 0.16);
      border-radius: var(--construction-radius);
      background: var(--construction-item);
    }
    .market-indicator-strip li span,
    .market-indicator-strip li strong,
    .market-indicator-strip li em {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .market-indicator-strip li span {
      color: var(--construction-soft);
      font-size: 11px;
      font-weight: 850;
    }
    .market-indicator-strip li strong {
      margin-top: 5px;
      color: #fff;
      font-size: 18px;
    }
    .market-indicator-strip li em {
      margin-top: 3px;
      color: var(--muted);
      font-size: 10px;
      font-style: normal;
      font-weight: 750;
    }
    .market-cost-records ul,
    .market-cost-sources ul {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .market-cost-records li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 0.62fr);
      gap: 12px;
      padding: 12px;
      border: 1px solid rgba(130, 175, 185, 0.18);
      border-radius: var(--construction-radius);
      background: var(--construction-item);
    }
    .market-cost-records li strong,
    .market-cost-sources li strong {
      display: block;
      margin-top: 4px;
      color: var(--ink);
      font-size: 14px;
      line-height: 1.35;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .market-cost-sources li {
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid rgba(130, 175, 185, 0.18);
      border-radius: var(--construction-radius);
      background: var(--construction-item);
    }
    .market-cost-sources li > div {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .market-cost-sources li > div span {
      flex: 0 0 auto;
      min-height: 22px;
      padding: 4px 8px;
      border: 1px solid rgba(255, 216, 77, 0.38);
      border-radius: 999px;
      background: rgba(255, 216, 77, 0.12);
      color: var(--comment-accent);
      font-size: 10px;
      font-weight: 900;
      line-height: 1.1;
    }
    .market-cost-sources footer {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: var(--construction-soft);
      font-size: 11px;
      font-weight: 800;
    }
    .market-cost-method {
      display: grid;
      gap: 6px;
      border-color: rgba(255, 216, 77, 0.28);
      background: rgba(255, 216, 77, 0.055);
    }
    .market-cost-method strong {
      color: var(--comment-accent);
      font-size: 13px;
    }
    .section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
    }
    .section-head h2 {
      margin: 0 0 5px;
      font-size: 19px;
      letter-spacing: 0;
    }
    .section-head p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      table-layout: fixed;
      min-width: 920px;
    }
    th, td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
      white-space: nowrap;
    }
    th {
      color: var(--construction-soft);
      background: var(--construction-item);
      font-weight: 700;
    }
    .rank-row {
      cursor: pointer;
    }
    .rank-row td {
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .rank-row:hover:not(.expanded) td {
      background: var(--construction-panel-strong);
    }
    .rank-row.expanded td {
      background: linear-gradient(
        90deg,
        var(--construction-selected-bg),
        var(--construction-selected-bg-soft) 44%,
        var(--construction-panel-strong)
      );
      border-top: 1px solid var(--construction-selected-border);
      border-bottom-color: var(--construction-selected-border);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }
    .rank-row.expanded td:first-child {
      position: relative;
      color: #fff;
    }
    .rank-row.expanded td:first-child::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: -1px;
      left: 0;
      width: 4px;
      border-radius: 0 3px 3px 0;
      background: var(--blue);
    }
    td.col-rank,
    th.col-rank {
      width: 52px;
      min-width: 52px;
      padding-left: 8px;
      padding-right: 8px;
      text-align: right;
    }
    tbody td.col-rank {
      color: #fff;
      font-size: 15px;
      font-weight: 850;
      letter-spacing: 0;
    }
    th.col-rank {
      color: var(--construction-soft);
      font-weight: 800;
    }
    td.col-previous_rank,
    th.col-previous_rank {
      width: 66px;
      min-width: 66px;
      max-width: 66px;
      padding-left: 6px;
      padding-right: 6px;
      text-align: center;
    }
    tbody td.col-previous_rank {
      color: var(--muted);
      font-weight: 600;
    }
    .col-company {
      width: 26%;
      min-width: 220px;
      max-width: 360px;
    }
    .col-row_status {
      width: 72px;
      min-width: 70px;
      max-width: 76px;
      text-align: center;
    }
    .col-recent_update {
      width: 70px;
      min-width: 64px;
      max-width: 76px;
      text-align: center;
    }
    .col-credit_rating_label {
      width: 90px;
      min-width: 90px;
    }
    td.col-rank_change,
    th.col-rank_change {
      width: 58px;
      min-width: 58px;
      max-width: 58px;
      padding-left: 6px;
      padding-right: 6px;
      text-align: center;
    }
    .cell-change {
      color: var(--muted);
      font-weight: 650;
    }
    th.cell-moneybar,
    td.cell-moneybar {
      width: 220px;
      min-width: 190px;
      max-width: 230px;
      padding-left: 8px;
      padding-right: 8px;
    }
    th.col-region,
    td.col-region {
      width: 76px;
      min-width: 72px;
      max-width: 84px;
    }
    th.col-representative,
    td.col-representative {
      width: 104px;
      min-width: 96px;
      max-width: 116px;
    }
    td.col-region,
    td.col-representative {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rating-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 54px;
      min-height: 24px;
      padding: 3px 8px;
      border: 1px solid rgba(130, 175, 185, 0.46);
      border-radius: 999px;
      background: rgba(130, 175, 185, 0.14);
      color: var(--teal);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.2;
      white-space: nowrap;
    }
    .rating-pill.grade-aa {
      border-color: rgba(50, 215, 75, 0.52);
      background: rgba(50, 215, 75, 0.13);
      color: #32d74b;
    }
    .rating-pill.grade-a {
      border-color: rgba(41, 151, 255, 0.58);
      background: rgba(41, 151, 255, 0.14);
      color: #2997ff;
    }
    .rating-pill.grade-bbb {
      border-color: rgba(255, 216, 77, 0.56);
      background: rgba(255, 216, 77, 0.13);
      color: #ffd84d;
    }
    .rating-pill.grade-b {
      border-color: rgba(255, 159, 67, 0.58);
      background: rgba(255, 159, 67, 0.13);
      color: #ff9f43;
    }
    .rating-pill.grade-c {
      border-color: rgba(255, 69, 58, 0.58);
      background: rgba(255, 69, 58, 0.13);
      color: #ff453a;
    }
    .rating-pill.empty {
      border-color: var(--line);
      background: rgba(255, 255, 255, 0.045);
      color: var(--muted);
    }
    .rating-pill.small {
      min-width: 46px;
      min-height: 22px;
      padding: 2px 7px;
      font-size: 11px;
    }
    .row-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: 100%;
      border: 0;
      background: transparent;
      color: var(--ink);
      cursor: pointer;
      font: inherit;
      font-weight: 750;
      padding: 0;
      text-align: left;
    }
    .row-toggle .company-name {
      display: block;
      max-width: min(360px, 32vw);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .company-update-card {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-height: 22px;
      padding: 3px 8px 3px 7px;
      border: 1px solid rgba(255, 216, 77, 0.92);
      border-radius: 6px;
      background: linear-gradient(180deg, #ffe066 0%, #facc15 100%);
      color: #101318;
      font-size: 11px;
      font-weight: 950;
      letter-spacing: 0;
      line-height: 1;
      white-space: nowrap;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.42),
        0 2px 8px rgba(250, 204, 21, 0.16);
    }
    .company-update-card::before {
      content: "";
      width: 5px;
      height: 5px;
      border-radius: 999px;
      background: #101318;
      opacity: 0.86;
      flex: 0 0 auto;
    }
    .toggle-symbol {
      width: 0;
      height: 0;
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-left: 5px solid var(--muted);
      flex: 0 0 auto;
      transition: transform 0.16s ease;
    }
    .row-status {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 38px;
      white-space: nowrap;
    }
    .update-status {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      min-height: 22px;
      white-space: nowrap;
    }
    .comment-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 30px;
      min-height: 22px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
    }
    .comment-count.has-comments {
      border: 1px solid rgba(130, 175, 185, 0.46);
      border-radius: 999px;
      background: rgba(130, 175, 185, 0.14);
      color: var(--teal);
    }
    .new-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 19px;
      min-height: 19px;
      border-radius: 999px;
      border: 1px solid rgba(240, 190, 20, 0.72);
      background: #ffd84d;
      color: #111827;
      font-size: 11px;
      font-weight: 900;
      line-height: 1;
    }
    .rank-row.expanded .toggle-symbol {
      border-left-color: var(--blue);
      transform: rotate(90deg);
    }
    .rank-row.expanded .row-toggle {
      color: #fff;
    }
    .rank-row.expanded .comment-count {
      color: #fff;
    }
    .rank-row.expanded .new-badge {
      color: #111827;
      box-shadow: 0 0 0 2px rgba(255, 216, 77, 0.24);
    }
    .detail-row[hidden] {
      display: none;
    }
    .detail-row td {
      width: auto;
      padding: 0;
      background: linear-gradient(90deg, rgba(41, 151, 255, 0.08), var(--construction-panel-strong) 22%);
      color: var(--ink);
      border-bottom-color: var(--construction-selected-border);
      text-align: left;
      white-space: normal;
      box-shadow: inset 4px 0 0 var(--blue);
    }
    .detail-panel {
      padding: 16px 18px 18px clamp(18px, 7vw, 112px);
      overflow: hidden;
      text-align: left;
      border-right: 1px solid rgba(41, 151, 255, 0.18);
      border-bottom: 1px solid rgba(41, 151, 255, 0.18);
      background: rgba(255, 255, 255, 0.018);
    }
    .detail-summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(210px, 260px);
      gap: 14px;
      align-items: start;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line);
    }
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px 18px;
      margin: 0;
    }
    .detail-item {
      min-width: 0;
    }
    .detail-item dt {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }
    .detail-item dd {
      margin: 3px 0 0;
      color: var(--ink);
      font-weight: 760;
      overflow-wrap: anywhere;
    }
    .unit-cost-entry {
      min-width: 0;
      justify-self: end;
      width: 100%;
      max-width: 260px;
    }
    .unit-cost-button {
      display: grid;
      gap: 4px;
      width: 100%;
      min-height: 88px;
      padding: 13px 14px;
      border: 1px solid rgba(41, 151, 255, 0.42);
      border-radius: var(--construction-radius);
      background:
        linear-gradient(135deg, rgba(41, 151, 255, 0.18), rgba(50, 215, 75, 0.06)),
        var(--construction-panel-strong);
      color: var(--ink);
      cursor: pointer;
      font: inherit;
      text-align: left;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 12px 24px rgba(0, 0, 0, 0.16);
    }
    .unit-cost-button:hover {
      border-color: rgba(41, 151, 255, 0.72);
      transform: translateY(-1px);
    }
    .unit-cost-button span {
      color: var(--teal);
      font-size: 12px;
      font-weight: 850;
    }
    .unit-cost-button strong {
      color: #fff;
      font-size: 18px;
      line-height: 1.2;
      letter-spacing: 0;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .unit-cost-button em {
      color: var(--muted);
      font-size: 11px;
      font-style: normal;
      font-weight: 750;
      line-height: 1.35;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .unit-cost-button.is-empty {
      border-color: rgba(130, 175, 185, 0.22);
      background: var(--construction-panel-strong);
    }
    .unit-cost-button.is-empty strong {
      color: var(--muted);
      font-size: 15px;
    }
    .credit-ratings {
      min-width: 0;
      margin-top: 14px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: var(--construction-radius);
      background: var(--construction-item);
    }
    .credit-rating-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .credit-rating-head h3 {
      margin: 0;
      color: var(--teal);
      font-size: 15px;
      letter-spacing: 0;
    }
    .credit-rating-head p,
    .credit-ratings > p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .credit-source-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .credit-source-list > li {
      min-width: 0;
      padding: 10px 11px;
      border: 1px solid var(--line);
      border-radius: var(--construction-radius);
      background: var(--construction-panel-strong);
    }
    .credit-source-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 5px;
    }
    .credit-source-head strong {
      color: var(--ink);
      font-size: 12px;
    }
    .source-state {
      color: var(--teal);
      font-size: 11px;
      font-weight: 750;
    }
    .credit-source-list p {
      margin: 0 0 6px;
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .credit-source-list ul {
      display: grid;
      gap: 5px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .credit-source-list ul li {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .credit-source-list ul span:last-child {
      min-width: 0;
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .detail-split {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px;
      align-items: start;
      margin-top: 16px;
    }
    .detail-feed {
      min-width: 0;
    }
    .detail-feed-head,
    .recent-awards-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      height: 32px;
      margin: 0 0 10px;
    }
    .detail-feed-head > *,
    .recent-awards-head > * {
      min-width: 0;
    }
    .detail-feed h3,
    .recent-awards h3,
    .related-news h3 {
      margin: 0;
      color: var(--teal);
      font-size: 15px;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .detail-feed-head span,
    .recent-awards-head span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      overflow-wrap: anywhere;
      text-align: right;
    }
    .recent-awards ul,
    .related-news ul {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .recent-awards li,
    .related-news li {
      min-height: 118px;
      border: 1px solid var(--line);
      border-radius: var(--construction-radius);
      background: var(--construction-panel-strong);
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04);
    }
    .recent-awards li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(168px, 0.34fr);
      gap: 9px 12px;
      align-items: start;
      padding: 11px 12px;
    }
    .award-main {
      min-width: 0;
      text-align: left;
    }
    .item-meta,
    .news-meta {
      display: block;
      margin: 0 0 5px;
      color: var(--blue);
      font-size: 11px;
      font-weight: 800;
      line-height: 1.3;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .item-meta.is-online-update,
    .news-meta.is-online-update {
      color: #facc15;
      font-weight: 900;
      text-shadow: 0 0 10px rgba(250, 204, 21, 0.18);
    }
    .recent-awards strong {
      display: -webkit-box;
      color: var(--ink);
      font-size: 14px;
      line-height: 1.4;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .recent-awards li .item-subtitle {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .award-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(88px, 1fr));
      gap: 4px;
      justify-self: end;
      min-width: 0;
      width: 100%;
      max-width: 172px;
    }
    .award-metrics span {
      display: block;
      min-width: 0;
      margin: 0;
      padding: 7px 8px;
      border-radius: 5px;
      background: var(--construction-item);
      color: var(--ink);
      font-size: 12px;
      font-weight: 800;
      line-height: 1.2;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .award-metrics em {
      display: block;
      margin-bottom: 2px;
      color: var(--muted);
      font-size: 10px;
      font-style: normal;
      font-weight: 700;
    }
    .award-meta {
      grid-column: 1 / -1;
      min-width: 0;
      color: var(--construction-soft);
      font-size: 11px;
      font-weight: 750;
      text-align: left;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .related-news li {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 5px;
      padding: 11px 12px;
      border-left: 3px solid var(--blue);
    }
    .related-news li > a {
      display: -webkit-box;
      color: var(--ink);
      font-size: 14px;
      font-weight: 800;
      line-height: 1.4;
      text-align: left;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .related-news p {
      display: -webkit-box;
      margin: 0;
      color: var(--construction-soft);
      font-size: 12px;
      line-height: 1.45;
      text-align: left;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    .recent-awards.empty p,
    .related-news.empty p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
    }
    .unit-cost-modal[hidden] {
      display: none;
    }
    .unit-cost-modal {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      place-items: center;
      padding: 28px;
    }
    .unit-cost-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.72);
      backdrop-filter: blur(8px);
    }
    .unit-cost-dialog {
      position: relative;
      width: min(960px, 100%);
      max-height: min(820px, calc(100vh - 56px));
      overflow: auto;
      border: 1px solid rgba(130, 175, 185, 0.28);
      border-radius: var(--radius-lg, 16px);
      background:
        linear-gradient(135deg, rgba(41, 151, 255, 0.10), transparent 38%),
        var(--paper);
      box-shadow: 0 32px 90px rgba(0, 0, 0, 0.48);
    }
    .unit-cost-close {
      position: sticky;
      top: 14px;
      float: right;
      z-index: 1;
      width: 34px;
      height: 34px;
      margin: 14px 14px 0 0;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--ink);
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
    }
    .unit-cost-modal-content {
      display: grid;
      gap: 16px;
      padding: 24px;
    }
    .unit-cost-modal-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding-right: 42px;
    }
    .unit-cost-modal-head p,
    .unit-cost-hero p {
      margin: 0 0 4px;
      color: var(--teal);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0;
    }
    .unit-cost-modal-head h2 {
      margin: 0;
      color: #fff;
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .unit-cost-modal-head > span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }
    .unit-cost-hero {
      display: grid;
      grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr);
      gap: 16px;
      padding: 16px;
      border: 1px solid rgba(41, 151, 255, 0.34);
      border-radius: var(--construction-radius);
      background:
        linear-gradient(135deg, rgba(41, 151, 255, 0.18), rgba(50, 215, 75, 0.05)),
        var(--construction-panel-strong);
    }
    .unit-cost-hero.empty {
      border-color: rgba(130, 175, 185, 0.24);
      background: var(--construction-panel-strong);
    }
    .unit-cost-hero h3 {
      margin: 0;
      color: #fff;
      font-size: 28px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    .unit-cost-hero.empty h3 {
      color: var(--muted);
      font-size: 18px;
    }
    .unit-cost-hero > div > span {
      display: block;
      margin-top: 8px;
      color: var(--construction-soft);
      font-size: 13px;
      font-weight: 750;
      line-height: 1.4;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .unit-cost-hero dl,
    .unit-cost-records dl {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin: 0;
    }
    .unit-cost-hero dl div,
    .unit-cost-records dl div {
      min-width: 0;
      padding: 9px 10px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.045);
    }
    .unit-cost-hero dt,
    .unit-cost-records dt {
      margin: 0 0 3px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
    }
    .unit-cost-hero dd,
    .unit-cost-records dd {
      margin: 0;
      color: var(--ink);
      font-size: 12px;
      font-weight: 850;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .unit-cost-confidence {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid rgba(130, 175, 185, 0.36);
      color: var(--teal);
      font-size: 11px;
      font-weight: 900;
      line-height: 1;
    }
    .unit-cost-confidence.confidence-high {
      border-color: rgba(50, 215, 75, 0.48);
      background: rgba(50, 215, 75, 0.12);
      color: #32d74b;
    }
    .unit-cost-confidence.confidence-medium {
      border-color: rgba(41, 151, 255, 0.52);
      background: rgba(41, 151, 255, 0.12);
      color: #60a5fa;
    }
    .unit-cost-section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .unit-cost-section-head h3 {
      margin: 0;
      color: var(--teal);
      font-size: 15px;
      letter-spacing: 0;
    }
    .unit-cost-section-head span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
    }
    .unit-cost-chart-wrap,
    .unit-cost-records {
      min-width: 0;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: var(--construction-radius);
      background: var(--construction-panel-strong);
    }
    .unit-cost-chart-wrap.empty p,
    .unit-cost-records.empty p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .unit-cost-chart {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(86px, 1fr));
      gap: 10px;
      align-items: end;
      min-height: 176px;
      padding-top: 8px;
    }
    .unit-cost-chart-bar {
      display: grid;
      grid-template-rows: 112px auto auto auto;
      gap: 4px;
      align-items: end;
      min-width: 0;
      text-align: center;
    }
    .unit-cost-chart-bar span {
      display: block;
      width: min(42px, 70%);
      height: var(--h);
      min-height: 10px;
      justify-self: center;
      border-radius: 7px 7px 3px 3px;
      background: linear-gradient(180deg, #60a5fa, #2997ff);
      box-shadow: 0 8px 22px rgba(41, 151, 255, 0.18);
    }
    .unit-cost-chart-bar strong,
    .unit-cost-chart-bar em,
    .unit-cost-chart-bar small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .unit-cost-chart-bar strong {
      color: var(--ink);
      font-size: 12px;
    }
    .unit-cost-chart-bar em {
      color: var(--construction-soft);
      font-size: 11px;
      font-style: normal;
      font-weight: 750;
    }
    .unit-cost-chart-bar small {
      color: var(--muted);
      font-size: 10px;
      font-weight: 750;
    }
    .unit-cost-records ul {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .unit-cost-records li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(210px, 0.42fr);
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--construction-radius);
      background: var(--construction-item);
    }
    .unit-cost-record-main {
      min-width: 0;
    }
    .unit-cost-record-main > span {
      display: block;
      margin-bottom: 5px;
      color: var(--blue);
      font-size: 11px;
      font-weight: 850;
      line-height: 1.3;
    }
    .unit-cost-record-main strong {
      display: block;
      color: var(--ink);
      font-size: 14px;
      line-height: 1.35;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .unit-cost-record-main p {
      margin: 4px 0 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .unit-cost-record-main div {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      color: var(--construction-soft);
      font-size: 12px;
      font-weight: 750;
    }
    .company-comment {
      display: grid;
      grid-template-columns: minmax(140px, 180px) minmax(0, 1fr);
      gap: 14px;
      align-items: start;
      margin-top: 18px;
      padding: 14px;
      border: 1px solid var(--comment-border);
      border-left: 5px solid var(--comment-accent);
      border-radius: var(--construction-radius);
      background:
        linear-gradient(90deg, rgba(255, 216, 77, 0.12), transparent 34%),
        var(--comment-bg);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }
    .company-comment > div {
      min-width: 0;
    }
    .company-comment h3 {
      margin: 0;
      font-size: 14px;
      letter-spacing: 0;
      color: var(--comment-accent);
    }
    .comment-list-wrap,
    .comment-controls {
      grid-column: 2;
    }
    .comment-list-wrap {
      min-width: 0;
      display: grid;
      gap: 8px;
    }
    .comment-list {
      display: grid;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .comment-list li {
      border: 1px solid rgba(255, 216, 77, 0.34);
      border-radius: var(--construction-radius);
      background: rgba(255, 216, 77, 0.065);
      padding: 10px 12px;
    }
    .comment-list p {
      margin: 6px 0 0;
      color: var(--comment-accent-soft);
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .comment-empty {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
    }
    .comment-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      color: rgba(255, 232, 154, 0.72);
      font-size: 11px;
      line-height: 1.3;
    }
    .comment-author {
      color: var(--comment-accent);
      font-weight: 800;
    }
    .comment-saved {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 12px;
    }
    .comment-auth {
      display: grid;
      gap: 6px;
      margin-top: 10px;
      color: rgba(255, 232, 154, 0.82);
      font-size: 12px;
      line-height: 1.4;
    }
    .comment-auth-status {
      color: rgba(255, 232, 154, 0.78);
      font-weight: 700;
    }
    .comment-login-link,
    .comment-logout-button {
      justify-self: start;
      min-height: 30px;
      border: 1px solid rgba(255, 216, 77, 0.36);
      border-radius: var(--construction-radius);
      background: rgba(255, 216, 77, 0.11);
      color: var(--comment-accent);
      padding: 6px 10px;
      font: inherit;
      font-size: 12px;
      font-weight: 800;
      line-height: 1.2;
      text-decoration: none;
      cursor: pointer;
    }
    .comment-logout-button {
      background: transparent;
      color: rgba(255, 232, 154, 0.82);
    }
    .company-comment.is-locked .comment-controls {
      opacity: 0.64;
    }
    .comment-controls {
      display: grid;
      grid-template-columns: minmax(150px, 220px) minmax(0, 1fr) auto;
      gap: 8px;
      align-items: stretch;
      min-width: 0;
    }
    .comment-relationship {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: minmax(150px, 220px) minmax(0, 1fr);
      gap: 8px;
      align-items: end;
      min-width: 0;
    }
    .comment-author-field {
      display: grid;
      gap: 4px;
      min-width: 0;
      color: rgba(255, 232, 154, 0.82);
      font-size: 11px;
      font-weight: 800;
    }
    .comment-check-field,
    .comment-project-field {
      min-width: 0;
      color: rgba(255, 232, 154, 0.82);
      font-size: 11px;
      font-weight: 800;
    }
    .comment-check-field {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      gap: 8px;
      border: 1px solid rgba(255, 216, 77, 0.28);
      border-radius: var(--construction-radius);
      background: rgba(20, 20, 20, 0.62);
      padding: 8px 10px;
      cursor: pointer;
    }
    .comment-check-field input {
      width: 15px;
      height: 15px;
      margin: 0;
      accent-color: var(--comment-accent);
    }
    .comment-project-field {
      display: grid;
      gap: 4px;
    }
    .comment-author-field input,
    .comment-project-field input,
    .comment-controls textarea {
      display: block;
      min-width: 0;
      width: 100%;
      border: 1px solid rgba(255, 216, 77, 0.28);
      border-radius: var(--construction-radius);
      background: rgba(20, 20, 20, 0.62);
      padding: 8px 10px;
      color: var(--ink);
      font: inherit;
      font-size: 13px;
      line-height: 1.35;
    }
    .comment-author-field input {
      min-height: 36px;
    }
    .comment-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 8px;
    }
    .comment-tag {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      min-height: 22px;
      border: 1px solid rgba(255, 216, 77, 0.42);
      border-radius: 999px;
      background: rgba(255, 216, 77, 0.13);
      padding: 2px 8px;
      color: var(--comment-accent);
      font-size: 11px;
      font-weight: 800;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .comment-tag.project {
      background: rgba(112, 197, 255, 0.12);
      border-color: rgba(112, 197, 255, 0.34);
      color: #b7e5ff;
    }
    .comment-controls textarea {
      min-height: 52px;
      resize: vertical;
    }
    .comment-controls button {
      border: 0;
      border-radius: var(--construction-radius);
      background: var(--comment-accent);
      color: #1b1b1b;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 800;
      min-width: 72px;
      padding: 0 14px;
      white-space: nowrap;
    }
    .comment-controls button:disabled {
      cursor: wait;
      opacity: 0.58;
    }
    .change {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 34px;
      font-weight: 800;
    }
    .change.up { color: var(--good, #34d399); }
    .change.down { color: var(--warning, #fbf167); }
    .change.same { color: var(--muted); }
    .change.new { color: var(--teal); font-weight: 700; }
    .bar {
      display: block;
      width: min(var(--w), 100%);
      max-width: 220px;
      height: 4px;
      margin-top: 5px;
      background: linear-gradient(90deg, var(--teal), var(--amber));
      border-radius: 999px;
    }
    .errors {
      background: rgba(251, 241, 103, 0.08);
      border: 1px solid rgba(251, 241, 103, 0.22);
      border-radius: var(--construction-radius);
      padding: 14px 16px;
      margin-bottom: 14px;
    }
    .errors h2 {
      margin: 0 0 8px;
      font-size: 17px;
    }
    .notes {
      margin: 18px 0 0;
      color: var(--muted);
      font-size: 13px;
    }
    .notes strong {
      color: var(--ink);
    }
    .disclaimer {
      margin-top: 14px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg, 16px);
      padding: 16px 18px;
      color: var(--muted);
      font-size: 13px;
    }
    .disclaimer h2 {
      margin: 0 0 8px;
      color: var(--ink);
      font-size: 17px;
    }
    .disclaimer ul {
      margin: 0;
      padding-left: 18px;
    }
    .disclaimer li + li {
      margin-top: 6px;
    }
    .disclaimer p {
      margin: 10px 0 0;
    }
    @media (max-width: 900px) {
      .header-top {
        align-items: stretch;
        flex-direction: column;
      }
      .dashboard-auth-bar {
        justify-content: space-between;
        width: 100%;
        white-space: normal;
      }
      .section-head { flex-direction: column; }
      .panel-body {
        padding: 14px;
      }
      .market-cost-summary,
      .market-cost-main,
      .market-indicator-cards,
      .market-indicator-grid,
      .market-indicator-strip ul {
        grid-template-columns: minmax(0, 1fr);
      }
      .market-cost-group-title {
        align-items: flex-start;
        flex-direction: column;
      }
      .market-cost-group-title p {
        max-width: none;
        text-align: left;
      }
      .market-cost-latest dl,
      .market-cost-records li,
      .market-cost-records dl {
        grid-template-columns: minmax(0, 1fr);
      }
      .market-cost-sources li > div {
        display: grid;
      }
      .market-cost-section-head {
        align-items: flex-start;
        flex-direction: column;
      }
      .market-cost-section-head > span {
        text-align: left;
      }
      .market-basis-note {
        grid-template-columns: minmax(0, 1fr);
      }
      .has-hover-detail::after {
        display: none;
      }
      table { font-size: 12px; }
      .detail-panel {
        width: min(100%, calc(100vw - 28px));
        padding: 12px 14px;
      }
      .detail-split { grid-template-columns: minmax(0, 1fr); gap: 14px; }
      .detail-grid { grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); }
      .detail-summary {
        grid-template-columns: minmax(0, 1fr);
      }
      .unit-cost-entry {
        justify-self: stretch;
        max-width: none;
      }
      .unit-cost-modal {
        padding: 14px;
      }
      .unit-cost-dialog {
        max-height: calc(100vh - 28px);
      }
      .unit-cost-modal-content {
        padding: 18px;
      }
      .unit-cost-modal-head,
      .unit-cost-hero,
      .unit-cost-records li {
        grid-template-columns: minmax(0, 1fr);
      }
      .unit-cost-modal-head {
        padding-right: 38px;
      }
      .credit-rating-head {
        align-items: flex-start;
        flex-direction: column;
        gap: 6px;
      }
      .credit-source-list {
        grid-template-columns: minmax(0, 1fr);
      }
      .recent-awards-head {
        align-items: flex-start;
        flex-direction: column;
        height: auto;
        min-height: 32px;
        gap: 4px;
      }
      .recent-awards-head span { text-align: left; }
      .recent-awards li,
      .related-news li {
        min-height: 0;
      }
      .recent-awards li { grid-template-columns: minmax(0, 1fr); }
      .award-metrics {
        grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
        justify-self: stretch;
        max-width: none;
      }
      .related-news {
        padding-top: 0;
        padding-left: 0;
        border-top: 0;
        border-left: 0;
      }
      .company-comment { grid-template-columns: 1fr; }
      .comment-list-wrap,
      .comment-controls {
        grid-column: 1;
      }
      .comment-controls { grid-template-columns: 1fr; }
      .comment-relationship { grid-template-columns: 1fr; }
      .comment-controls button {
        width: 100%;
        min-height: 40px;
        padding: 10px 14px;
      }
      .award-meta { text-align: left; }
    }
    @media (max-width: 380px) {
      .detail-grid,
      .award-metrics,
      .market-cost-latest dl,
      .market-cost-records dl,
      .unit-cost-hero dl,
      .unit-cost-records dl {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    """
    return f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Construction Information</title>
  <link rel="stylesheet" href="../shared/ifpdp-system-theme.css?v=ifpdp_system_3">
  <link rel="stylesheet" href="../05. Org Board/styles.css?v=ifpdp_system_org_7">
  <script src="../01. RA Portal/portfolio-analysis/config.js"></script>
  <script src="../shared/ra-auth.js?v=construction_auth_1"></script>
  <style>{css}</style>
</head>
<body class="auth-pending">
  <header>
    <div class="header-top">
      <h1>Construction Information</h1>
      <div class="dashboard-auth-bar" aria-label="로그인 상태">
        <span id="constructionUserStatus">로그인 확인 중</span>
        <button id="constructionLogoutButton" type="button">로그아웃</button>
      </div>
    </div>
  </header>
  <main>
    {errors_html}
    <nav class="tab-strip" role="tablist" aria-label="순위표 종류">{''.join(tab_buttons)}</nav>
    {''.join(tab_panels)}
    {disclaimer_html}
  </main>
  <div class="unit-cost-modal" id="unitCostModal" hidden>
    <div class="unit-cost-backdrop" data-unit-cost-close></div>
    <section class="unit-cost-dialog" role="dialog" aria-modal="true" aria-labelledby="unitCostModalTitle">
      <button class="unit-cost-close" type="button" data-unit-cost-close aria-label="닫기">×</button>
      <div id="unitCostModalBody"></div>
    </section>
  </div>
  <script>
    function setRankRowExpanded(row, expanded) {{
      if (!row) return;
      const detail = document.getElementById(row.dataset.detailRow);
      if (!detail) return;
      row.setAttribute("aria-expanded", expanded ? "true" : "false");
      row.classList.toggle("expanded", expanded);
      detail.hidden = !expanded;
      row.querySelectorAll(".row-toggle").forEach((button) => {{
        button.setAttribute("aria-expanded", expanded ? "true" : "false");
      }});
    }}

    function closeOtherRankRows(activeRow) {{
      document.querySelectorAll(".rank-row.expanded").forEach((row) => {{
        if (row !== activeRow) setRankRowExpanded(row, false);
      }});
    }}

    function toggleRankRow(row) {{
      if (!row) return;
      const expanded = row.getAttribute("aria-expanded") === "true";
      if (expanded) {{
        setRankRowExpanded(row, false);
        return;
      }}
      closeOtherRankRows(row);
      setRankRowExpanded(row, true);
    }}

    document.querySelectorAll(".rank-row").forEach((row) => {{
      row.addEventListener("click", (event) => {{
        if (event.target.closest(".row-toggle")) return;
        toggleRankRow(row);
      }});
    }});

    document.querySelectorAll(".row-toggle").forEach((button) => {{
      button.addEventListener("click", () => {{
        toggleRankRow(button.closest(".rank-row"));
      }});
    }});

    const unitCostModal = document.getElementById("unitCostModal");
    const unitCostModalBody = document.getElementById("unitCostModalBody");

    function closeUnitCostModal() {{
      if (!unitCostModal || !unitCostModalBody) return;
      unitCostModal.hidden = true;
      unitCostModalBody.innerHTML = "";
      document.body.classList.remove("modal-open");
    }}

    function openUnitCostModal(button) {{
      if (!unitCostModal || !unitCostModalBody || !button) return;
      const template = document.getElementById(button.dataset.unitCostTemplate || "");
      if (!template) return;
      unitCostModalBody.innerHTML = template.innerHTML;
      const title = unitCostModalBody.querySelector("h2");
      if (title) title.id = "unitCostModalTitle";
      unitCostModal.hidden = false;
      document.body.classList.add("modal-open");
      const closeButton = unitCostModal.querySelector(".unit-cost-close");
      if (closeButton) closeButton.focus();
    }}

    document.querySelectorAll(".unit-cost-button").forEach((button) => {{
      button.addEventListener("click", (event) => {{
        event.preventDefault();
        event.stopPropagation();
        openUnitCostModal(button);
      }});
    }});

    document.querySelectorAll("[data-unit-cost-close]").forEach((button) => {{
      button.addEventListener("click", closeUnitCostModal);
    }});

    document.addEventListener("keydown", (event) => {{
      if (event.key === "Escape" && unitCostModal && !unitCostModal.hidden) {{
        closeUnitCostModal();
      }}
    }});

    const seedCommentCounts = {seed_comment_counts_json};
    const defaultCommentAuthor = {default_comment_author_json};
    const commentApiUrl = {comment_api_url_json};
    const commentApiKey = {comment_api_key_json};
    const onlineCommentsByKey = new Map();
    let constructionAuthUser = null;

    function commentLoginUrl() {{
      const loginUrl = new URL("./login.html", window.location.href);
      loginUrl.searchParams.set("redirect", window.location.href);
      return loginUrl.href;
    }}

    function authDisplayName(user) {{
      return String(user?.name || user?.email || "").trim();
    }}

    function authAuthorValue(user) {{
      const name = String(user?.name || "").trim();
      const email = String(user?.email || "").trim();
      if (name && email) return `${{name}} (${{email}})`;
      return name || email;
    }}

    function redirectToConstructionLogin() {{
      window.location.replace(commentLoginUrl());
    }}

    function setConstructionAuthUser(user) {{
      constructionAuthUser = user || null;
      const displayName = authDisplayName(constructionAuthUser);
      const authorValue = authAuthorValue(constructionAuthUser);
      const globalStatus = document.getElementById("constructionUserStatus");
      const globalLogout = document.getElementById("constructionLogoutButton");
      if (globalStatus) {{
        globalStatus.textContent = constructionAuthUser ? `${{authorValue}} 로그인` : "로그인 필요";
      }}
      if (globalLogout) {{
        globalLogout.hidden = !constructionAuthUser;
      }}
      document.querySelectorAll(".company-comment").forEach((box) => {{
        const authorInput = box.querySelector(".comment-author-field input");
        const status = box.querySelector(".comment-auth-status");
        const loginLink = box.querySelector(".comment-login-link");
        const logoutButton = box.querySelector(".comment-logout-button");
        const locked = !constructionAuthUser;
        box.classList.toggle("is-locked", locked);
        box.querySelectorAll(".comment-collaboration-input, .comment-project-input, textarea").forEach((input) => {{
          input.disabled = locked;
        }});
        box.querySelectorAll(".comment-controls button").forEach((button) => {{
          button.disabled = locked;
        }});
        if (authorInput) {{
          authorInput.value = authorValue;
          authorInput.readOnly = Boolean(constructionAuthUser);
          authorInput.disabled = locked;
          authorInput.placeholder = locked ? "로그인 후 자동 입력" : "작성자";
        }}
        if (status) {{
          status.textContent = constructionAuthUser ? `${{displayName}} 로그인` : "코멘트 작성은 로그인 필요";
        }}
        if (loginLink) {{
          loginLink.href = commentLoginUrl();
          loginLink.hidden = Boolean(constructionAuthUser);
        }}
        if (logoutButton) logoutButton.hidden = !constructionAuthUser;
      }});
    }}

    async function initConstructionAuth() {{
      if (!window.RAAuth) {{
        redirectToConstructionLogin();
        return;
      }}
      let user = RAAuth.getSessionUser();
      if (!user) setConstructionAuthUser(null);
      if (!user) {{
        try {{
          user = await RAAuth.resumeRememberedSession();
        }} catch (error) {{
          user = null;
        }}
      }}
      if (!user) {{
        redirectToConstructionLogin();
        return;
      }}
      setConstructionAuthUser(user);
      document.body.classList.remove("auth-pending");
    }}

    async function logoutConstructionDashboard(button) {{
      if (button) button.disabled = true;
      try {{
        if (window.RAAuth) await RAAuth.logout();
      }} finally {{
        setConstructionAuthUser(null);
        redirectToConstructionLogin();
      }}
    }}

    function escapeCommentHtml(value) {{
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({{
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }}[char]));
    }}

    function formatCommentDate(value) {{
      if (!value) return "";
      try {{
        return new Intl.DateTimeFormat("ko-KR", {{
          timeZone: "Asia/Seoul",
          year: "2-digit",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }}).format(new Date(value));
      }} catch (error) {{
        return "";
      }}
    }}

    function normalizeCommentText(value) {{
      return String(value || "")
        .replace(/\\\\r\\\\n/g, "\\n")
        .replace(/\\\\n/g, "\\n")
        .replace(/\\r\\n?/g, "\\n")
        .trim();
    }}

    function parseCommentBody(value) {{
      const raw = normalizeCommentText(value);
      if (!raw) return {{ collaboration: false, project: "", text: "" }};
      const lines = raw.split(/\\r?\\n/);
      let collaboration = false;
      let project = "";
      let cursor = 0;
      while (cursor < lines.length) {{
        const line = lines[cursor].trim();
        if (!line) {{
          cursor += 1;
          continue;
        }}
        const collaborationMatch = line.match(/^협업\\s*:\\s*(.+)$/);
        if (collaborationMatch) {{
          collaboration = /^(예|y|yes|true|1|우리회사|협업사)$/i.test(collaborationMatch[1].trim());
          cursor += 1;
          continue;
        }}
        const projectMatch = line.match(/^프로젝트\\s*:\\s*(.+)$/);
        if (projectMatch) {{
          project = projectMatch[1].trim();
          cursor += 1;
          continue;
        }}
        break;
      }}
      const text = lines.slice(cursor).join("\\n").trim() || raw;
      return {{ collaboration, project, text }};
    }}

    function buildCommentBody(text, collaboration, project) {{
      const normalizedText = normalizeCommentText(text);
      const metaLines = [];
      if (collaboration) metaLines.push("협업: 예");
      if (project) metaLines.push(`프로젝트: ${{project}}`);
      return metaLines.length ? `${{metaLines.join("\\n")}}\\n\\n${{normalizedText}}` : normalizedText;
    }}

    function getCommentCount(key) {{
      return (seedCommentCounts[key] || 0) + (onlineCommentsByKey.get(key) || []).length;
    }}

    function isRecentCommentUpdate(value) {{
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return false;
      const elapsed = Date.now() - date.getTime();
      return elapsed >= 0 && elapsed <= 31 * 24 * 60 * 60 * 1000;
    }}

    function hasRecentOnlineComment(key) {{
      return (onlineCommentsByKey.get(key) || []).some((item) => isRecentCommentUpdate(item.created_at));
    }}

    function ensureRecentBadge(status) {{
      if (status.querySelector(".new-badge")) return;
      const badge = document.createElement("span");
      badge.className = "new-badge";
      badge.title = "최근 Comment";
      badge.setAttribute("aria-label", "최근 Comment");
      badge.textContent = "N";
      status.appendChild(badge);
    }}

    function updateCommentBadges(changedKey) {{
      document.querySelectorAll(".row-status[data-comment-key]").forEach((status) => {{
        const key = status.dataset.commentKey;
        if (changedKey && key !== changedKey) return;
        const count = getCommentCount(key);
        const countBadge = status.querySelector(".comment-count");
        if (!countBadge) return;
        countBadge.textContent = `(${{count}})`;
        countBadge.classList.toggle("has-comments", count > 0);
        countBadge.setAttribute("title", `Comment ${{count}}개`);
        countBadge.setAttribute("aria-label", `코멘트 ${{count}}개`);
      }});
    }}

    function updateRecentBadges(changedKey) {{
      document.querySelectorAll(".update-status[data-comment-key]").forEach((status) => {{
        const key = status.dataset.commentKey;
        if (changedKey && key !== changedKey) return;
        if (hasRecentOnlineComment(key)) ensureRecentBadge(status);
      }});
    }}

    updateCommentBadges();
    updateRecentBadges();

    function renderOnlineComments(box) {{
      const key = box.dataset.commentKey;
      const list = box.querySelector(".comment-list");
      const empty = box.querySelector(".comment-empty");
      if (!key || !list) return;
      const comments = onlineCommentsByKey.get(key) || [];
      list.querySelectorAll("[data-online-comment='true']").forEach((item) => item.remove());
      const onlineHtml = comments.map((item) => {{
        const author = String(item.author_name || "").trim() || "작성자 미기재";
        const date = formatCommentDate(item.created_at);
        const parsed = parseCommentBody(item.body || "");
        const tags = [
          parsed.collaboration ? `<span class="comment-tag">우리회사 협업</span>` : "",
          parsed.project ? `<span class="comment-tag project">프로젝트: ${{escapeCommentHtml(parsed.project)}}</span>` : "",
        ].filter(Boolean).join("");
        return `
        <li data-online-comment="true">
          <div class="comment-meta">
            <span class="comment-author">${{escapeCommentHtml(author)}}</span>
            ${{date ? `<span>${{escapeCommentHtml(date)}}</span>` : ""}}
          </div>
          ${{tags ? `<div class="comment-tags">${{tags}}</div>` : ""}}
          <p>${{escapeCommentHtml(parsed.text || "")}}</p>
        </li>`;
      }}).join("");
      if (onlineHtml) list.insertAdjacentHTML("beforeend", onlineHtml);
      const seedCount = list.querySelectorAll("[data-seed-comment='true']").length;
      if (empty) empty.hidden = seedCount + comments.length > 0;
    }}

    function renderAllOnlineComments() {{
      document.querySelectorAll(".company-comment").forEach(renderOnlineComments);
    }}

    async function loadOnlineComments() {{
      if (!commentApiUrl || !commentApiKey) {{
        document.querySelectorAll(".comment-saved").forEach((saved) => {{
          saved.textContent = "저장 설정이 없습니다.";
        }});
        return;
      }}
      try {{
        const response = await fetch(`${{commentApiUrl}}?select=id,company_key,author_name,body,created_at&is_deleted=eq.false&order=created_at.desc&limit=1000`, {{
          headers: {{
            apikey: commentApiKey,
            Authorization: `Bearer ${{commentApiKey}}`,
          }},
        }});
        if (!response.ok) throw new Error(await response.text());
        const rows = await response.json();
        onlineCommentsByKey.clear();
        rows.forEach((row) => {{
          const key = `company-comment:${{row.company_key}}`;
          const items = onlineCommentsByKey.get(key) || [];
          items.push(row);
          onlineCommentsByKey.set(key, items);
        }});
        renderAllOnlineComments();
        updateCommentBadges();
        updateRecentBadges();
      }} catch (error) {{
        document.querySelectorAll(".comment-saved").forEach((saved) => {{
          saved.textContent = "코멘트를 불러오지 못했습니다.";
        }});
      }}
    }}

    document.querySelectorAll(".company-comment").forEach((box) => {{
      const key = box.dataset.commentKey;
      const companyKey = box.dataset.companyKey || "";
      const companyName = box.dataset.companyName || "";
      const collaborationInput = box.querySelector(".comment-collaboration-input");
      const projectInput = box.querySelector(".comment-project-input");
      const authorInput = box.querySelector(".comment-author-field input");
      const textarea = box.querySelector("textarea");
      const button = box.querySelector(".comment-controls button");
      const saved = box.querySelector(".comment-saved");
      if (!key || !companyKey || !authorInput || !textarea || !button || !saved) return;
      saved.textContent = "";
      button.addEventListener("click", async () => {{
        const value = textarea.value.trim();
        const author = authAuthorValue(constructionAuthUser) || authorInput.value.trim();
        const collaboration = Boolean(collaborationInput && collaborationInput.checked);
        const project = projectInput ? projectInput.value.trim() : "";
        if (!constructionAuthUser) {{
          saved.textContent = "로그인 후 저장할 수 있습니다.";
          return;
        }}
        if (!value) {{
          saved.textContent = "코멘트가 비어 있습니다.";
          return;
        }}
        if (author === defaultCommentAuthor) {{
          saved.textContent = `${{defaultCommentAuthor}} 작성자명은 공식 기록에만 사용합니다.`;
          return;
        }}
        if (!commentApiUrl || !commentApiKey) {{
          saved.textContent = "저장 설정이 없습니다.";
          return;
        }}
        button.disabled = true;
        saved.textContent = "저장 중";
        try {{
          const payload = {{
            company_key: companyKey,
            company_name: companyName,
            tab_id: box.closest(".tab-panel")?.id || "",
            source: "user",
            author_name: author || null,
            body: buildCommentBody(value, collaboration, project),
          }};
          const response = await fetch(commentApiUrl, {{
            method: "POST",
            headers: {{
              apikey: commentApiKey,
              Authorization: `Bearer ${{commentApiKey}}`,
              "Content-Type": "application/json",
              Prefer: "return=representation",
            }},
            body: JSON.stringify(payload),
          }});
          if (!response.ok) throw new Error(await response.text());
          const rows = await response.json();
          const created = rows && rows[0] ? rows[0] : {{
            ...payload,
            created_at: new Date().toISOString(),
          }};
          const items = onlineCommentsByKey.get(key) || [];
          onlineCommentsByKey.set(key, [created, ...items]);
          textarea.value = "";
          if (collaborationInput) collaborationInput.checked = false;
          if (projectInput) projectInput.value = "";
          saved.textContent = "Saved";
          renderOnlineComments(box);
          updateCommentBadges(key);
          updateRecentBadges(key);
        }} catch (error) {{
          saved.textContent = "저장 실패";
        }} finally {{
          button.disabled = false;
        }}
      }});
    }});

    document.querySelectorAll(".comment-logout-button").forEach((button) => {{
      button.addEventListener("click", async () => {{
        await logoutConstructionDashboard(button);
      }});
    }});

    const constructionLogoutButton = document.getElementById("constructionLogoutButton");
    if (constructionLogoutButton) {{
      constructionLogoutButton.addEventListener("click", async () => {{
        await logoutConstructionDashboard(constructionLogoutButton);
      }});
    }}

    initConstructionAuth();
    renderAllOnlineComments();
    loadOnlineComments();

    document.querySelectorAll(".tab-button").forEach((button) => {{
      button.addEventListener("click", () => {{
        const target = button.dataset.tab;
        document.querySelectorAll(".tab-button").forEach((item) => {{
          const selected = item === button;
          item.classList.toggle("active", selected);
          item.setAttribute("aria-selected", selected ? "true" : "false");
        }});
        document.querySelectorAll(".tab-panel").forEach((panel) => {{
          const active = panel.id === target;
          panel.hidden = !active;
          panel.classList.toggle("active", active);
        }});
      }});
    }});
  </script>
</body>
</html>
"""


def serializable_results(results: dict[str, Any]) -> dict[str, Any]:
    packed: dict[str, Any] = {}
    for key, value in results.items():
        if isinstance(value, FetchResult):
            packed[key] = {"ok": value.ok, "data": value.data, "error": value.error}
        else:
            packed[key] = value
    return packed


def strip_trailing_whitespace(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.splitlines()) + "\n"


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results: dict[str, Any] = {
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST"),
        "cak": guarded("cak", fetch_cak_top30),
        "cm": guarded("cm", fetch_cm_top30),
        "etis": guarded("etis", fetch_etis_rankings),
        "kacem": guarded("kacem", fetch_kacem_rankings),
    }
    attach_recent_awards(results)
    attach_credit_ratings(results)
    attach_online_update_marks(results)
    results["market_unit_cost"] = build_market_unit_cost_data(results)
    HTML_OUT.write_text(strip_trailing_whitespace(render_html(results)), encoding="utf-8")
    JSON_OUT.write_text(json.dumps(serializable_results(results), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {HTML_OUT}")
    print(f"Wrote {JSON_OUT}")


if __name__ == "__main__":
    main()
