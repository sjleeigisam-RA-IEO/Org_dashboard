from __future__ import annotations

import argparse
import html
import json
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from update_construction_dart_awards import (
    DART_VIEWER_URL,
    build_corp_index,
    collect_target_companies,
    compact_text,
    company_aliases,
    download_corp_code,
    http_get_json,
    match_company,
    merge_company_entry,
    normalize_company,
    parse_corp_codes,
    pick_dart_key,
    read_json_file,
    validate_key,
)


HERE = Path(__file__).resolve()
ROOT = HERE.parents[1]
if HERE.parent.name == "scripts" and HERE.parent.parent.name == "construction_source_status":
    ROOT = HERE.parents[2]
OUTPUT_DIR = ROOT / "outputs"
CREDIT_CACHE_OUT = OUTPUT_DIR / "construction_credit_ratings_cache.json"
SOURCE_STATUS_DATA = OUTPUT_DIR / "construction_source_status_data.json"
SOURCE_MAP_PATH = ROOT / "tools" / "construction_company_source_map.json"

KST = timezone(timedelta(hours=9))
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
KIS_SEARCH_URL = "https://www.kisrating.com/ratingsSearch/selectCorpSearchList.json"
KIS_SEARCH_PAGE = "https://www.kisrating.com/ratingsSearch/corp_search.do"
NICE_SEARCH_URL = "https://www.nicerating.com/disclosure/companySearch.do"
OPENDART_BOND_URL = "https://opendart.fss.or.kr/api/bdRs.json"
HTTP_TIMEOUT = 15


LONG_TERM_PRODUCTS = {"company_bond", "corporate_credit", "bond1", "bond2"}
RATING_SCORE = {
    "AAA": 1,
    "AA+": 2,
    "AA": 3,
    "AA-": 4,
    "A+": 5,
    "A": 6,
    "A0": 6,
    "A-": 7,
    "BBB+": 8,
    "BBB": 9,
    "BBB0": 9,
    "BBB-": 10,
    "BB+": 11,
    "BB": 12,
    "BB0": 12,
    "BB-": 13,
    "B+": 14,
    "B": 15,
    "B0": 15,
    "B-": 16,
    "CCC": 17,
    "CC": 18,
    "C": 19,
    "D": 20,
}


@dataclass
class RatingItem:
    agency: str
    product: str
    rating: str
    outlook: str = ""
    date: str = ""
    source: str = ""
    source_url: str = ""
    raw: str = ""

    def as_dict(self) -> dict[str, str]:
        return {
            "agency": self.agency,
            "product": self.product,
            "rating": self.rating,
            "outlook": self.outlook,
            "date": self.date,
            "source": self.source,
            "source_url": self.source_url,
            "raw": self.raw,
        }


class TextOnlyParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        text = compact_text(html.unescape(data))
        if text:
            self.parts.append(text)

    def text(self) -> str:
        return compact_text(" ".join(self.parts))


def strip_html(value: str) -> str:
    parser = TextOnlyParser()
    parser.feed(value)
    return parser.text()


def http_get_text(url: str, params: dict[str, str] | None = None, timeout: int = 30) -> str:
    req_url = url
    if params:
        req_url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(req_url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def http_post_json(url: str, payload: dict[str, Any], timeout: int = 30) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json; charset=UTF-8",
            "Referer": KIS_SEARCH_PAGE,
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def unique_queries(entry: dict[str, Any]) -> list[str]:
    queries: list[str] = []
    blocked = {"주", "㈜", "유", "주식회사", "회사", "유한회사", "법인"}
    for alias in company_aliases(entry.get("company", ""), entry.get("aliases") or []):
        cleaned = compact_text(alias)
        if not cleaned:
            continue
        shortened = re.sub(r"\(주\)|（주）|㈜|주식회사|유한회사", "", cleaned).strip()
        deparen = compact_text(re.sub(r"[\(（][^\)）]+[\)）]", "", cleaned))
        for value in (shortened, deparen, cleaned):
            value = compact_text(value)
            normalized = normalize_company(value)
            if normalized and normalized not in blocked and len(normalized) >= 2 and value not in queries:
                queries.append(value)
    return queries[:3]


def source_status_data_path() -> Path:
    if SOURCE_STATUS_DATA.exists():
        return SOURCE_STATUS_DATA
    bundle_data = ROOT / "construction_source_status" / "data" / "construction_source_status_data.json"
    return bundle_data


def collect_cak_rank_companies(limit: int = 30) -> list[dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    source_data = read_json_file(source_status_data_path())
    cak = source_data.get("cak") or {}
    rows = (cak.get("data") or {}).get("rows", []) if cak.get("ok") else []
    for row in rows[:limit]:
        merge_company_entry(entries, row.get("company", ""), "cak.rows", row.get("aliases") or [])

    source_map = read_json_file(SOURCE_MAP_PATH)
    for item in source_map.get("companies", []):
        key = normalize_company(item.get("company", ""))
        if key in entries:
            merge_company_entry(entries, item.get("company", ""), "source_map", item.get("aliases") or [])

    return list(entries.values())


def collect_credit_targets(scope: str, limit: int = 0) -> list[dict[str, Any]]:
    if scope == "all":
        targets = collect_target_companies()
    else:
        targets = collect_cak_rank_companies(limit=30)
    if limit > 0:
        return targets[:limit]
    return targets


def rating_rank(value: str) -> int:
    rating = normalize_rating(value)
    return RATING_SCORE.get(rating, 999)


def normalize_rating(value: Any) -> str:
    text = compact_text(value).upper()
    if not text or text in {"-", "NAN", "NONE"}:
        return ""
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"\(.*?\)", "", text)
    text = text.replace("STABLE", "").replace("POSITIVE", "").replace("NEGATIVE", "")
    match = re.search(r"AAA|AA[+-]?|A[0+-]?|BBB[0+-]?|BB[0+-]?|B[0+-]?|CCC|CC|C|D|A1[+-]?|A2[+-]?|A3[+-]?", text)
    return match.group(0) if match else text


def split_rating_outlook(value: Any) -> tuple[str, str]:
    text = compact_text(value)
    if not text or text == "-":
        return "", ""
    rating = normalize_rating(text)
    outlook = ""
    outlook_match = re.search(r"(안정적|긍정적|부정적|유동적|상향검토|하향검토|Watch|WATCH|Stable|Positive|Negative)", text, re.I)
    if outlook_match:
        outlook = outlook_match.group(1)
    if "/" in text and not outlook:
        parts = [part.strip() for part in text.split("/") if part.strip()]
        if len(parts) > 1 and not normalize_rating(parts[1]):
            outlook = parts[1]
    return rating, outlook


def meaningful_rating(value: Any) -> bool:
    rating, _ = split_rating_outlook(value)
    return bool(rating)


def row_match_score(entry: dict[str, Any], candidate_name: str) -> float:
    candidate = normalize_company(candidate_name)
    if not candidate:
        return 0
    scores = []
    for alias in company_aliases(entry.get("company", ""), entry.get("aliases") or []):
        key = normalize_company(alias)
        if not key:
            continue
        if key == candidate:
            scores.append(1.0)
        elif key in candidate or candidate in key:
            scores.append(min(len(key), len(candidate)) / max(len(key), len(candidate)))
    return max(scores or [0])


def pick_best_kis_row(entry: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    best: tuple[float, int, dict[str, Any]] | None = None
    for row in rows:
        name = compact_text(row.get("upcheOpt"))
        score = row_match_score(entry, name)
        if score < 0.65:
            continue
        rating_count = sum(
            1
            for field in ("bond1Grade", "bond2Grade", "corpGrade", "cpGrade", "absGrade", "stbGrade")
            if meaningful_rating(row.get(field))
        )
        rank = min((rating_rank(row.get(field)) for field in ("bond1Grade", "bond2Grade", "corpGrade") if meaningful_rating(row.get(field))), default=999)
        packed = (score, rating_count * 1000 - rank, row)
        if best is None or packed[:2] > best[:2]:
            best = packed
    return best[2] if best else None


def fetch_kis_rating(entry: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    queries = unique_queries(entry)
    query_used = ""
    for query in queries:
        data = http_post_json(
            KIS_SEARCH_URL,
            {"sortId": "upcheOpt", "asc": "asc", "searchType": "1", "searchKeyword": query},
            timeout=HTTP_TIMEOUT,
        )
        candidate_rows = data.get("dataList") or []
        if candidate_rows:
            rows.extend(candidate_rows)
            query_used = query
        best = pick_best_kis_row(entry, rows)
        if best:
            break
        time.sleep(0.1)

    best = pick_best_kis_row(entry, rows)
    if not best:
        return {"ok": False, "source": "KIS", "query": query_used or (queries[0] if queries else ""), "items": [], "message": "no matching public company-search row"}

    field_map = [
        ("bond1Grade", "bond1Watch", "company_bond"),
        ("bond2Grade", "bond2Watch", "company_bond_alt"),
        ("corpGrade", "corpWatch", "corporate_credit"),
        ("cpGrade", "cpWatch", "commercial_paper"),
        ("stbGrade", "stbWatch", "short_term_bond"),
        ("absGrade", "absWatch", "abs"),
    ]
    items: list[RatingItem] = []
    for grade_field, watch_field, product in field_map:
        rating, outlook = split_rating_outlook(best.get(grade_field))
        watch = compact_text(best.get(watch_field))
        if watch and watch != "-":
            outlook = outlook or watch
        if rating:
            items.append(
                RatingItem(
                    agency="한국신용평가",
                    product=product,
                    rating=rating,
                    outlook=outlook,
                    source="KIS 회사별 등급검색",
                    source_url=KIS_SEARCH_PAGE,
                    raw=compact_text(best.get(grade_field)),
                )
            )
    return {
        "ok": bool(items),
        "source": "KIS",
        "query": query_used,
        "matched_name": compact_text(best.get("upcheOpt")),
        "matched_code": compact_text(best.get("kiscd")),
        "items": [item.as_dict() for item in items],
        "message": "ok" if items else "matched row has no public rating fields",
    }


def html_table_by_id(page_html: str, table_id: str) -> str:
    match = re.search(
        rf"<table\b[^>]*\bid=[\"']{re.escape(table_id)}[\"'][^>]*>(.*?)</table>",
        page_html,
        re.I | re.S,
    )
    return match.group(1) if match else ""


def parse_html_table_rows(table_html: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for tr in re.findall(r"<tr\b[^>]*>(.*?)</tr>", table_html, flags=re.I | re.S):
        cells = re.findall(r"<td\b[^>]*>(.*?)</td>", tr, flags=re.I | re.S)
        if not cells:
            continue
        cell_texts = [strip_html(cell) for cell in cells]
        cmp_match = re.search(r"goView\([\"']BOND[\"']\s*,\s*[\"']([^\"']+)[\"']\)", tr)
        rows.append({"cells": cell_texts, "cmp_cd": cmp_match.group(1) if cmp_match else ""})
    return rows


def pick_best_nice_row(entry: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    best: tuple[float, int, dict[str, Any]] | None = None
    for row in rows:
        cells = row.get("cells") or []
        if len(cells) < 7:
            continue
        name = cells[0]
        score = row_match_score(entry, name)
        if score < 0.65:
            continue
        rating_count = sum(1 for cell in cells[1:7] if meaningful_rating(cell))
        rank = min((rating_rank(cell) for cell in (cells[1], cells[4]) if meaningful_rating(cell)), default=999)
        packed = (score, rating_count * 1000 - rank, row)
        if best is None or packed[:2] > best[:2]:
            best = packed
    return best[2] if best else None


def fetch_nice_rating(entry: dict[str, Any]) -> dict[str, Any]:
    query_used = ""
    best: dict[str, Any] | None = None
    for query in unique_queries(entry):
        query_used = query
        page = http_get_text(NICE_SEARCH_URL, {"searchText": query}, timeout=HTTP_TIMEOUT)
        table = html_table_by_id(page, "tbl1")
        rows = parse_html_table_rows(table)
        best = pick_best_nice_row(entry, rows)
        if best:
            break
        time.sleep(0.1)

    if not best:
        return {"ok": False, "source": "NICE", "query": query_used, "items": [], "message": "no matching public company-search row"}

    cells = best.get("cells") or []
    labels = [
        ("company_bond", "회사채"),
        ("commercial_paper", "기업어음"),
        ("short_term_bond", "전자단기사채"),
        ("corporate_credit", "기업신용등급"),
        ("ifsr", "보험금지급능력"),
        ("abs", "자산유동화"),
    ]
    items: list[RatingItem] = []
    for idx, (product, _label) in enumerate(labels, 1):
        if idx >= len(cells):
            continue
        rating, outlook = split_rating_outlook(cells[idx])
        if rating:
            items.append(
                RatingItem(
                    agency="NICE신용평가",
                    product=product,
                    rating=rating,
                    outlook=outlook,
                    source="NICE 기업별 등급검색",
                    source_url=f"{NICE_SEARCH_URL}?{urllib.parse.urlencode({'searchText': query_used})}",
                    raw=cells[idx],
                )
            )
    return {
        "ok": bool(items),
        "source": "NICE",
        "query": query_used,
        "matched_name": cells[0] if cells else "",
        "matched_code": compact_text(best.get("cmp_cd")),
        "items": [item.as_dict() for item in items],
        "message": "ok" if items else "matched row has no public rating fields",
    }


def parse_dart_date(value: Any) -> str:
    text = compact_text(value)
    match = re.search(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
    match = re.search(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
    return text


def parse_dart_rating_items(raw: str) -> list[RatingItem]:
    text = compact_text(raw)
    if not text or text == "-":
        return []

    items: list[RatingItem] = []
    agency_patterns = [
        ("한국신용평가", r"한국신용평가(?:\(주\))?\s*[\(:]\s*([A-Z0-9+\-]+(?:\s*\([^)]+\))?)"),
        ("한국기업평가", r"한국기업평가(?:\(주\))?\s*[\(:]\s*([A-Z0-9+\-]+(?:\s*\([^)]+\))?)"),
        ("NICE신용평가", r"(?:NICE신용평가|나이스신용평가)(?:\(주\))?\s*[\(:]\s*([A-Z0-9+\-]+(?:\s*\([^)]+\))?)"),
    ]
    for agency, pattern in agency_patterns:
        for match in re.finditer(pattern, text):
            rating, outlook = split_rating_outlook(match.group(1))
            if rating:
                items.append(RatingItem(agency=agency, product="dart_bond", rating=rating, outlook=outlook, source="OpenDART 채무증권", source_url="https://opendart.fss.or.kr/", raw=text))

    if items:
        return items

    # Common DART shape: "AA+(안정적) / AA+(안정적) (한국기업평가(주) / 한국신용평가(주))"
    agency_tail = re.search(r"\(([^()]*(?:한국기업평가|한국신용평가|NICE신용평가|나이스신용평가)[^()]*)\)\s*$", text)
    ratings_part = text
    agency_names: list[str] = []
    if agency_tail:
        ratings_part = text[: agency_tail.start()]
        for agency_text in re.split(r"/|,|·", agency_tail.group(1)):
            agency_text = compact_text(agency_text)
            if "한국신용" in agency_text:
                agency_names.append("한국신용평가")
            elif "한국기업" in agency_text:
                agency_names.append("한국기업평가")
            elif "NICE" in agency_text or "나이스" in agency_text:
                agency_names.append("NICE신용평가")

    rating_values = [split_rating_outlook(part) for part in re.split(r"/|,|·", ratings_part)]
    rating_values = [(rating, outlook) for rating, outlook in rating_values if rating]
    for idx, (rating, outlook) in enumerate(rating_values):
        agency = agency_names[idx] if idx < len(agency_names) else "OpenDART"
        items.append(RatingItem(agency=agency, product="dart_bond", rating=rating, outlook=outlook, source="OpenDART 채무증권", source_url="https://opendart.fss.or.kr/", raw=text))
    return items


def fetch_dart_rating(api_key: str, corp_code: str, start_date: str, end_date: str) -> dict[str, Any]:
    data = http_get_json(
        OPENDART_BOND_URL,
        {"crtfc_key": api_key, "corp_code": corp_code, "bgn_de": start_date, "end_de": end_date},
        timeout=HTTP_TIMEOUT,
    )
    rows: list[dict[str, Any]] = []
    for group in data.get("group") or []:
        for item in group.get("list") or []:
            raw = compact_text(item.get("cdrt_int"))
            if not raw or raw == "-":
                continue
            parsed = [rating.as_dict() for rating in parse_dart_rating_items(raw)]
            if parsed:
                rows.append(
                    {
                        "issue_name": compact_text(item.get("bdnmn")),
                        "round": compact_text(item.get("tm")),
                        "issue_amount": compact_text(item.get("slta")),
                        "issue_date": parse_dart_date(item.get("pymd")),
                        "maturity_date": parse_dart_date(item.get("rpd")),
                        "raw_rating": raw,
                        "receipt_no": compact_text(item.get("rcept_no")),
                        "source_url": f"{DART_VIEWER_URL}{compact_text(item.get('rcept_no'))}" if item.get("rcept_no") else "https://opendart.fss.or.kr/",
                        "items": parsed,
                    }
                )

    rows.sort(key=lambda row: row.get("issue_date") or "", reverse=True)
    flattened: list[dict[str, Any]] = []
    for row in rows:
        for item in row["items"]:
            packed = dict(item)
            packed["date"] = row.get("issue_date") or packed.get("date", "")
            packed["source_url"] = row.get("source_url") or packed.get("source_url", "")
            packed["raw"] = row.get("raw_rating") or packed.get("raw", "")
            flattened.append(packed)

    return {
        "ok": bool(flattened),
        "status": data.get("status", ""),
        "message": data.get("message", ""),
        "items": flattened[:8],
        "bond_rows": rows[:5],
    }


def long_term_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    preferred = [item for item in items if item.get("product") in LONG_TERM_PRODUCTS or item.get("product") == "dart_bond"]
    return preferred or items


def choose_representative_rating(sources: list[dict[str, Any]]) -> dict[str, Any]:
    priority = {"NICE": 1, "KIS": 2, "OpenDART": 3}
    candidates: list[dict[str, Any]] = []
    for source in sources:
        source_name = source.get("source") or ""
        for item in long_term_items(source.get("items") or []):
            rating = normalize_rating(item.get("rating"))
            if not rating:
                continue
            packed = dict(item)
            packed["_source_priority"] = priority.get(source_name, 9)
            packed["_rating_rank"] = rating_rank(rating)
            candidates.append(packed)
    if not candidates:
        return {}
    candidates.sort(key=lambda item: (item["_source_priority"], item["_rating_rank"]))
    rep = dict(candidates[0])
    rep.pop("_source_priority", None)
    rep.pop("_rating_rank", None)
    return rep


def compact_rating_label(item: dict[str, Any]) -> str:
    rating = normalize_rating(item.get("rating"))
    outlook = compact_text(item.get("outlook"))
    if not rating:
        return ""
    if outlook:
        return f"{rating} / {outlook}"
    return rating


def collect_company_rating(
    entry: dict[str, Any],
    dart_api_key: str,
    corp_index: dict[str, Any],
    start_date: str,
    end_date: str,
    dart_mode: str = "fallback",
) -> dict[str, Any]:
    sources: list[dict[str, Any]] = []
    errors: list[str] = []

    for fetcher in (fetch_kis_rating, fetch_nice_rating):
        try:
            result = fetcher(entry)
        except Exception as exc:
            result = {"ok": False, "source": fetcher.__name__, "items": [], "message": f"{type(exc).__name__}: {exc}"}
        sources.append(result)
        if not result.get("ok"):
            errors.append(f"{result.get('source')}: {result.get('message')}")

    representative = choose_representative_rating(sources)
    should_fetch_dart = dart_mode == "always" or (dart_mode == "fallback" and not representative)
    if should_fetch_dart:
        dart_match = match_company(entry, corp_index)
        if dart_match:
            try:
                dart_result = fetch_dart_rating(dart_api_key, dart_match.corp_code, start_date, end_date)
            except Exception as exc:
                dart_result = {"ok": False, "status": "", "message": f"{type(exc).__name__}: {exc}", "items": []}
            sources.append(
                {
                    "ok": dart_result.get("ok"),
                    "source": "OpenDART",
                    "matched_name": dart_match.corp_name,
                    "matched_code": dart_match.corp_code,
                    "stock_code": dart_match.stock_code,
                    "items": dart_result.get("items") or [],
                    "bond_rows": dart_result.get("bond_rows") or [],
                    "message": dart_result.get("message") or "",
                }
            )
            if not dart_result.get("ok"):
                errors.append(f"OpenDART: {dart_result.get('message')}")
        else:
            errors.append("OpenDART: no corp-code match")
            sources.append({"ok": False, "source": "OpenDART", "items": [], "message": "no corp-code match"})
        representative = choose_representative_rating(sources)
    return {
        "company": entry.get("company"),
        "aliases": entry.get("aliases") or [],
        "sources_in_rankings": entry.get("sources") or [],
        "status": "ready" if representative else "empty",
        "representative": representative,
        "rating_label": compact_rating_label(representative),
        "sources": sources,
        "messages": errors,
    }


def default_start_date(end_date: str, years: int) -> str:
    end = datetime.strptime(end_date, "%Y%m%d")
    return end.replace(year=end.year - years).strftime("%Y%m%d")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect public credit ratings for companies shown in construction_source_status.")
    parser.add_argument("--end-date", default=datetime.now(KST).strftime("%Y%m%d"))
    parser.add_argument("--start-date", default="")
    parser.add_argument("--lookback-years", type=int, default=5)
    parser.add_argument("--scope", choices=["cak", "all"], default="cak", help="cak collects only the current CAK top 30; all scans every mapped dashboard company.")
    parser.add_argument("--company-limit", type=int, default=0)
    parser.add_argument("--dart-mode", choices=["fallback", "always", "off"], default="fallback")
    parser.add_argument("--refresh-corp-code", action="store_true")
    parser.add_argument("--output", default=str(CREDIT_CACHE_OUT))
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    start_date = args.start_date or default_start_date(args.end_date, args.lookback_years)

    env_file, key_name, dart_api_key = pick_dart_key()
    key_status = validate_key(dart_api_key)
    corp_xml = download_corp_code(dart_api_key, refresh=args.refresh_corp_code)
    corp_rows = parse_corp_codes(corp_xml)
    corp_index = build_corp_index(corp_rows)

    targets = collect_credit_targets(args.scope, args.company_limit)

    companies: list[dict[str, Any]] = []
    for idx, entry in enumerate(targets, 1):
        print(f"[{idx}/{len(targets)}] {entry.get('company')}")
        companies.append(collect_company_rating(entry, dart_api_key, corp_index, start_date, args.end_date, args.dart_mode))
        time.sleep(0.2)

    ready_count = sum(1 for item in companies if item.get("status") == "ready")
    payload = {
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST"),
        "source_note": "KIS/NICE 공개 회사별 등급검색에서 확인되는 신평사 등급을 우선 수집하고, OpenDART 채무증권 API의 신용등급 필드로 보조했습니다. 한국기업평가 유효등급 List 및 NICE 유효등급 리스트는 로그인/유료 영역이므로 자동 수집 대상에서 제외했습니다.",
        "query": {
            "start_date": start_date,
            "end_date": args.end_date,
            "lookback_years": args.lookback_years,
            "scope": args.scope,
            "dart_mode": args.dart_mode,
            "key_source": f"{env_file}:{key_name}",
            "kis_source_url": KIS_SEARCH_PAGE,
            "nice_source_url": NICE_SEARCH_URL,
            "opendart_source_url": "https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS006&apiId=2020055",
            "dart_key_status": key_status,
        },
        "companies_collected": len(targets),
        "companies_with_rating": ready_count,
        "companies": companies,
    }

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}")
    print(f"Companies with rating: {ready_count}/{len(targets)}")


if __name__ == "__main__":
    main()
