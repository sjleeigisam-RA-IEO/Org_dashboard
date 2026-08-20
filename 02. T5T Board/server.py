"""
T5T Dashboard - Web Server
Loads cached Notion JSON, computes dashboard aggregates, and serves the static app.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Any
from urllib.parse import urlparse

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(BASE_DIR, "data")
STATIC_DIR = BASE_DIR
RULES_PATH = os.path.join(BASE_DIR, "intelligence_rules.json")
CLUSTER_RULES_PATH = os.path.join(BASE_DIR, "token_cluster_rules.json")
PORT = 8050

TASK_TYPE_ORDER = ["운용/관리", "신규검토", "프로젝트", "펀드·투자자", "리스크·법무", "내부·기타"]
ISSUE_CATEGORY_ORDER = ["딜 진행", "금융 구조", "인허가/행정", "운용/관리", "리스크·법무", "투자자 대응", "신규검토"]
STAKEHOLDER_TYPE_ORDER = [
    "기관투자자(LP)",
    "금융기관(대주)",
    "임차인",
    "매수/매도인",
    "주간사/자문",
    "공공/행정기관",
    "해외 파트너",
]
SUMMARY_FIELD_ALIASES = [
    "classification_summary",
    "분류 요약",
    "분류요약",
    "구조화 요약",
    "구조화요약",
    "원문 요약",
]
TOKEN_FIELD_ALIASES = [
    "classification_tokens",
    "분류 토큰",
    "분류토큰",
    "요약 토큰",
    "요약토큰",
    "해시태그 토큰",
    "해시태그",
    "주요 키워드",
    "주요키워드",
    "키워드",
    "태그",
]

LOW_SIGNAL_TOKEN_PATTERNS = [
    re.compile(r"^(진행|협의|검토|논의|준비|추진|대응|보고|확인|작업|정리|공유)(중|중인|중임)$"),
    re.compile(r"^(진행|협의|검토|논의|준비|추진|대응|보고|확인|작업|정리|공유)하고$"),
    re.compile(r"^(진행|협의|검토|논의|준비|추진|대응|보고|확인|작업|정리|공유)(하는|하며|하고있는|중으로)$"),
    re.compile(r"^(진행|협의|검토|논의|준비|추진|대응|보고|확인|작업|정리|공유)(을|를|은|는|이|가|와|과|도|만)$"),
]

DEFAULT_RULES = {
    "issue_categories": {
        "딜 진행": {
            "keyword_signals": ["매각", "매입", "입찰", "우협", "클로징", "계약", "SPA", "MOU", "LOI", "의향서"],
            "strong_signals": ["매각", "매입", "입찰", "우협", "우선협상대상자", "클로징", "closing", "계약", "SPA", "MOU", "LOI", "의향서", "선매수"],
            "context_signals": ["매수인", "매도인", "협상", "매수의향", "매도의향", "계약서", "제안서", "수주"],
            "weak_signals": ["체결", "참여", "제안"],
            "exclude_signals": ["인허가", "사전협상", "심의", "서울시", "구청"],
            "min_score": 3,
        },
        "금융 구조": {
            "keyword_signals": ["PF", "리파이낸싱", "대출", "브릿지", "선순위", "후순위", "셀다운", "LOC", "약정"],
            "strong_signals": ["PF", "리파이낸싱", "refinancing", "대출", "담보대출", "브릿지", "bridge", "선순위", "후순위", "셀다운", "sell-down", "LOC", "약정", "tranche", "트랜치", "LTV", "upfinancing", "재출자"],
            "context_signals": ["대주", "대주단", "우선주", "에쿼티", "equity", "금융주관사", "차환", "만기연장", "중순위", "출자"],
            "weak_signals": ["펀딩", "조달", "심의"],
            "exclude_signals": ["채용", "인사", "조직", "부서"],
            "min_score": 3,
        },
        "인허가/행정": {
            "keyword_signals": ["인허가", "건축허가", "변경인허가", "경관심의", "건축심의", "사전협상", "공공기여", "민원", "전력계통영향평가", "설계변경"],
            "strong_signals": ["인허가", "건축허가", "변경인허가", "경관심의", "건축심의", "사전협상", "공공기여", "민원", "전력계통영향평가", "설계변경", "허가접수", "착공신고", "교통영향평가", "수전", "전력인입"],
            "context_signals": ["서울시", "구청", "지자체", "캠코", "한전", "위원회", "건축", "설계", "전력", "접수", "신청", "승인", "심의"],
            "weak_signals": ["협의", "일정", "검토"],
            "exclude_signals": ["투자자", "LP", "대주", "리파이낸싱", "매각", "임차", "운영사", "펀딩", "IR", "RFP", "본심의", "IC", "투심", "리스크", "미팅", "수익자"],
            "authority_signals": ["서울시", "구청", "지자체", "행정기관", "한전", "위원회", "캠코", "용산구청"],
            "official_process_signals": ["인허가", "건축허가", "변경인허가", "경관심의", "건축심의", "사전협상", "공공기여", "전력계통영향평가", "허가접수", "착공신고", "교통영향평가", "수전", "전력인입"],
            "min_score": 4,
        },
        "운용/관리": {
            "keyword_signals": ["운영", "임대차", "재계약", "공실", "임차인", "수익자 보고", "운용보고", "보험청구"],
            "strong_signals": ["운영", "자산관리", "임대차", "재계약", "공실", "임차인", "수익자 보고", "운용보고", "보험청구", "CapEx", "마스터리스", "입주"],
            "context_signals": ["임차", "리테일", "운영사", "관리", "정산", "보고"],
            "weak_signals": ["현장", "점검"],
            "exclude_signals": ["입찰", "매각", "리파이낸싱", "PF", "채용"],
            "min_score": 3,
        },
        "리스크·법무": {
            "keyword_signals": ["소송", "분쟁", "법무", "EOD", "경매", "담보권", "법원", "이의제기"],
            "strong_signals": ["소송", "분쟁", "법무", "EOD", "경매", "담보권", "가압류", "가처분", "법원", "이의제기", "디폴트", "채무불이행"],
            "context_signals": ["법무법인", "판결", "소장", "청구", "리스크", "유예"],
            "weak_signals": ["대응"],
            "exclude_signals": ["투자자 미팅", "채용"],
            "min_score": 3,
        },
        "투자자 대응": {
            "keyword_signals": ["IR", "RFP", "PT", "사이트투어", "탭핑", "투자자 마케팅", "LP"],
            "strong_signals": ["IR", "RFP", "PT", "사이트투어", "탭핑", "태핑", "tapping", "투자자 마케팅", "투자자", "LP", "GP Session", "IM자료", "roadshow", "LOC"],
            "context_signals": ["GIC", "CPPIB", "NPS", "국민연금", "교직원공제회", "우정사업본부", "산림조합", "수익자", "잠재투자자"],
            "weak_signals": ["미팅", "설명회", "보고자료", "실사"],
            "exclude_signals": ["서울시", "구청", "인허가"],
            "min_score": 3,
        },
        "신규검토": {
            "keyword_signals": ["신규검토", "예비검토", "초기검토", "타당성", "underwriting", "valuation", "파이프라인"],
            "strong_signals": ["신규검토", "예비검토", "초기검토", "타당성", "underwriting", "valuation", "파이프라인", "소싱", "잠재 딜", "개발 가능성"],
            "context_signals": ["검토", "실사", "입찰 참여", "의향서 제출", "LOI", "후속 검토", "잠재"],
            "weak_signals": ["검토", "실사"],
            "exclude_signals": ["재계약", "운영", "보험청구", "수익자 보고"],
            "min_score": 3,
        },
    },
    "issue_fallbacks": {
        "프로젝트": "딜 진행",
        "신규검토": "신규검토",
        "운용/관리": "운용/관리",
        "펀드·투자자": "투자자 대응",
        "리스크·법무": "리스크·법무",
        "내부·기타": None,
    },
    "stakeholders": {
        "기관투자자(LP)": {
            "entities": ["GIC", "CPPIB", "NPS", "국민연금", "교직원공제회", "군인공제회", "지방행정공제회", "우정사업본부", "산림조합중앙회"],
            "generic_terms": ["투자자", "LP", "잠재투자자", "수익자", "출자자"],
        },
        "금융기관(대주)": {
            "entities": ["메리츠", "신한", "신한캐피탈", "하나", "하나캐피탈", "KB", "국민은행", "미래에셋", "현대캐피탈", "현대커머셜", "우리은행", "우리금융캐피탈", "교보생명", "DB손해보험", "한국저축은행"],
            "generic_terms": ["대주", "대주단", "금융기관", "은행", "캐피탈"],
        },
        "임차인": {
            "entities": ["LG전자", "LG CNS", "CJ", "라인플러스", "홈플러스", "아디다스", "세미파이브", "LX판토스", "Broadcom", "Cadence", "Infineon", "SKT", "카카오뱅크"],
            "generic_terms": ["임차인", "운영사", "operator", "tenant"],
        },
        "매수/매도인": {
            "entities": [],
            "generic_terms": ["매수인", "매도인", "잠재 SI", "잠재 매수인", "시행사", "선매수자", "매수의향"],
        },
        "주간사/자문": {
            "entities": ["JLL", "CBRE", "세빌스", "Rsquare", "쿠시먼", "법무법인 바른", "PWC"],
            "generic_terms": ["법무법인", "회계법인", "컨설팅", "주간사", "자문사"],
        },
        "공공/행정기관": {
            "entities": ["서울시", "캠코", "한전"],
            "generic_terms": ["지자체", "지방자치단체", "행정기관", "구청", "위원회"],
        },
        "해외 파트너": {
            "entities": ["Boston Properties", "Nuveen", "Dash Living", "Washington D.C.", "Woodies", "QIC"],
            "generic_terms": ["해외 파트너", "해외 투자자"],
        },
    },
    "stopwords": [
        "관련", "진행", "검토", "협의", "대응", "보고", "준비", "회의", "후속", "팔로업", "업무", "프로젝트",
        "펀드", "투자", "현황", "자료", "정리", "추진", "계획", "내부", "외부", "주간", "이번", "기준",
        "필요", "완료", "예정", "진행중", "예정임", "예정으로", "관련해", "위한", "현재", "금주",
        "follow", "followup", "meeting", "project", "review",
    ],
    "dynamic_keyword_blocklist": [
        "검토", "논의", "진행", "확인", "보고", "자료", "공유", "필요", "대응", "회의",
        "미팅", "업데이트", "정리", "협의", "추진", "관련", "요청", "전달", "준비", "예정",
        "진행중", "협의중", "검토중", "논의중", "준비중", "추진중", "진행하고", "협의하고", "검토하고",
    ],
    "dynamic_keyword_allowlist": ["PF", "IR", "LOC", "MOU", "SPA", "EOD", "RFP"],
    "generic_keyword_blocklist": [
        "협의", "논의", "일정", "예정", "대응", "진행", "검토", "실사", "보고", "준비", "회의", "대주",
        "투자자", "수익자", "운영사", "임차인", "매수인", "매도인", "기관", "파트너", "관련자", "현재",
        "금주", "향후", "이번주", "작업", "절차", "위한", "관련", "관리", "사업", "개발", "개발사업", "신규", "심의",
        "진행중", "협의중", "검토중", "논의중", "준비중", "추진중", "진행하고", "협의하고", "검토하고",
    ],
    "display_keyword_blocklist": [
        "오피스", "주거", "운영", "체결", "선정", "마케팅", "지분", "사업장", "프로젝트", "타임워크",
        "가산동", "양재", "용산", "부산", "미국", "일본", "서울", "현재", "관련", "사항",
        "진행중", "협의중", "검토중", "논의중", "준비중", "추진중", "진행하고", "협의하고", "검토하고",
    ],
}


def load_rules() -> dict[str, Any]:
    rules = json.loads(json.dumps(DEFAULT_RULES))
    if not os.path.exists(RULES_PATH):
        return rules

    with open(RULES_PATH, "r", encoding="utf-8") as file:
        user_rules = json.load(file)

    for name, values in user_rules.get("issue_categories", {}).items():
        current = normalize_issue_rule(rules.setdefault("issue_categories", {}).get(name, {}))
        incoming = normalize_issue_rule(values)
        rules["issue_categories"][name] = merge_issue_rules(current, incoming)

    for name, values in user_rules.get("stakeholders", {}).items():
        current = normalize_stakeholder_rule(rules.setdefault("stakeholders", {}).get(name, {}))
        incoming = normalize_stakeholder_rule(values)
        rules["stakeholders"][name] = merge_stakeholder_rules(current, incoming)

    for name, value in user_rules.get("issue_fallbacks", {}).items():
        rules.setdefault("issue_fallbacks", {})[name] = value

    for key in ["stopwords", "dynamic_keyword_blocklist", "dynamic_keyword_allowlist", "generic_keyword_blocklist", "display_keyword_blocklist"]:
        if user_rules.get(key):
            merged = set(rules.get(key, []))
            merged.update(user_rules[key])
            rules[key] = sorted(merged)

    rules["issue_categories"] = {
        name: normalize_issue_rule(value)
        for name, value in rules.get("issue_categories", {}).items()
    }
    rules["stakeholders"] = {
        name: normalize_stakeholder_rule(value)
        for name, value in rules.get("stakeholders", {}).items()
    }
    return rules


def unique_preserve_order(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if value in (None, ""):
            continue
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def normalize_issue_rule(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        return {
            "keyword_signals": unique_preserve_order(value),
            "strong_signals": unique_preserve_order(value),
            "context_signals": [],
            "weak_signals": [],
            "exclude_signals": [],
            "authority_signals": [],
            "official_process_signals": [],
            "min_score": 1,
        }

    rule = value if isinstance(value, dict) else {}
    return {
        "keyword_signals": unique_preserve_order(list(rule.get("keyword_signals", []))),
        "strong_signals": unique_preserve_order(list(rule.get("strong_signals", []))),
        "context_signals": unique_preserve_order(list(rule.get("context_signals", []))),
        "weak_signals": unique_preserve_order(list(rule.get("weak_signals", []))),
        "exclude_signals": unique_preserve_order(list(rule.get("exclude_signals", []))),
        "authority_signals": unique_preserve_order(list(rule.get("authority_signals", []))),
        "official_process_signals": unique_preserve_order(list(rule.get("official_process_signals", []))),
        "min_score": int(rule.get("min_score", 1) or 1),
    }


def merge_issue_rules(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = {}
    for key in ["keyword_signals", "strong_signals", "context_signals", "weak_signals", "exclude_signals", "authority_signals", "official_process_signals"]:
        merged[key] = unique_preserve_order(list(base.get(key, [])) + list(incoming.get(key, [])))
    merged["min_score"] = int(incoming.get("min_score") or base.get("min_score") or 1)
    return merged


def normalize_stakeholder_rule(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        return {"entities": unique_preserve_order(value), "generic_terms": []}

    rule = value if isinstance(value, dict) else {}
    return {
        "entities": unique_preserve_order(list(rule.get("entities", []))),
        "generic_terms": unique_preserve_order(list(rule.get("generic_terms", []))),
    }


def merge_stakeholder_rules(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    return {
        "entities": unique_preserve_order(list(base.get("entities", [])) + list(incoming.get("entities", []))),
        "generic_terms": unique_preserve_order(list(base.get("generic_terms", [])) + list(incoming.get("generic_terms", []))),
    }


def load_data(name: str) -> list[dict[str, Any]]:
    path = os.path.join(DATA_DIR, f"{name}.json")
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)


def load_cluster_rules() -> list[dict[str, Any]]:
    if not os.path.exists(CLUSTER_RULES_PATH):
        return []
    with open(CLUSTER_RULES_PATH, "r", encoding="utf-8") as file:
        payload = json.load(file)
    return payload.get("clusters", [])


def load_sync_meta() -> dict[str, Any] | None:
    path = os.path.join(DATA_DIR, "_sync_meta.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)


def normalize_week_key(value: str | None) -> str | None:
    if not value:
        return None
    if "~" in value:
        return value.split("~")[-1].strip()
    iso_week = re.match(r"(\d{4})-W(\d{2})", value)
    if iso_week:
        year, week_num = int(iso_week.group(1)), int(iso_week.group(2))
        jan1 = datetime(year, 1, 1)
        approx_date = jan1 + timedelta(weeks=week_num - 1)
        approx_date += timedelta(days=(6 - approx_date.weekday()))
        return approx_date.strftime("%Y-%m-%d")
    if re.match(r"\d{4}-\d{2}-\d{2}", value):
        return value[:10]
    return value


def parse_date(value: str | None):
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def month_label(anchor_date) -> str:
    return f"{anchor_date.year}년 {anchor_date.month}월"


def previous_month_anchor(anchor_date):
    year = anchor_date.year
    month = anchor_date.month - 1
    if month == 0:
        year -= 1
        month = 12
    return year, month


def get_first_present(entry: dict[str, Any], field_names: list[str]) -> Any:
    for field_name in field_names:
        value = entry.get(field_name)
        if value not in (None, "", []):
            return value
    return None


def stringify_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(stringify_value(item) for item in value if stringify_value(item))
    return str(value).strip()


def normalize_manual_token(raw_token: str) -> str:
    token = raw_token.strip().lstrip("#").strip()
    token = re.sub(r"^[^\w가-힣]+|[^\w가-힣&.+/-]+$", "", token)
    return token


def is_low_signal_token(token: str) -> bool:
    lowered = (token or "").strip().lower()
    if not lowered:
        return True
    return any(pattern.fullmatch(lowered) for pattern in LOW_SIGNAL_TOKEN_PATTERNS)


def normalize_cluster_key(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]+", "", (value or "").lower())


def extract_manual_tokens(entry: dict[str, Any]) -> list[str]:
    raw_value = get_first_present(entry, TOKEN_FIELD_ALIASES)
    if raw_value in (None, "", []):
        return []

    raw_text = stringify_value(raw_value)
    candidates = re.split(r"[\n,;/|]", raw_text)
    candidates.extend(re.findall(r"#([A-Za-z0-9가-힣&.+/-]{2,})", raw_text))

    seen = set()
    tokens = []
    for candidate in candidates:
        token = normalize_manual_token(candidate)
        if len(token) < 2:
            continue
        if is_low_signal_token(token):
            continue
        lowered = token.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        tokens.append(token)
    return tokens


def extract_keyword_clusters(
    entry: dict[str, Any],
    keywords: list[dict[str, Any]],
    cluster_rules: list[dict[str, Any]],
) -> list[str]:
    if not cluster_rules:
        return []

    candidates = set()
    candidates.update(extract_manual_tokens(entry))
    candidates.update(entry.get("project_names", []) or [])
    candidates.update(keyword["keyword"] for keyword in keywords)
    normalized_candidates = [normalize_cluster_key(candidate) for candidate in candidates if candidate]

    matched = []
    seen = set()
    for cluster in cluster_rules:
        name = cluster.get("name")
        tokens = cluster.get("tokens", [])
        if not name or not tokens:
            continue
        normalized_tokens = [normalize_cluster_key(token) for token in tokens if token]
        if any(
            normalized_token and (
                normalized_token in candidate or candidate in normalized_token
            )
            for normalized_token in normalized_tokens
            for candidate in normalized_candidates
            if candidate
        ):
            lowered_name = name.lower()
            if lowered_name not in seen:
                seen.add(lowered_name)
                matched.append(name)
    return matched


def get_structured_summary(entry: dict[str, Any]) -> str:
    value = get_first_present(entry, SUMMARY_FIELD_ALIASES)
    return stringify_value(value)


def build_entry_text(entry: dict[str, Any]) -> str:
    structured_summary = get_structured_summary(entry)
    manual_tokens = extract_manual_tokens(entry)
    return " ".join(
        part.strip()
        for part in [
            structured_summary,
            entry.get("비고", "") or "",
            entry.get("업무 로그명", "") or "",
            " ".join(entry.get("project_names", []) or []),
            " ".join(f"#{token}" for token in manual_tokens),
        ]
        if part
    )


def normalize_free_text(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]+", "", (value or "").lower())


def tokenize_keywords(text: str, stopwords: set[str]) -> list[str]:
    tokens = []
    for token in re.findall(r"[A-Za-z][A-Za-z0-9&.+-]{1,}|[가-힣]{2,}", text):
        cleaned = token.strip().strip(".,()[]{}")
        lowered = cleaned.lower()
        if len(cleaned) < 2:
            continue
        if lowered in stopwords:
            continue
        if cleaned in stopwords:
            continue
        if re.fullmatch(r"\d+", cleaned):
            continue
        tokens.append(cleaned)
    return tokens


def build_entry_dedupe_signature(entry: dict[str, Any], rules: dict[str, Any]) -> tuple[str, ...]:
    source_url = stringify_value(entry.get("원문 URL") or entry.get("T5T 작성자 페이지"))
    writer = stringify_value(entry.get("작성자"))
    work_date = stringify_value(entry.get("업무일자"))
    task_type = stringify_value(entry.get("업무유형"))
    project_names = entry.get("project_names", []) or []

    blocked = {word.lower() for word in rules.get("stopwords", [])}
    blocked.update(word.lower() for word in rules.get("generic_keyword_blocklist", []))
    blocked.update(word.lower() for word in rules.get("display_keyword_blocklist", []))

    token_source = " ".join(
        part
        for part in [
            get_structured_summary(entry),
            stringify_value(entry.get("원문 요약")),
            stringify_value(entry.get("비고")),
            " ".join(project_names),
            " ".join(extract_manual_tokens(entry)),
        ]
        if part
    )
    tokens = []
    seen = set()
    for token in tokenize_keywords(token_source, blocked):
        lowered = token.lower()
        if lowered in blocked:
            continue
        if len(token) <= 2 and token.upper() not in {"PF", "IR", "LOI", "SPA", "MOU"}:
            continue
        if lowered in seen:
            continue
        seen.add(lowered)
        tokens.append(lowered)

    canonical_tokens = tuple(sorted(tokens[:10]))
    if not canonical_tokens:
        fallback_text = normalize_free_text(get_structured_summary(entry) or stringify_value(entry.get("원문 요약")))
        canonical_tokens = (fallback_text[:48],)

    return (
        normalize_free_text(source_url),
        normalize_free_text(writer),
        normalize_free_text(work_date),
        normalize_free_text(task_type),
        normalize_free_text(" ".join(project_names[:2])),
        *canonical_tokens,
    )


def build_entry_dedupe_context(entry: dict[str, Any], rules: dict[str, Any]) -> dict[str, Any]:
    source_url = normalize_free_text(stringify_value(entry.get("원문 URL") or entry.get("T5T 작성자 페이지")))
    writer = normalize_free_text(stringify_value(entry.get("작성자")))
    work_date = normalize_free_text(stringify_value(entry.get("업무일자")))
    task_type = normalize_free_text(stringify_value(entry.get("업무유형")))
    primary_project = normalize_free_text(" ".join((entry.get("project_names", []) or [])[:1]))

    blocked = {word.lower() for word in rules.get("stopwords", [])}
    blocked.update(word.lower() for word in rules.get("generic_keyword_blocklist", []))
    blocked.update(word.lower() for word in rules.get("display_keyword_blocklist", []))

    token_source = " ".join(
        part
        for part in [
            get_structured_summary(entry),
            stringify_value(entry.get("원문 요약")),
            stringify_value(entry.get("비고")),
            primary_project,
            " ".join(extract_manual_tokens(entry)),
        ]
        if part
    )
    token_set = set()
    for token in tokenize_keywords(token_source, blocked):
        lowered = token.lower()
        if lowered in blocked:
            continue
        if len(token) <= 2 and token.upper() not in {"PF", "IR", "LOI", "SPA", "MOU", "DC"}:
            continue
        token_set.add(lowered)

    return {
        "coarse_key": (source_url, writer, work_date, task_type, primary_project),
        "token_set": token_set,
        "summary_norm": normalize_free_text(get_structured_summary(entry) or stringify_value(entry.get("원문 요약"))),
    }


def are_entries_semantically_duplicate(left: dict[str, Any], right: dict[str, Any], rules: dict[str, Any]) -> bool:
    left_ctx = build_entry_dedupe_context(left, rules)
    right_ctx = build_entry_dedupe_context(right, rules)
    if left_ctx["coarse_key"] != right_ctx["coarse_key"]:
        return False

    left_summary = left_ctx["summary_norm"]
    right_summary = right_ctx["summary_norm"]
    if left_summary and right_summary and (left_summary in right_summary or right_summary in left_summary):
        return True

    left_tokens = left_ctx["token_set"]
    right_tokens = right_ctx["token_set"]
    if not left_tokens or not right_tokens:
        return False

    overlap = len(left_tokens & right_tokens)
    overlap_ratio = overlap / max(1, min(len(left_tokens), len(right_tokens)))
    return overlap_ratio >= 0.6


def choose_preferred_entry(current: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    current_score = (
        len(get_structured_summary(current) or "")
        + len(stringify_value(current.get("원문 요약")))
        + (20 if current.get("Project & Mission") else 0)
        + (20 if current.get("신규 프로젝트") else 0)
    )
    candidate_score = (
        len(get_structured_summary(candidate) or "")
        + len(stringify_value(candidate.get("원문 요약")))
        + (20 if candidate.get("Project & Mission") else 0)
        + (20 if candidate.get("신규 프로젝트") else 0)
    )
    if candidate_score > current_score:
        return candidate
    return current


def dedupe_period_entries(entries: list[dict[str, Any]], rules: dict[str, Any]) -> list[dict[str, Any]]:
    deduped: dict[tuple[str, ...], dict[str, Any]] = {}
    for entry in entries:
        signature = build_entry_dedupe_signature(entry, rules)
        existing = deduped.get(signature)
        if existing is None:
            matched_signature = None
            for existing_signature, existing_entry in deduped.items():
                if are_entries_semantically_duplicate(existing_entry, entry, rules):
                    matched_signature = existing_signature
                    break
            if matched_signature is None:
                deduped[signature] = entry
                continue
            deduped[matched_signature] = choose_preferred_entry(deduped[matched_signature], entry)
            continue
        deduped[signature] = choose_preferred_entry(existing, entry)
    return list(deduped.values())


def build_explicit_keyword_lookup(rules: dict[str, Any]) -> dict[str, Any]:
    lookup = {}
    for category, issue_rule in rules["issue_categories"].items():
        keywords = issue_rule.get("keyword_signals") or issue_rule.get("strong_signals", [])
        for keyword in keywords:
            lookup[keyword.lower()] = {
                "keyword": keyword,
                "category": category,
            }
    return lookup


def get_explicit_keywords(explicit_lookup: dict[str, Any]) -> list[dict[str, str]]:
    return sorted(explicit_lookup.values(), key=lambda item: (-len(item["keyword"]), item["keyword"]))


def get_text_and_manual_tokens(entry: dict[str, Any]) -> tuple[str, set[str]]:
    text = build_entry_text(entry).lower()
    manual_tokens = {token.lower() for token in extract_manual_tokens(entry)}
    return text, manual_tokens


def find_signal_matches(text: str, manual_tokens: set[str], signals: list[str]) -> list[str]:
    matches = []
    seen = set()
    for signal in signals:
        lowered_signal = signal.lower()
        if not lowered_signal:
            continue
        if lowered_signal in manual_tokens or lowered_signal in text:
            if lowered_signal not in seen:
                seen.add(lowered_signal)
                matches.append(signal)
    return matches


def score_issue_rule(text: str, manual_tokens: set[str], issue_rule: dict[str, Any]) -> dict[str, Any]:
    strong_matches = find_signal_matches(text, manual_tokens, issue_rule.get("strong_signals", []))
    context_matches = find_signal_matches(text, manual_tokens, issue_rule.get("context_signals", []))
    weak_matches = find_signal_matches(text, manual_tokens, issue_rule.get("weak_signals", []))
    exclude_matches = find_signal_matches(text, manual_tokens, issue_rule.get("exclude_signals", []))

    score = len(strong_matches) * 4
    score += len(context_matches) * 2
    score += len(weak_matches)
    score -= len(exclude_matches) * 4
    if strong_matches and context_matches:
        score += 1

    return {
        "score": score,
        "strong_matches": strong_matches,
        "context_matches": context_matches,
        "weak_matches": weak_matches,
        "exclude_matches": exclude_matches,
    }


def assign_categories(entry: dict[str, Any], rules: dict[str, Any], explicit_lookup: dict[str, Any]) -> list[str]:
    full_text, manual_tokens = get_text_and_manual_tokens(entry)
    scored_categories = []
    for category in ISSUE_CATEGORY_ORDER:
        issue_rule = rules["issue_categories"].get(category, {})
        rule_score = score_issue_rule(full_text, manual_tokens, issue_rule)
        min_score = int(issue_rule.get("min_score", 1) or 1)
        if rule_score["score"] < min_score:
            continue
        if not (rule_score["strong_matches"] or rule_score["context_matches"]):
            continue
        if issue_rule.get("authority_signals") or issue_rule.get("official_process_signals"):
            authority_matches = find_signal_matches(full_text, manual_tokens, issue_rule.get("authority_signals", []))
            official_process_matches = find_signal_matches(full_text, manual_tokens, issue_rule.get("official_process_signals", []))
            if not (authority_matches or official_process_matches):
                continue
        scored_categories.append((category, rule_score["score"]))

    scored_categories.sort(key=lambda item: (-item[1], ISSUE_CATEGORY_ORDER.index(item[0])))
    if scored_categories:
        top_score = scored_categories[0][1]
        threshold = max(1, top_score - 2)
        categories = [category for category, score in scored_categories if score >= threshold]
    else:
        categories = []

    if not categories:
        fallback = rules["issue_fallbacks"].get(entry.get("업무유형"))
        if fallback:
            categories.append(fallback)
    return categories


def is_valid_dynamic_keyword(token: str, rules: dict[str, Any], stopwords: set[str]) -> bool:
    lowered = token.lower()
    blocklist = {word.lower() for word in rules.get("dynamic_keyword_blocklist", [])}
    allowlist = {word.lower() for word in rules.get("dynamic_keyword_allowlist", [])}
    generic_blocklist = {word.lower() for word in rules.get("generic_keyword_blocklist", [])}
    generic_keywords = {
        "검토", "논의", "진행", "확인", "보고", "자료", "공유", "필요", "대응", "회의",
        "미팅", "업데이트", "정리", "협의", "추진", "관련", "요청", "전달", "준비", "예정",
        "보고서", "검토안", "방향", "내용", "현황", "이슈", "사항", "일정", "현재", "금주",
        "대주", "투자자", "수익자", "운영사", "임차인", "기관", "관련자",
        "진행중", "협의중", "검토중", "논의중", "준비중", "추진중", "진행하고", "협의하고", "검토하고",
    }

    if lowered in allowlist:
        return True
    if is_low_signal_token(token):
        return False
    if lowered in stopwords or lowered in blocklist or lowered in generic_blocklist:
        return False
    if token in TASK_TYPE_ORDER or token in ISSUE_CATEGORY_ORDER or token in STAKEHOLDER_TYPE_ORDER:
        return False
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f-]{20,}", lowered):
        return False
    if re.search(r"\d", token) and token.count("-") >= 2:
        return False
    if len(token) >= 18 and re.fullmatch(r"[A-Za-z0-9-]+", token):
        return False
    if token in generic_keywords:
        return False
    if re.fullmatch(r"[A-Za-z]{2,3}", token) and token.upper() not in {"PF", "IR", "LOC", "MOU"}:
        return False
    return True


def infer_dynamic_keywords(entries: list[dict[str, Any]], rules: dict[str, Any], explicit_lookup: dict[str, Any]) -> dict[str, dict[str, Any]]:
    stopwords = {word.lower() for word in rules["stopwords"]}
    token_counts = defaultdict(int)
    category_counts = defaultdict(lambda: defaultdict(int))

    for entry in entries:
        categories = assign_categories(entry, rules, explicit_lookup)
        if not categories:
            continue
        tokens = tokenize_keywords(build_entry_text(entry), stopwords)
        for token in set(tokens):
            lowered = token.lower()
            if lowered in explicit_lookup:
                continue
            if not is_valid_dynamic_keyword(token, rules, stopwords):
                continue
            token_counts[token] += 1
            for category in categories:
                category_counts[token][category] += 1

    inferred = {}
    for token, total in token_counts.items():
        if total < 3:
            continue
        category_map = category_counts[token]
        dominant_category, dominant_count = max(category_map.items(), key=lambda item: item[1])
        dominance_ratio = dominant_count / total
        if dominance_ratio < 0.55:
            continue
        inferred[token.lower()] = {
            "keyword": token,
            "category": dominant_category,
            "count": total,
            "source": "inferred",
            "confidence": round(dominance_ratio, 2),
        }
    return inferred


def extract_issue_keywords(
    entry: dict[str, Any],
    categories: list[str],
    rules: dict[str, Any],
    explicit_lookup: dict[str, Any],
    dynamic_keywords: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    text = build_entry_text(entry)
    lowered = text.lower()
    stopwords = {word.lower() for word in rules["stopwords"]}
    found = []
    seen = set()
    explicit_keywords = get_explicit_keywords(explicit_lookup)

    for explicit in explicit_keywords:
        lowered_keyword = explicit["keyword"].lower()
        if lowered_keyword in lowered and lowered_keyword not in seen:
            seen.add(lowered_keyword)
            found.append({"keyword": explicit["keyword"], "category": explicit["category"], "source": "rule"})

    for token in extract_manual_tokens(entry):
        lowered_token = token.lower()
        if lowered_token in seen:
            continue
        if lowered_token in explicit_lookup:
            seen.add(lowered_token)
            explicit = explicit_lookup[lowered_token]
            found.append({"keyword": explicit["keyword"], "category": explicit["category"], "source": "manual"})
            continue
        inferred = dynamic_keywords.get(lowered_token)
        if inferred:
            seen.add(lowered_token)
            found.append(
                {
                    "keyword": inferred["keyword"],
                    "category": inferred["category"],
                    "source": "manual",
                    "confidence": inferred.get("confidence"),
                }
            )
            continue
        if categories and is_valid_dynamic_keyword(token, rules, stopwords):
            seen.add(lowered_token)
            found.append({"keyword": token, "category": categories[0], "source": "manual"})

    for token in tokenize_keywords(text, stopwords):
        lowered_token = token.lower()
        inferred = dynamic_keywords.get(lowered_token)
        if inferred and lowered_token not in seen:
            seen.add(lowered_token)
            found.append(
                {
                    "keyword": inferred["keyword"],
                    "category": inferred["category"],
                    "source": "inferred",
                    "confidence": inferred.get("confidence"),
                }
            )

    if not found and categories:
        snippet = re.split(r"[,.()]", entry.get("원문 요약", "") or "")[0].strip()
        if snippet:
            found.append({"keyword": snippet[:24], "category": categories[0], "source": "fallback"})

    return found


def extract_stakeholders(entry: dict[str, Any], rules: dict[str, Any]) -> list[dict[str, str]]:
    text = build_entry_text(entry).lower()
    found = []
    seen_names = set()
    for stakeholder_type in STAKEHOLDER_TYPE_ORDER:
        stakeholder_rule = rules["stakeholders"].get(stakeholder_type, {})
        matched_specific = False
        for keyword in stakeholder_rule.get("entities", []):
            lowered = keyword.lower()
            if lowered in text and lowered not in seen_names:
                seen_names.add(lowered)
                matched_specific = True
                found.append({"name": keyword, "type": stakeholder_type, "generic": False})
        if matched_specific:
            continue
        for generic_term in stakeholder_rule.get("generic_terms", []):
            lowered_generic = generic_term.lower()
            if lowered_generic in text:
                found.append({"name": stakeholder_type, "type": stakeholder_type, "generic": True})
                break
    return found


def is_displayable_keyword(keyword: str, meta: dict[str, Any], rules: dict[str, Any]) -> bool:
    lowered = (keyword or "").strip().lower()
    if not lowered:
        return False

    display_blocklist = {word.lower() for word in rules.get("display_keyword_blocklist", [])}
    generic_blocklist = {word.lower() for word in rules.get("generic_keyword_blocklist", [])}
    stopwords = {word.lower() for word in rules.get("stopwords", [])}
    allowlist = {word.lower() for word in rules.get("dynamic_keyword_allowlist", [])}

    if lowered in allowlist:
        return True
    if lowered in display_blocklist or lowered in generic_blocklist or lowered in stopwords:
        return False
    if len(keyword) <= 2 and keyword.upper() not in {"PF", "IR"}:
        return False
    if re.fullmatch(r"[가-힣]{2}", keyword):
        return False
    if meta.get("source") == "manual" and meta.get("count", 0) < 3:
        return False
    return True


def make_detail_record(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry.get("_id"),
        "summary": entry.get("원문 요약", ""),
        "structured_summary": get_structured_summary(entry),
        "classification_tokens": extract_manual_tokens(entry),
        "remarks": entry.get("비고", ""),
        "writer": entry.get("작성자", "Unknown"),
        "line": entry.get("라인", "Unknown"),
        "task_type": entry.get("업무유형", "내부·기타"),
        "work_date": entry.get("업무일자"),
        "week": normalize_week_key(entry.get("주차종료일") or entry.get("주차키")),
        "week_label": entry.get("주차키") or normalize_week_key(entry.get("주차종료일") or entry.get("주차키")),
        "log_name": entry.get("업무 로그명", ""),
        "projects": entry.get("project_names", []) or ["미연결"],
        "primary_project": (entry.get("project_names", []) or ["미연결"])[0],
        "url": entry.get("원문 URL") or entry.get("T5T 작성자 페이지"),
    }


def sort_detail_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(records, key=lambda item: ((item.get("work_date") or ""), (item.get("summary") or "")), reverse=True)


def build_period_snapshot(
    entries: list[dict[str, Any]],
    label: str,
    rules: dict[str, Any],
    explicit_lookup: dict[str, str],
    dynamic_keywords: dict[str, dict[str, Any]],
    cluster_rules: list[dict[str, Any]],
    compare_entries: list[dict[str, Any]] | None = None,
    compare_label: str | None = None,
) -> dict[str, Any]:
    issue_counts = defaultdict(int)
    compare_issue_counts = defaultdict(int)
    keyword_counts = defaultdict(int)
    keyword_meta = {}
    stakeholder_type_counts = defaultdict(int)
    stakeholder_name_counts = defaultdict(int)
    stakeholder_name_types = {}
    cluster_counts = defaultdict(int)
    details = {
        "issues": defaultdict(list),
        "keywords": defaultdict(list),
        "keyword_clusters": defaultdict(list),
        "stakeholder_types": defaultdict(list),
        "stakeholders": defaultdict(list),
    }

    for entry in entries:
        detail = make_detail_record(entry)
        categories = assign_categories(entry, rules, explicit_lookup)
        detail["issue_categories"] = categories
        keywords = extract_issue_keywords(entry, categories, rules, explicit_lookup, dynamic_keywords)
        detail["keywords"] = [keyword["keyword"] for keyword in keywords]
        clusters = extract_keyword_clusters(entry, keywords, cluster_rules)
        detail["keyword_clusters"] = clusters

        for category in categories:
            issue_counts[category] += 1
            details["issues"][category].append(detail)

        for keyword in keywords:
            keyword_counts[keyword["keyword"]] += 1
            keyword_meta[keyword["keyword"]] = {
                "category": keyword["category"],
                "source": keyword["source"],
                "confidence": keyword.get("confidence"),
                "count": keyword_counts[keyword["keyword"]],
            }
            details["keywords"][keyword["keyword"]].append(detail)

        for cluster in clusters:
            cluster_counts[cluster] += 1
            details["keyword_clusters"][cluster].append(detail)

        stakeholders = extract_stakeholders(entry, rules)
        detail["stakeholders"] = stakeholders
        for stakeholder in stakeholders:
            stakeholder_type_counts[stakeholder["type"]] += 1
            details["stakeholder_types"][stakeholder["type"]].append(detail)
            if stakeholder.get("generic"):
                continue
            stakeholder_name_counts[stakeholder["name"]] += 1
            stakeholder_name_types[stakeholder["name"]] = stakeholder["type"]
            details["stakeholders"][stakeholder["name"]].append(detail)

    for entry in compare_entries or []:
        for category in assign_categories(entry, rules, explicit_lookup):
            compare_issue_counts[category] += 1

    issue_categories = [
        {
            "name": category,
            "count": issue_counts.get(category, 0),
            "delta": issue_counts.get(category, 0) - compare_issue_counts.get(category, 0),
        }
        for category in ISSUE_CATEGORY_ORDER
    ]

    top_keywords = [
        {
            "keyword": keyword,
            "count": count,
            "category": keyword_meta[keyword]["category"],
            "source": keyword_meta[keyword]["source"],
            "confidence": keyword_meta[keyword].get("confidence"),
        }
        for keyword, count in sorted(keyword_counts.items(), key=lambda item: (-item[1], item[0]))
        if is_displayable_keyword(keyword, keyword_meta[keyword], rules)
    ][:16]

    top_keyword_clusters = [
        {"cluster": cluster, "count": count}
        for cluster, count in sorted(cluster_counts.items(), key=lambda item: (-item[1], item[0]))[:16]
    ]

    stakeholder_types = [
        {"name": stakeholder_type, "count": stakeholder_type_counts.get(stakeholder_type, 0)}
        for stakeholder_type in STAKEHOLDER_TYPE_ORDER
        if stakeholder_type_counts.get(stakeholder_type, 0) > 0
    ]

    top_stakeholders = [
        {
            "name": name,
            "type": stakeholder_name_types.get(name, "기타"),
            "count": count,
        }
        for name, count in sorted(stakeholder_name_counts.items(), key=lambda item: (-item[1], item[0]))[:15]
    ]

    serialized_details = {}
    for detail_type, grouped in details.items():
        serialized_details[detail_type] = {
            key: sort_detail_records(records)
            for key, records in grouped.items()
        }

    return {
        "label": label,
        "compare_label": compare_label,
        "total_logs": len(entries),
        "issue_categories": issue_categories,
        "top_keywords": top_keywords,
        "top_keyword_clusters": top_keyword_clusters,
        "stakeholder_types": stakeholder_types,
        "top_stakeholders": top_stakeholders,
        "risk_signal": {
            "current": issue_counts.get("리스크·법무", 0) + issue_counts.get("리스크/법무", 0),
            "previous": compare_issue_counts.get("리스크·법무", 0) + compare_issue_counts.get("리스크/법무", 0),
            "delta": (issue_counts.get("리스크·법무", 0) + issue_counts.get("리스크/법무", 0))
            - (compare_issue_counts.get("리스크·법무", 0) + compare_issue_counts.get("리스크/법무", 0)),
        },
        "details": serialized_details,
    }


def build_project_lookup(project_mission: list[dict[str, Any]], project_master: list[dict[str, Any]], relation_map: dict[str, str]) -> dict[str, str]:
    lookup = {}
    for record_id, name in relation_map.items():
        if name and name != "Untitled":
            lookup[record_id] = name
    for record in project_mission:
        name = record.get("Project & Mission 이름")
        if name and name != "Unknown" and record["_id"] not in lookup:
            lookup[record["_id"]] = name
    for record in project_master:
        name = record.get("프로젝트명")
        if name and record["_id"] not in lookup:
            lookup[record["_id"]] = name
    return lookup


def build_intelligence_data(
    entries: list[dict[str, Any]],
    sorted_weeks: list[str],
    project_lookup: dict[str, str],
    rules: dict[str, Any],
    cluster_rules: list[dict[str, Any]],
) -> dict[str, Any]:
    working_rules = json.loads(json.dumps(rules))
    dynamic_stopwords = set(working_rules["stopwords"])
    dynamic_stopwords.update(entry.get("작성자", "") for entry in entries if entry.get("작성자"))
    dynamic_stopwords.update(entry.get("라인", "") for entry in entries if entry.get("라인"))
    for entry in entries:
        log_name = entry.get("업무 로그명", "") or ""
        for match in re.findall(r"\|\s*([가-힣]{2,4})\s*\|", log_name):
            dynamic_stopwords.add(match)
    for stakeholder_rule in working_rules["stakeholders"].values():
        dynamic_stopwords.update(stakeholder_rule.get("entities", []))
        dynamic_stopwords.update(stakeholder_rule.get("generic_terms", []))
    working_rules["stopwords"] = sorted({word for word in dynamic_stopwords if word})

    explicit_lookup = build_explicit_keyword_lookup(working_rules)

    enriched_entries = []
    for entry in entries:
        project_ids = (entry.get("Project & Mission") or []) + (entry.get("신규 프로젝트") or [])
        project_names = []
        for project_id in project_ids:
            project_name = project_lookup.get(project_id)
            if not project_name or project_name == "Untitled":
                continue
            project_names.append(project_name)
        entry = dict(entry)
        entry["project_names"] = project_names
        work_date = parse_date(entry.get("업무일자"))
        week_end = parse_date(normalize_week_key(entry.get("주차종료일") or entry.get("주차키")))
        if not week_end:
            week_end = work_date
        enriched_entries.append({"entry": entry, "work_date": work_date, "week_end": week_end})

    latest_date = max((item["work_date"] for item in enriched_entries if item["work_date"]), default=None)
    latest_week = parse_date(sorted_weeks[-1]) if sorted_weeks else None
    if not latest_date:
        return {"latest_anchor": None, "periods": {}, "dynamic_keywords": []}

    prev_month_year, prev_month_num = previous_month_anchor(latest_date)
    distinct_weeks = sorted({item["week_end"] for item in enriched_entries if item["week_end"]})
    previous_week = distinct_weeks[-2] if len(distinct_weeks) > 1 else None
    previous_weeks = set(distinct_weeks[-8:-4])

    all_entries = dedupe_period_entries([item["entry"] for item in enriched_entries], working_rules)
    dynamic_keywords = infer_dynamic_keywords(all_entries, working_rules, explicit_lookup)
    all_compare_entries = dedupe_period_entries(
        [item["entry"] for item in enriched_entries if item["week_end"] in previous_weeks],
        working_rules,
    )
    month_entries = dedupe_period_entries([
        item["entry"]
        for item in enriched_entries
        if item["work_date"] and item["work_date"].year == latest_date.year and item["work_date"].month == latest_date.month
    ], working_rules)
    month_compare_entries = dedupe_period_entries([
        item["entry"]
        for item in enriched_entries
        if item["work_date"] and item["work_date"].year == prev_month_year and item["work_date"].month == prev_month_num
    ], working_rules)
    week_entries = dedupe_period_entries(
        [item["entry"] for item in enriched_entries if item["week_end"] == latest_week],
        working_rules,
    )
    week_compare_entries = dedupe_period_entries(
        [item["entry"] for item in enriched_entries if item["week_end"] == previous_week],
        working_rules,
    )

    week_label = next(
        (
            item["entry"].get("주차키")
            for item in enriched_entries
            if item["week_end"] == latest_week and item["entry"].get("주차키")
        ),
        latest_week.isoformat() if latest_week else "이번주",
    )
    prev_week_label = next(
        (
            item["entry"].get("주차키")
            for item in enriched_entries
            if item["week_end"] == previous_week and item["entry"].get("주차키")
        ),
        previous_week.isoformat() if previous_week else None,
    )

    return {
        "latest_anchor": {
            "date": latest_date.isoformat(),
            "week": latest_week.isoformat() if latest_week else None,
            "month": f"{latest_date.year}-{latest_date.month:02d}",
        },
        "dynamic_keywords": [
            {**meta}
            for _, meta in sorted(dynamic_keywords.items(), key=lambda item: (-item[1]["count"], item[1]["keyword"]))[:30]
        ],
        "keyword_clusters": cluster_rules,
        "classification": {
            "mode": "hybrid",
            "rule_keywords": sum(len(rule.get("keyword_signals", [])) for rule in working_rules["issue_categories"].values()),
            "inferred_keywords": len(dynamic_keywords),
            "dynamic_blocklist": working_rules.get("dynamic_keyword_blocklist", []),
            "dynamic_allowlist": working_rules.get("dynamic_keyword_allowlist", []),
        },
        "periods": {
            "all": build_period_snapshot(all_entries, "전체 기간", working_rules, explicit_lookup, dynamic_keywords, cluster_rules, all_compare_entries, "직전 4주"),
            "month": build_period_snapshot(
                month_entries,
                month_label(latest_date),
                working_rules,
                explicit_lookup,
                dynamic_keywords,
                cluster_rules,
                month_compare_entries,
                f"{prev_month_year}년 {prev_month_num}월" if month_compare_entries else None,
            ),
            "week": build_period_snapshot(
                week_entries,
                week_label,
                working_rules,
                explicit_lookup,
                dynamic_keywords,
                cluster_rules,
                week_compare_entries,
                prev_week_label,
            ),
        },
    }


def compute_dashboard_data() -> dict[str, Any]:
    t5t_logs = load_data("t5t_log")
    project_mission = load_data("project_mission")
    project_master = load_data("project_master")
    staff_master = load_data("staff_master")
    summary_blocks = load_data("summary_blocks")

    relation_map = {}
    relation_map_path = os.path.join(DATA_DIR, "relation_map.json")
    if os.path.exists(relation_map_path):
        with open(relation_map_path, "r", encoding="utf-8") as file:
            relation_map = json.load(file)

    rules = load_rules()
    cluster_rules = load_cluster_rules()
    project_lookup = build_project_lookup(project_mission, project_master, relation_map)

    weeks_set = {
        normalize_week_key(entry.get("주차키", ""))
        for entry in t5t_logs
        if normalize_week_key(entry.get("주차키", ""))
    }
    sorted_weeks = sorted(weeks_set)
    latest_week = sorted_weeks[-1] if sorted_weeks else None
    latest_week_logs = [entry for entry in t5t_logs if normalize_week_key(entry.get("주차키", "")) == latest_week]

    total_logs = len(t5t_logs)
    matched_logs = sum(1 for entry in t5t_logs if entry.get("매칭 상태") in ["Project & Mission 매칭", "신규 프로젝트 매칭"])

    kpi = {
        "total_logs": total_logs,
        "latest_week": latest_week,
        "latest_week_count": len(latest_week_logs),
        "match_rate": round((matched_logs / total_logs) * 100, 1) if total_logs else 0,
        "new_review_rate": round((sum(1 for entry in t5t_logs if entry.get("업무유형") == "신규검토") / total_logs) * 100, 1)
        if total_logs
        else 0,
        "manual_check_needed": sum(1 for entry in t5t_logs if entry.get("수동 확인 필요", False)),
        "unmatched_count": sum(1 for entry in t5t_logs if entry.get("매칭 상태") == "미매칭"),
        "total_weeks": len(sorted_weeks),
        "unique_writers": len({entry.get("작성자") for entry in t5t_logs if entry.get("작성자")}),
    }

    task_type_by_week = defaultdict(lambda: defaultdict(int))
    line_week_counts = defaultdict(lambda: defaultdict(int))
    line_totals = defaultdict(int)
    project_timeline = defaultdict(lambda: defaultdict(list))
    writer_stats = defaultdict(lambda: {"count": 0, "projects": set(), "task_types": defaultdict(int), "lines": set()})
    match_distribution = defaultdict(int)

    for entry in t5t_logs:
        normalized_week = normalize_week_key(entry.get("주차키", ""))
        task_type = entry.get("업무유형", "내부·기타") or "내부·기타"
        line = entry.get("라인", "Unknown") or "Unknown"
        writer = entry.get("작성자", "Unknown") or "Unknown"

        if normalized_week:
            task_type_by_week[normalized_week][task_type] += 1
            line_week_counts[line][normalized_week] += 1
        line_totals[line] += 1
        match_distribution[entry.get("매칭 상태", "Unknown") or "Unknown"] += 1

        writer_stats[writer]["count"] += 1
        writer_stats[writer]["lines"].add(line)
        writer_stats[writer]["task_types"][task_type] += 1

        for project_id in entry.get("Project & Mission", []) or []:
            writer_stats[writer]["projects"].add(project_id)
            if not normalized_week:
                continue
            project_timeline[project_id][normalized_week].append(
                {
                    "writer": writer,
                    "task_type": task_type,
                    "summary": entry.get("원문 요약", ""),
                    "log_name": entry.get("업무 로그명", ""),
                    "line": line,
                }
            )

    trend = {
        "weeks": sorted_weeks,
        "task_types": TASK_TYPE_ORDER,
        "series": {
            task_type: [task_type_by_week[week].get(task_type, 0) for week in sorted_weeks]
            for task_type in TASK_TYPE_ORDER
        },
    }

    lines = sorted({entry.get("라인", "Unknown") or "Unknown" for entry in t5t_logs})
    heatmap = {"weeks": sorted_weeks, "lines": lines, "data": []}
    for row_index, line in enumerate(lines):
        for col_index, week in enumerate(sorted_weeks):
            heatmap["data"].append({"x": col_index, "y": row_index, "v": line_week_counts[line].get(week, 0)})

    line_summary = [{"line": line, "count": count} for line, count in sorted(line_totals.items(), key=lambda item: -item[1])]

    pulse = []
    for project_id, weeks_data in project_timeline.items():
        all_logs = []
        writer_counts = defaultdict(int)
        writers = set()
        lines_used = set()
        weekly_counts = {}

        for week, logs in weeks_data.items():
            weekly_counts[week] = len(logs)
            for log in logs:
                enriched_log = dict(log)
                enriched_log["week"] = week
                all_logs.append(enriched_log)
                writer_counts[log["writer"]] += 1
                writers.add(log["writer"])
                lines_used.add(log["line"])

        all_logs.sort(key=lambda item: item["week"], reverse=True)
        pulse.append(
            {
                "id": project_id,
                "name": project_lookup.get(project_id, "Unknown"),
                "total_mentions": sum(weekly_counts.values()),
                "unique_writers": len(writers),
                "writers": sorted(writers),
                "top_writers": [name for name, _ in sorted(writer_counts.items(), key=lambda item: -item[1])[:4]],
                "lines": sorted(lines_used),
                "weekly": weekly_counts,
                "last_activity": max(weeks_data.keys()) if weeks_data else None,
                "logs": all_logs,
            }
        )

    pulse.sort(key=lambda item: -item["total_mentions"])
    top_projects = [
        {
            "id": item["id"],
            "name": item["name"],
            "count": item["total_mentions"],
            "top_writers": item["top_writers"],
            "logs": item["logs"],
        }
        for item in pulse[:20]
    ]

    writer_summary = []
    for writer, stats in writer_stats.items():
        writer_summary.append(
            {
                "name": writer,
                "count": stats["count"],
                "project_count": len(stats["projects"]),
                "line": sorted(stats["lines"])[0] if stats["lines"] else "Unknown",
                "task_types": dict(stats["task_types"]),
            }
        )
    writer_summary.sort(key=lambda item: -item["count"])

    intelligence = build_intelligence_data(t5t_logs, sorted_weeks, project_lookup, rules, cluster_rules)

    return {
        "kpi": kpi,
        "trend": trend,
        "heatmap": heatmap,
        "line_summary": line_summary,
        "top_projects": top_projects,
        "pulse": pulse[:30],
        "writer_summary": writer_summary,
        "match_distribution": dict(match_distribution),
        "sorted_weeks": sorted_weeks,
        "intelligence": intelligence,
        "summary_blocks": summary_blocks,
        "sync_meta": load_sync_meta(),
        "rules_meta": {
            "rule_path": RULES_PATH,
            "cluster_rule_path": CLUSTER_RULES_PATH,
            "issue_categories": ISSUE_CATEGORY_ORDER,
            "stakeholder_types": STAKEHOLDER_TYPE_ORDER,
        },
    }


class DashboardHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/dashboard":
            self.send_json_response(compute_dashboard_data())
            return
        if parsed.path == "/api/sync-meta":
            self.send_json_response(load_sync_meta())
            return
        if parsed.path == "/api/sync":
            try:
                subprocess.run([sys.executable, "sync_notion.py"], check=True)
                self.send_json_response({"status": "success"})
            except Exception as error:  # pragma: no cover
                self.send_json_response({"status": "error", "message": str(error)})
            return
        if parsed.path in ["/", "/index.html"]:
            self.serve_file("index.html", "text/html")
            return
        if parsed.path.startswith("/data/"):
            self.serve_file(parsed.path.lstrip("/"), "application/json")
            return
        if parsed.path.endswith(".css"):
            self.serve_file(parsed.path.lstrip("/"), "text/css")
            return
        if parsed.path.endswith(".js"):
            self.serve_file(parsed.path.lstrip("/"), "application/javascript")
            return
        self.send_error(404)

    def send_json_response(self, data: dict[str, Any]):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, filename: str, content_type: str):
        path = os.path.join(STATIC_DIR, filename)
        if not os.path.exists(path):
            self.send_error(404)
            return
        with open(path, "rb") as file:
            content = file.read()
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format, *args):
        if args and "404" not in str(args[0]):
            return


def main():
    if len(sys.argv) > 1 and "build" in sys.argv[1]:
        print("Building static dashboard.json...")
        data = compute_dashboard_data()
        out_path = os.path.join(DATA_DIR, "dashboard.json")
        with open(out_path, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
        print(f"Build complete: {out_path}")
        return

    server = HTTPServer(("0.0.0.0", PORT), DashboardHandler)
    print(f"T5T Dashboard running at http://localhost:{PORT}")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()


if __name__ == "__main__":
    main()
