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

DEFAULT_RULES = {
    "issue_categories": {
        "딜 진행": ["매각", "매입", "입찰", "클로징", "SPA", "MOU", "우협", "계약", "매수", "매도", "선매수"],
        "금융 구조": ["리파이낸싱", "PF", "대출", "셀다운", "Sell-Down", "선순위", "후순위", "대주", "우선주", "에쿼티", "조달"],
        "인허가/행정": ["인허가", "심의", "사전협상", "공공기여", "설계변경", "변경인허가", "행정", "허가", "협의"],
        "운용/관리": ["임대차", "재계약", "운용보고", "수익자", "보고", "현장실사", "현장", "운영"],
        "리스크/법무": ["소송", "대응", "경매", "담보권", "법적", "EOD", "유예", "분쟁", "리스크", "법무"],
        "투자자 대응": ["IR", "PT", "사이트투어", "탭핑", "태핑", "투자자", "설명회", "미팅", "LOC"],
        "신규검토": ["실사", "valuation", "검토", "드롭", "타당성", "초기 검토", "예비 검토"],
    },
    "issue_fallbacks": {
        "프로젝트": "딜 진행",
        "신규검토": "신규검토",
        "운용/관리": "운용/관리",
        "펀드·투자자": "투자자 대응",
        "리스크·법무": "리스크·법무",
        "내부·기타": "운용/관리",
    },
    "stakeholders": {
        "기관투자자(LP)": ["GIC", "CPPIB", "NPS", "국민연금", "교직원공제회", "공제회", "우정사업본부", "산림조합", "연기금"],
        "금융기관(대주)": ["신한", "현대캐피탈", "메리츠", "다이와", "한국저축은행", "미래에셋", "DB손해보험", "하나", "KB", "하이투자"],
        "임차인": ["LG전자", "CJ", "라인플러스", "홈플러스", "아디다스", "세미파이브", "LX판토스", "Broadcom", "Cadence", "Infineon"],
        "매수/매도인": ["매수인", "매도인", "잠재 SI", "잠재 매수인", "시행사", "선매수자", "잠재 임차인"],
        "주간사/자문": ["JLL", "세빌스", "법무법인", "CBRE", "쿠시먼", "회계법인", "컨설팅", "Rsquare"],
        "공공/행정기관": ["서울시", "캠코", "관계 부처", "지자체", "한전", "지방자치단체", "주민단"],
        "해외 파트너": ["Boston Properties", "Nuveen", "Dash Living", "Washington D.C.", "Woodies"],
    },
    "stopwords": [
        "관련", "진행", "검토", "협의", "대응", "보고", "준비", "회의", "후속", "팔로업", "업무", "프로젝트",
        "펀드", "투자", "현황", "자료", "정리", "추진", "계획", "내부", "외부", "주간", "이번", "기준",
        "필요", "완료", "예정", "진행중",
        "follow", "followup", "meeting", "project", "review",
    ],
    "dynamic_keyword_blocklist": [
        "검토", "논의", "진행", "확인", "보고", "자료", "공유", "필요", "대응", "회의",
        "미팅", "업데이트", "정리", "협의", "추진", "관련", "요청", "전달", "준비", "예정",
    ],
    "dynamic_keyword_allowlist": [],
}


def load_rules() -> dict[str, Any]:
    rules = json.loads(json.dumps(DEFAULT_RULES))
    if not os.path.exists(RULES_PATH):
        return rules

    with open(RULES_PATH, "r", encoding="utf-8") as file:
        user_rules = json.load(file)

    for name, values in user_rules.get("issue_categories", {}).items():
        rules.setdefault("issue_categories", {})[name] = values

    for name, values in user_rules.get("stakeholders", {}).items():
        merged = set(rules.setdefault("stakeholders", {}).get(name, []))
        merged.update(values)
        rules["stakeholders"][name] = sorted(merged)

    for name, value in user_rules.get("issue_fallbacks", {}).items():
        rules.setdefault("issue_fallbacks", {})[name] = value

    for key in ["stopwords", "dynamic_keyword_blocklist", "dynamic_keyword_allowlist"]:
        if user_rules.get(key):
            merged = set(rules.get(key, []))
            merged.update(user_rules[key])
            rules[key] = sorted(merged)

    return rules


def load_data(name: str) -> list[dict[str, Any]]:
    path = os.path.join(DATA_DIR, f"{name}.json")
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)


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


def build_entry_text(entry: dict[str, Any]) -> str:
    return " ".join(
        part.strip()
        for part in [
            entry.get("원문 요약", "") or "",
            entry.get("비고", "") or "",
            entry.get("업무 로그명", "") or "",
            " ".join(entry.get("project_names", []) or []),
        ]
        if part
    )


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


def build_explicit_keyword_lookup(rules: dict[str, Any]) -> dict[str, Any]:
    lookup = {}
    for category, keywords in rules["issue_categories"].items():
        for keyword in keywords:
            lookup[keyword.lower()] = {
                "keyword": keyword,
                "category": category,
            }
    return lookup


def get_explicit_keywords(explicit_lookup: dict[str, Any]) -> list[dict[str, str]]:
    return sorted(explicit_lookup.values(), key=lambda item: (-len(item["keyword"]), item["keyword"]))


def assign_categories(entry: dict[str, Any], rules: dict[str, Any], explicit_lookup: dict[str, Any]) -> list[str]:
    text = build_entry_text(entry).lower()
    categories = []
    for category in ISSUE_CATEGORY_ORDER:
        for keyword in rules["issue_categories"].get(category, []):
            if keyword.lower() in text:
                categories.append(category)
                break
    if not categories:
        fallback = rules["issue_fallbacks"].get(entry.get("업무유형"))
        if fallback:
            categories.append(fallback)
    return categories


def is_valid_dynamic_keyword(token: str, rules: dict[str, Any], stopwords: set[str]) -> bool:
    lowered = token.lower()
    blocklist = {word.lower() for word in rules.get("dynamic_keyword_blocklist", [])}
    allowlist = {word.lower() for word in rules.get("dynamic_keyword_allowlist", [])}
    generic_keywords = {
        "검토", "논의", "진행", "확인", "보고", "자료", "공유", "필요", "대응", "회의",
        "미팅", "업데이트", "정리", "협의", "추진", "관련", "요청", "전달", "준비", "예정",
        "보고서", "검토안", "방향", "내용", "현황", "이슈", "사항",
    }

    if lowered in allowlist:
        return True
    if lowered in stopwords or lowered in blocklist:
        return False
    if token in TASK_TYPE_ORDER or token in ISSUE_CATEGORY_ORDER or token in STAKEHOLDER_TYPE_ORDER:
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
    found = []
    seen = set()
    explicit_keywords = get_explicit_keywords(explicit_lookup)

    for explicit in explicit_keywords:
        lowered_keyword = explicit["keyword"].lower()
        if lowered_keyword in lowered and lowered_keyword not in seen:
            seen.add(lowered_keyword)
            found.append({"keyword": explicit["keyword"], "category": explicit["category"], "source": "rule"})

    stopwords = {word.lower() for word in rules["stopwords"]}
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
    seen = set()
    for stakeholder_type in STAKEHOLDER_TYPE_ORDER:
        for keyword in rules["stakeholders"].get(stakeholder_type, []):
            lowered = keyword.lower()
            if lowered in text and lowered not in seen:
                seen.add(lowered)
                found.append({"name": keyword, "type": stakeholder_type})
    return found


def make_detail_record(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry.get("_id"),
        "summary": entry.get("원문 요약", ""),
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
    details = {
        "issues": defaultdict(list),
        "keywords": defaultdict(list),
        "stakeholder_types": defaultdict(list),
        "stakeholders": defaultdict(list),
    }

    for entry in entries:
        detail = make_detail_record(entry)
        categories = assign_categories(entry, rules, explicit_lookup)
        detail["issue_categories"] = categories
        keywords = extract_issue_keywords(entry, categories, rules, explicit_lookup, dynamic_keywords)
        detail["keywords"] = [keyword["keyword"] for keyword in keywords]

        for category in categories:
            issue_counts[category] += 1
            details["issues"][category].append(detail)

        for keyword in keywords:
            keyword_counts[keyword["keyword"]] += 1
            keyword_meta[keyword["keyword"]] = {
                "category": keyword["category"],
                "source": keyword["source"],
                "confidence": keyword.get("confidence"),
            }
            details["keywords"][keyword["keyword"]].append(detail)

        stakeholders = extract_stakeholders(entry, rules)
        detail["stakeholders"] = stakeholders
        for stakeholder in stakeholders:
            stakeholder_type_counts[stakeholder["type"]] += 1
            stakeholder_name_counts[stakeholder["name"]] += 1
            stakeholder_name_types[stakeholder["name"]] = stakeholder["type"]
            details["stakeholder_types"][stakeholder["type"]].append(detail)
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
        for keyword, count in sorted(keyword_counts.items(), key=lambda item: (-item[1], item[0]))[:16]
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
) -> dict[str, Any]:
    working_rules = json.loads(json.dumps(rules))
    dynamic_stopwords = set(working_rules["stopwords"])
    dynamic_stopwords.update(entry.get("작성자", "") for entry in entries if entry.get("작성자"))
    dynamic_stopwords.update(entry.get("라인", "") for entry in entries if entry.get("라인"))
    for entry in entries:
        log_name = entry.get("업무 로그명", "") or ""
        for match in re.findall(r"\|\s*([가-힣]{2,4})\s*\|", log_name):
            dynamic_stopwords.add(match)
    for stakeholder_keywords in working_rules["stakeholders"].values():
        dynamic_stopwords.update(stakeholder_keywords)
    working_rules["stopwords"] = sorted({word for word in dynamic_stopwords if word})

    explicit_lookup = build_explicit_keyword_lookup(working_rules)

    enriched_entries = []
    for entry in entries:
        project_ids = (entry.get("Project & Mission") or []) + (entry.get("신규 프로젝트") or [])
        project_names = [project_lookup.get(project_id, project_id) for project_id in project_ids if project_lookup.get(project_id, project_id)]
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

    all_entries = [item["entry"] for item in enriched_entries]
    dynamic_keywords = infer_dynamic_keywords(all_entries, working_rules, explicit_lookup)
    all_compare_entries = [item["entry"] for item in enriched_entries if item["week_end"] in previous_weeks]
    month_entries = [
        item["entry"]
        for item in enriched_entries
        if item["work_date"] and item["work_date"].year == latest_date.year and item["work_date"].month == latest_date.month
    ]
    month_compare_entries = [
        item["entry"]
        for item in enriched_entries
        if item["work_date"] and item["work_date"].year == prev_month_year and item["work_date"].month == prev_month_num
    ]
    week_entries = [item["entry"] for item in enriched_entries if item["week_end"] == latest_week]
    week_compare_entries = [item["entry"] for item in enriched_entries if item["week_end"] == previous_week]

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
        "classification": {
            "mode": "hybrid",
            "rule_keywords": sum(len(values) for values in working_rules["issue_categories"].values()),
            "inferred_keywords": len(dynamic_keywords),
            "dynamic_blocklist": working_rules.get("dynamic_keyword_blocklist", []),
            "dynamic_allowlist": working_rules.get("dynamic_keyword_allowlist", []),
        },
        "periods": {
            "all": build_period_snapshot(all_entries, "전체 기간", working_rules, explicit_lookup, dynamic_keywords, all_compare_entries, "직전 4주"),
            "month": build_period_snapshot(
                month_entries,
                month_label(latest_date),
                working_rules,
                explicit_lookup,
                dynamic_keywords,
                month_compare_entries,
                f"{prev_month_year}년 {prev_month_num}월" if month_compare_entries else None,
            ),
            "week": build_period_snapshot(
                week_entries,
                week_label,
                working_rules,
                explicit_lookup,
                dynamic_keywords,
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

    intelligence = build_intelligence_data(t5t_logs, sorted_weeks, project_lookup, rules)

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
