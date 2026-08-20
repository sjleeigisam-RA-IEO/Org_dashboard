from __future__ import annotations

import argparse
import html
import io
import json
import re
import time
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "03. Construction Board" / "data"
SOURCE_STATUS_DATA = OUTPUT_DIR / "construction_source_status_data.json"
SOURCE_MAP_PATH = ROOT / "03. Construction Board" / "data" / "construction_company_source_map.json"
DART_CACHE_OUT = OUTPUT_DIR / "construction_dart_awards_cache.json"
CORP_CODE_CACHE = OUTPUT_DIR / "_dart_cache" / "CORPCODE.xml"

ENV_PATHS = [ROOT / ".env", ROOT / "51. IOTA_platform" / ".env"]
DART_KEY_NAMES = ("OPENDART_KEY", "OPEN_DART_KEY", "DART_KEY", "CRTFC_KEY", "crtfc_key", "key")

KST = timezone(timedelta(hours=9))
USER_AGENT = "RA-dashboard/0.1"
CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml"
COMPANY_URL = "https://opendart.fss.or.kr/api/company.json"
LIST_URL = "https://opendart.fss.or.kr/api/list.json"
DOCUMENT_URL = "https://opendart.fss.or.kr/api/document.xml"
DART_VIEWER_URL = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo="

CORP_TERMS = [
    "주식회사",
    "유한회사",
    "합자회사",
    "합명회사",
    "재단법인",
    "사단법인",
    "학교법인",
    "의료법인",
    "사회복지법인",
    "농업회사법인",
    "법무법인",
    "회계법인",
    "세무법인",
    "특허법인",
    "노무법인",
    "관세법인",
    "투자회사",
    "자산운용",
    "사모투자",
    "㈜",
    "(주)",
    "（주）",
    "(유)",
    "（유）",
    "(사)",
    "(재)",
    "(의)",
]


@dataclass(frozen=True)
class CorpMatch:
    corp_code: str
    corp_name: str
    corp_eng_name: str
    stock_code: str
    score: float
    method: str
    alias_used: str


def compact_text(value: Any) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"\s+", " ", text).strip()


def read_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


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


def pick_dart_key() -> tuple[str, str, str]:
    for env_path in ENV_PATHS:
        env = read_env(env_path)
        for key_name in DART_KEY_NAMES:
            value = env.get(key_name, "").strip()
            if value:
                return str(env_path.relative_to(ROOT)), key_name, value
    raise RuntimeError("OpenDART API key not found in project .env files.")


def http_get_bytes(url: str, params: dict[str, str], timeout: int = 60) -> bytes:
    req_url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(req_url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def http_get_json(url: str, params: dict[str, str], timeout: int = 60) -> dict[str, Any]:
    body = http_get_bytes(url, params, timeout=timeout)
    return json.loads(body.decode("utf-8-sig"))


def validate_key(api_key: str) -> dict[str, str]:
    data = http_get_json(COMPANY_URL, {"crtfc_key": api_key, "corp_code": "00126380"}, timeout=20)
    return {
        "status": data.get("status", ""),
        "message": data.get("message", ""),
        "sample_corp_name": data.get("corp_name", ""),
    }


def download_corp_code(api_key: str, *, refresh: bool) -> Path:
    if CORP_CODE_CACHE.exists() and not refresh:
        return CORP_CODE_CACHE

    CORP_CODE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    body = http_get_bytes(CORP_CODE_URL, {"crtfc_key": api_key}, timeout=120)
    if body[:2] != b"PK":
        raise RuntimeError("OpenDART corpCode response was not a ZIP file.")

    with zipfile.ZipFile(io.BytesIO(body)) as zf:
        xml_name = next((name for name in zf.namelist() if name.lower().endswith(".xml")), "")
        if not xml_name:
            raise RuntimeError("CORPCODE XML not found inside OpenDART ZIP.")
        CORP_CODE_CACHE.write_bytes(zf.read(xml_name))
    return CORP_CODE_CACHE


def text_or_empty(node: ElementTree.Element, tag: str) -> str:
    child = node.find(tag)
    return (child.text or "").strip() if child is not None else ""


def parse_corp_codes(xml_path: Path) -> list[dict[str, str]]:
    root = ElementTree.parse(xml_path).getroot()
    rows: list[dict[str, str]] = []
    for item in root.findall(".//list"):
        rows.append(
            {
                "corp_code": text_or_empty(item, "corp_code"),
                "corp_name": text_or_empty(item, "corp_name"),
                "corp_eng_name": text_or_empty(item, "corp_eng_name"),
                "stock_code": text_or_empty(item, "stock_code"),
                "modify_date": text_or_empty(item, "modify_date"),
            }
        )
    return rows


def normalize_company(value: Any) -> str:
    text = compact_text(value).lower()
    text = text.replace("&", "앤").replace("+", "플러스")
    text = re.sub(r"\bco\.?,?\s*ltd\.?\b", "", text)
    text = re.sub(r"\bltd\.?\b", "", text)
    text = re.sub(r"\binc\.?\b", "", text)
    text = re.sub(r"\bcorp\.?\b", "", text)
    text = re.sub(r"\bllc\b", "", text)
    text = re.sub(r"\bplc\b", "", text)
    for term in CORP_TERMS:
        text = text.replace(term.lower(), "")
    text = re.sub(r"[\s\.\,\-_/\\·ㆍ:;~!?\[\]\{\}\"'`|]", "", text)
    text = re.sub(r"[()（）]", "", text)
    return text.strip()


def add_unique(items: list[str], value: Any) -> None:
    text = compact_text(value)
    if text and text not in items:
        items.append(text)


def company_aliases(company: str, extra_aliases: list[str] | None = None) -> list[str]:
    aliases: list[str] = []
    add_unique(aliases, company)
    add_unique(aliases, re.sub(r"[\(（][^\)）]+[\)）]", "", company))
    for chunk in re.findall(r"[\(（]([^\)）]+)[\)）]", company):
        add_unique(aliases, chunk)
    for alias in extra_aliases or []:
        add_unique(aliases, alias)
        add_unique(aliases, re.sub(r"[\(（][^\)）]+[\)）]", "", alias))
    return aliases


def merge_company_entry(entries: dict[str, dict[str, Any]], company: str, source: str, aliases: list[str] | None = None) -> None:
    key = normalize_company(company)
    if not key:
        return
    entry = entries.setdefault(
        key,
        {
            "company": compact_text(company),
            "aliases": [],
            "sources": [],
        },
    )
    for alias in company_aliases(company, aliases):
        add_unique(entry["aliases"], alias)
    add_unique(entry["sources"], source)


def collect_target_companies() -> list[dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}

    source_map = read_json_file(SOURCE_MAP_PATH)
    for item in source_map.get("companies", []):
        merge_company_entry(entries, item.get("company", ""), "source_map", item.get("aliases") or [])

    source_data = read_json_file(SOURCE_STATUS_DATA)
    row_sets = [
        ("cak", "rows"),
        ("cm", "rows"),
        ("etis", "overall_rows"),
        ("etis", "construction_rows"),
        ("kacem", "rows"),
    ]
    for source_key, row_key in row_sets:
        wrapper = source_data.get(source_key) or {}
        if not wrapper.get("ok"):
            continue
        for row in (wrapper.get("data") or {}).get(row_key, []) or []:
            merge_company_entry(entries, row.get("company", ""), f"{source_key}.{row_key}")

    return sorted(entries.values(), key=lambda item: item["company"])


def build_corp_index(corp_rows: list[dict[str, str]]) -> dict[str, Any]:
    by_norm: dict[str, list[dict[str, str]]] = defaultdict(list)
    by_first: dict[str, list[tuple[str, dict[str, str]]]] = defaultdict(list)
    normalized_rows: list[tuple[str, dict[str, str]]] = []
    for row in corp_rows:
        norm = normalize_company(row.get("corp_name"))
        if not norm:
            continue
        by_norm[norm].append(row)
        by_first[norm[0]].append((norm, row))
        normalized_rows.append((norm, row))
    return {"by_norm": by_norm, "by_first": by_first, "rows": normalized_rows}


def choose_corp_candidate(candidates: list[dict[str, str]]) -> dict[str, str]:
    return sorted(
        candidates,
        key=lambda row: (
            0 if row.get("stock_code") else 1,
            len(row.get("corp_name", "")),
            row.get("corp_name", ""),
        ),
    )[0]


def match_company(entry: dict[str, Any], corp_index: dict[str, Any]) -> CorpMatch | None:
    aliases = company_aliases(entry["company"], entry.get("aliases") or [])
    by_norm: dict[str, list[dict[str, str]]] = corp_index["by_norm"]
    by_first: dict[str, list[tuple[str, dict[str, str]]]] = corp_index["by_first"]

    for alias in aliases:
        alias_norm = normalize_company(alias)
        if not alias_norm:
            continue
        exact = by_norm.get(alias_norm)
        if exact:
            row = choose_corp_candidate(exact)
            return CorpMatch(row["corp_code"], row["corp_name"], row["corp_eng_name"], row["stock_code"], 1.0, "exact", alias)

    best: tuple[float, str, dict[str, str], str] | None = None
    for alias in aliases:
        alias_norm = normalize_company(alias)
        if len(alias_norm) < 2:
            continue
        for corp_norm, row in by_first.get(alias_norm[0], []):
            substring_match = alias_norm in corp_norm or corp_norm in alias_norm
            if substring_match:
                score = min(len(alias_norm), len(corp_norm)) / max(len(alias_norm), len(corp_norm))
            else:
                score = SequenceMatcher(None, alias_norm, corp_norm).ratio()
            if score < 0.9:
                continue
            if best is None or score > best[0] or (score == best[0] and row.get("stock_code") and not best[2].get("stock_code")):
                best = (score, alias, row, "contains" if substring_match else "fuzzy")

    if not best:
        return None
    score, alias, row, method = best
    return CorpMatch(row["corp_code"], row["corp_name"], row["corp_eng_name"], row["stock_code"], score, method, alias)


def is_contract_report(report_name: str) -> bool:
    text = compact_text(report_name)
    if "단일판매" not in text or "공급계약체결" not in text:
        return False
    if "해지" in text:
        return False
    return True


def list_contract_reports(api_key: str, corp_code: str, start_date: str, end_date: str) -> list[dict[str, Any]]:
    first = http_get_json(
        LIST_URL,
        {
            "crtfc_key": api_key,
            "corp_code": corp_code,
            "bgn_de": start_date,
            "end_de": end_date,
            "page_no": "1",
            "page_count": "100",
        },
        timeout=60,
    )
    if first.get("status") == "013":
        return []
    if first.get("status") != "000":
        raise RuntimeError(f"DART list status {first.get('status')}: {first.get('message')}")

    reports: list[dict[str, Any]] = []
    total_pages = int(first.get("total_page") or 1)
    for page in range(1, total_pages + 1):
        data = first
        if page > 1:
            data = http_get_json(
                LIST_URL,
                {
                    "crtfc_key": api_key,
                    "corp_code": corp_code,
                    "bgn_de": start_date,
                    "end_de": end_date,
                    "page_no": str(page),
                    "page_count": "100",
                },
                timeout=60,
            )
        reports.extend(report for report in data.get("list", []) if is_contract_report(report.get("report_nm", "")))
    return reports


def decode_document_bytes(body: bytes) -> str:
    if body[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            xml_name = next((name for name in zf.namelist() if name.lower().endswith(".xml")), zf.namelist()[0])
            body = zf.read(xml_name)
    for encoding in ("utf-8", "euc-kr", "cp949"):
        try:
            return body.decode(encoding)
        except UnicodeDecodeError:
            continue
    return body.decode("utf-8", "replace")


def fetch_document_text(api_key: str, receipt_no: str) -> str:
    body = http_get_bytes(DOCUMENT_URL, {"crtfc_key": api_key, "rcept_no": receipt_no}, timeout=60)
    return decode_document_bytes(body)


def strip_cell(value: str) -> str:
    value = re.sub(r"<br[^>]*>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return compact_text(value)


def strip_document_text(value: str) -> str:
    value = re.sub(r"<br[^>]*>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return compact_text(value)


def document_rows(document_text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for row_match in re.finditer(r"<tr[^>]*>(.*?)</tr>", document_text, flags=re.I | re.S):
        cells = [strip_cell(cell.group(1)) for cell in re.finditer(r"<td\b[^>]*>(.*?)</td>", row_match.group(1), flags=re.I | re.S)]
        cells = [cell for cell in cells if cell]
        if cells:
            rows.append(cells)
    return rows


def find_row_value(rows: list[list[str]], *labels: str) -> str:
    for cells in rows:
        for index, cell in enumerate(cells[:-1]):
            cleaned = re.sub(r"^\d+\.\s*", "", cell)
            if any(label in cleaned for label in labels):
                return cells[index + 1]
    return ""


def parse_krw(value: str) -> int:
    text = compact_text(value)
    number_tokens = re.findall(r"-?\d[\d,]*(?:\.\d+)?", text)
    if not number_tokens:
        return 0
    numbers: list[int] = []
    for token in number_tokens:
        if "." in token:
            continue
        cleaned = token.replace(",", "")
        try:
            numbers.append(int(cleaned))
        except ValueError:
            continue
    return max(numbers, key=abs) if numbers else 0


def format_krw_to_eok(value: str) -> str:
    krw = parse_krw(value)
    if not krw:
        return compact_text(value)
    eok = krw / 100_000_000
    if eok >= 100:
        return f"{eok:,.0f}억원"
    if eok >= 10:
        return f"{eok:,.1f}억원"
    return f"{eok:,.2f}억원"


def parse_floor_area_m2(document_text: str) -> float:
    text = strip_document_text(document_text)
    patterns = [
        r"(?:건축)?연면적\s*[:：]?\s*([0-9,]+(?:\.\d+)?)\s*(?:㎡|m2|M2|제곱미터)",
        r"연\s*면\s*적\s*[:：]?\s*([0-9,]+(?:\.\d+)?)\s*(?:㎡|m2|M2|제곱미터)",
    ]
    matches: list[float] = []
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            try:
                matches.append(float(match.group(1).replace(",", "")))
            except ValueError:
                continue
    return max(matches) if matches else 0.0


def format_float(value: float) -> str:
    if value <= 0:
        return ""
    return f"{value:.4f}".rstrip("0").rstrip(".")


def parse_contract_document(document_text: str) -> dict[str, str]:
    rows = document_rows(document_text)
    divider_indexes = [index for index, row in enumerate(rows) if len(row) == 1 and row[0] == "-"]
    if divider_indexes and divider_indexes[-1] + 1 < len(rows):
        rows = rows[divider_indexes[-1] + 1 :]
    amount_raw = find_row_value(rows, "계약금액(원)", "계약금액")
    amount_krw = parse_krw(amount_raw)
    floor_area_m2 = parse_floor_area_m2(document_text)
    unit_cost_krw_per_m2 = int(round(amount_krw / floor_area_m2)) if amount_krw and floor_area_m2 else 0
    unit_cost_krw_per_py = int(round(unit_cost_krw_per_m2 * 3.305785)) if unit_cost_krw_per_m2 else 0
    return {
        "project": find_row_value(rows, "계약명"),
        "client": find_row_value(rows, "계약상대"),
        "amount": format_krw_to_eok(amount_raw),
        "amount_krw": str(amount_krw or ""),
        "floor_area_m2": format_float(floor_area_m2),
        "unit_cost_krw_per_m2": str(unit_cost_krw_per_m2 or ""),
        "unit_cost_krw_per_py": str(unit_cost_krw_per_py or ""),
        "category": find_row_value(rows, "판매ㆍ공급계약 구분", "판매·공급계약 구분") or "DART 공급계약",
        "region": find_row_value(rows, "판매ㆍ공급지역", "판매·공급지역"),
        "start_date": find_row_value(rows, "시작일"),
        "end_date": find_row_value(rows, "종료일"),
    }


def format_report_date(value: str) -> str:
    text = compact_text(value)
    if re.fullmatch(r"\d{8}", text):
        return f"{text[:4]}.{text[4:6]}.{text[6:8]}"
    return text


def lookback_start_date(today: datetime, years: int) -> str:
    try:
        start = today.replace(year=today.year - years)
    except ValueError:
        start = today.replace(year=today.year - years, day=28)
    return start.strftime("%Y%m%d")


def report_date_key(report: dict[str, Any]) -> str:
    return compact_text(report.get("rcept_dt"))


def award_key(award: dict[str, Any]) -> tuple[str, str]:
    return (normalize_company(award.get("project")), normalize_company(award.get("client")))


def make_award(report: dict[str, Any], detail: dict[str, str]) -> dict[str, Any]:
    receipt_no = compact_text(report.get("rcept_no"))
    return {
        "project": detail.get("project") or compact_text(report.get("report_nm")) or "단일판매ㆍ공급계약체결",
        "client": detail.get("client") or compact_text(report.get("flr_nm")) or "-",
        "amount": detail.get("amount") or "-",
        "category": detail.get("category") or "DART 공급계약",
        "date": format_report_date(compact_text(report.get("rcept_dt"))),
        "source_name": "OpenDART",
        "source_url": f"{DART_VIEWER_URL}{receipt_no}" if receipt_no else "https://opendart.fss.or.kr/",
        "receipt_no": receipt_no,
        "report_name": compact_text(report.get("report_nm")),
        "region": detail.get("region") or "",
        "contract_period": " ~ ".join(part for part in [detail.get("start_date"), detail.get("end_date")] if part),
        "amount_krw": detail.get("amount_krw") or "",
        "floor_area_m2": detail.get("floor_area_m2") or "",
        "unit_cost_krw_per_m2": detail.get("unit_cost_krw_per_m2") or "",
        "unit_cost_krw_per_py": detail.get("unit_cost_krw_per_py") or "",
    }


def fetch_company_awards(
    api_key: str,
    match: CorpMatch,
    *,
    start_date: str,
    end_date: str,
    per_company: int,
    delay: float,
) -> list[dict[str, Any]]:
    reports = list_contract_reports(api_key, match.corp_code, start_date, end_date)
    awards: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for report in sorted(reports, key=report_date_key, reverse=True):
        receipt_no = compact_text(report.get("rcept_no"))
        if not receipt_no:
            continue
        document_text = fetch_document_text(api_key, receipt_no)
        detail = parse_contract_document(document_text)
        award = make_award(report, detail)
        key = award_key(award)
        if key == ("", ""):
            key = (receipt_no, receipt_no)
        if key in seen:
            continue
        awards.append(award)
        seen.add(key)
        if len(awards) >= per_company:
            break
        if delay:
            time.sleep(delay)
    return awards


def parse_args() -> argparse.Namespace:
    today = datetime.now(KST)
    parser = argparse.ArgumentParser(description="Update recent construction awards from OpenDART disclosures.")
    parser.add_argument("--start-date", default="", help="DART query start date, YYYYMMDD. Default: today minus --lookback-years.")
    parser.add_argument("--end-date", default=today.strftime("%Y%m%d"), help="DART query end date, YYYYMMDD. Default: today.")
    parser.add_argument("--lookback-years", type=int, default=5, help="Default lookback window when --start-date is omitted.")
    parser.add_argument("--per-company", type=int, default=5, help="Maximum unique DART awards per company.")
    parser.add_argument("--company-limit", type=int, default=0, help="Limit matched companies for testing. 0 means no limit.")
    parser.add_argument("--delay", type=float, default=0.05, help="Delay between document API calls.")
    parser.add_argument("--refresh-corp-code", action="store_true", help="Download fresh OpenDART corpCode.xml.")
    parser.add_argument("--output", type=Path, default=DART_CACHE_OUT, help="Output JSON cache path.")
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
            awards = fetch_company_awards(
                api_key,
                match,
                start_date=args.start_date,
                end_date=args.end_date,
                per_company=args.per_company,
                delay=args.delay,
            )
            print(f"[{index}/{len(matched)}] {entry['company']} -> {len(awards)} DART awards")
        except Exception as exc:
            errors.append({"company": entry["company"], "error": f"{type(exc).__name__}: {exc}"})
            print(f"[{index}/{len(matched)}] {entry['company']} -> error: {type(exc).__name__}")
            continue

        if not awards:
            continue
        aliases = company_aliases(entry["company"], entry.get("aliases") or [])
        add_unique(aliases, match.corp_name)
        companies.append(
            {
                "company": entry["company"],
                "aliases": aliases,
                "source_name": "OpenDART",
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
                "awards": awards,
            }
        )

    payload = {
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST"),
        "source_note": "OpenDART API에서 현재 화면 대상 회사의 단일판매ㆍ공급계약체결 공시를 조회해 생성한 자동 캐시입니다. 비상장/비외감 회사, 조합 수주, 나라장터 계약, 민간 보도성 수주는 별도 소스가 필요합니다.",
        "query": {
            "start_date": args.start_date,
            "end_date": args.end_date,
            "lookback_years": args.lookback_years,
            "per_company": args.per_company,
            "key_source": f"{env_file}:{key_name}",
        },
        "companies_collected": len(targets),
        "companies_matched": len(matched),
        "companies_with_awards": len(companies),
        "unmatched_companies": unmatched,
        "errors": errors,
        "companies": companies,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
