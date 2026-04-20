"""
Backfill classification tokens for T5T Notion log pages.

This script reads synced JSON files, derives normalized hashtag-style tokens
from each log summary and related project names, and can optionally write them
back to the Notion database.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CONFIG_PATH = BASE_DIR.parent / "notion_config.json"
RULES_PATH = BASE_DIR / "intelligence_rules.json"
OUTPUT_PATH = DATA_DIR / "classification_token_candidates.json"

T5T_DB_ID = "60881ecb-1653-4bb3-b18d-479cb2603a4d"

FIELD_NEW_PROJECT = "\uc2e0\uaddc \ud504\ub85c\uc81d\ud2b8"
FIELD_SOURCE_SUMMARY = "\uc6d0\ubb38 \uc694\uc57d"
FIELD_WORK_DATE = "\uc5c5\ubb34\uc77c\uc790"
FIELD_TASK_TYPE = "\uc5c5\ubb34\uc720\ud615"
FIELD_WRITER = "\uc791\uc131\uc790"
FIELD_LINE = "\ub77c\uc778"
FIELD_REMARKS = "\ube44\uace0"
FIELD_LOG_NAME = "\uc5c5\ubb34 \ub85c\uadf8\uba85"
FIELD_PROJECT_NAME_PM = "Project & Mission \uc774\ub984"
FIELD_PROJECT_NAME_MASTER = "\ud504\ub85c\uc81d\ud2b8\uba85"
FIELD_CLASS_SUMMARY = "\ubd84\ub958 \uc694\uc57d"
FIELD_CLASS_TOKENS = "\ubd84\ub958 \ud1a0\ud070"
FIELD_CLASS_SUMMARY_ASCII = "classification_summary"
FIELD_CLASS_TOKENS_ASCII = "classification_tokens"

TOKEN_FIELD_CANDIDATES = [
    FIELD_CLASS_TOKENS_ASCII,
    FIELD_CLASS_TOKENS,
    "\ubd84\ub958\ud1a0\ud070",
    "\ud574\uc2dc\ud0dc\uadf8",
    "\uc8fc\uc694 \ud0a4\uc6cc\ub4dc",
    "\uc8fc\uc694\ud0a4\uc6cc\ub4dc",
    "\ud0a4\uc6cc\ub4dc",
    "\ud0dc\uadf8",
]
PROJECT_FIELD_CANDIDATES = ["Project & Mission", FIELD_NEW_PROJECT]
SUMMARY_FIELD_CANDIDATES = [FIELD_SOURCE_SUMMARY, FIELD_REMARKS, FIELD_LOG_NAME]

DEFAULT_STOPWORDS = {
    "\uad00\ub828",
    "\uc9c4\ud589",
    "\uac80\ud1a0",
    "\ud611\uc758",
    "\ub300\uc751",
    "\ubcf4\uace0",
    "\uc900\ube44",
    "\ud68c\uc758",
    "\ud6c4\uc18d",
    "\uc5c5\ubb34",
    "\ud504\ub85c\uc81d\ud2b8",
    "\ud380\ub4dc",
    "\ud22c\uc790",
    "\ud604\ud669",
    "\uc790\ub8cc",
    "\uc815\ub9ac",
    "\ucd94\uc9c4",
    "\uacc4\ud68d",
    "\ub0b4\ubd80",
    "\uc678\ubd80",
    "\uc8fc\uac04",
    "\uc774\ubc88",
    "\ud544\uc694",
    "\uc644\ub8cc",
    "\uc608\uc815",
    "\uc9c4\ud589\uc911",
    "\uacf5\uc720",
    "\uc5c5\ub370\uc774\ud2b8",
    "\uc694\uccad",
    "\ud655\uc778",
    "\ub17c\uc758",
    "\uc791\uc131",
    "\uc704\ud574",
    "\uc704\ud55c",
    "\ucd94\uac00",
    "\ud655\uc815",
    "\uc791\uc5c5",
    "\uac00\ub2a5\uc131",
    "\ud611\uc758\ub97c",
    "\uac80\ud1a0\ub97c",
    "\uc9c4\ud589\uc744",
    "\ubcf4\uace0\ub97c",
    "\uc8fc\uc694",
    "\ubbf8\ud305\uc744",
    "\ud30c\uc545\uc744",
    "\ubcf4\uace0\uc640",
}
ALWAYS_KEEP = {"pf", "ir", "loc", "mou", "spa", "eod", "lp", "rfp"}


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(stringify(item) for item in value if stringify(item))
    return str(value).strip()


def build_project_lookup() -> dict[str, str]:
    relation_map = load_json(DATA_DIR / "relation_map.json", {})
    project_mission = load_json(DATA_DIR / "project_mission.json", [])
    project_master = load_json(DATA_DIR / "project_master.json", [])

    lookup = {}
    for record_id, name in relation_map.items():
        if name and name != "Untitled":
            lookup[record_id] = name
    for record in project_mission:
        name = record.get(FIELD_PROJECT_NAME_PM)
        if name and record.get("_id") and record["_id"] not in lookup:
            lookup[record["_id"]] = name
    for record in project_master:
        name = record.get(FIELD_PROJECT_NAME_MASTER)
        if name and record.get("_id") and record["_id"] not in lookup:
            lookup[record["_id"]] = name
    return lookup


def load_stopwords() -> set[str]:
    stopwords = {word.lower() for word in DEFAULT_STOPWORDS}
    user_rules = load_json(RULES_PATH, {})
    for token in user_rules.get("stopwords", []):
        if token:
            stopwords.add(str(token).strip().lower())
    for token in user_rules.get("dynamic_keyword_blocklist", []):
        if token:
            stopwords.add(str(token).strip().lower())
    return stopwords


def normalize_project_names(entry: dict[str, Any], project_lookup: dict[str, str]) -> list[str]:
    project_names = []
    seen = set()
    for field_name in PROJECT_FIELD_CANDIDATES:
        for project_id in entry.get(field_name, []) or []:
            name = project_lookup.get(project_id)
            if not name:
                continue
            lowered = name.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            project_names.append(name)
    return project_names


def clean_token(token: str) -> str:
    token = token.strip().lstrip("#").strip()
    token = re.sub(r"^[^\w가-힣]+|[^\w가-힣&.+/-]+$", "", token)
    if re.fullmatch(r"[가-힣]{3,}", token):
        stripped = re.sub(r"(에서|으로|에게|까지|부터|보다|처럼|만의|와의|과의|으로의|에서의|에게서|의|을|를|이|가|은|는|와|과|도|만)$", "", token)
        if len(stripped) >= 2:
            token = stripped
    return token


def tokenize_text(text: str, stopwords: set[str]) -> list[str]:
    matches = re.findall(r"[A-Za-z][A-Za-z0-9&.+/-]{1,}|[가-힣]{2,}|[0-9]+호", text)
    results = []
    seen = set()
    for raw in matches:
        token = clean_token(raw)
        if len(token) < 2:
            continue
        lowered = token.lower()
        if lowered in stopwords and lowered not in ALWAYS_KEEP:
            continue
        if re.fullmatch(r"\d+", token):
            continue
        if re.fullmatch(r"[A-Za-z]{2,3}", token) and lowered not in ALWAYS_KEEP:
            continue
        if lowered in seen:
            continue
        seen.add(lowered)
        results.append(token)
    return results


def derive_tokens(entry: dict[str, Any], project_lookup: dict[str, str], stopwords: set[str]) -> list[str]:
    source_parts = []
    for field_name in SUMMARY_FIELD_CANDIDATES:
        value = stringify(entry.get(field_name))
        if field_name == FIELD_LOG_NAME and "|" in value:
            value = value.split("|")[-1].strip()
        source_parts.append(value)

    project_names = normalize_project_names(entry, project_lookup)
    text = " ".join(part for part in source_parts + project_names if part)
    base_tokens = tokenize_text(text, stopwords)

    ordered = []
    seen = set()
    for token in project_names + base_tokens:
        cleaned = clean_token(token)
        lowered = cleaned.lower()
        if len(cleaned) < 2 or lowered in seen:
            continue
        seen.add(lowered)
        ordered.append(cleaned)
    if not ordered:
        return ["미입력", "분류대기"]
    return ordered[:12]


def make_token_string(tokens: list[str]) -> str:
    return " ".join(f"#{token}" for token in tokens)


def derive_classification_summary(entry: dict[str, Any], project_lookup: dict[str, str]) -> str:
    source_summary = stringify(entry.get(FIELD_SOURCE_SUMMARY))
    remarks = stringify(entry.get(FIELD_REMARKS))
    project_names = normalize_project_names(entry, project_lookup)

    if not source_summary and not remarks and not project_names:
        return "원문 요약 및 업무 로그명 미입력으로 분류 대기."

    base = source_summary or remarks
    base = re.sub(r"\s+", " ", base).strip()

    if project_names:
        primary = project_names[0]
        lowered_base = base.lower()
        if primary.lower() not in lowered_base:
            if base:
                return f"{primary} 관련, {base}"
            return f"{primary} 관련 업무"

    return base[:280]


def notion_request(api_key: str, endpoint: str, method: str = "GET", data: dict[str, Any] | None = None) -> dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
    }
    req_body = json.dumps(data).encode("utf-8") if data is not None else None
    request = urllib.request.Request(f"https://api.notion.com/v1/{endpoint}", headers=headers, data=req_body, method=method)
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_database_schema(api_key: str) -> dict[str, Any]:
    return notion_request(api_key, f"databases/{T5T_DB_ID}")


def resolve_token_field_name(schema: dict[str, Any]) -> str | None:
    properties = schema.get("properties", {})
    for candidate in TOKEN_FIELD_CANDIDATES:
        if candidate in properties:
            return candidate
    return None


def build_notion_property_payload(property_type: str, token_string: str) -> dict[str, Any]:
    if property_type == "rich_text":
        return {
            "rich_text": [
                {
                    "type": "text",
                    "text": {"content": token_string[:1900]},
                }
            ]
        }
    if property_type == "multi_select":
        names = [token.lstrip("#")[:100] for token in token_string.split() if token.strip()]
        return {"multi_select": [{"name": name} for name in names[:20]]}
    raise ValueError(f"Unsupported token field type: {property_type}")


def resolve_summary_field_name(schema: dict[str, Any]) -> str | None:
    properties = schema.get("properties", {})
    for candidate in [FIELD_CLASS_SUMMARY_ASCII, FIELD_CLASS_SUMMARY]:
        if candidate in properties:
            return candidate
    return None


def update_notion_fields(api_key: str, schema: dict[str, Any], records: list[dict[str, Any]]) -> tuple[int, str, str]:
    token_field_name = resolve_token_field_name(schema)
    summary_field_name = resolve_summary_field_name(schema)
    if not token_field_name:
        raise RuntimeError("Notion DB에 분류 토큰 계열 컬럼이 없습니다. 먼저 `분류 토큰` 컬럼을 추가해 주세요.")
    if not summary_field_name:
        raise RuntimeError("Notion DB에 classification_summary 계열 컬럼이 없습니다.")

    token_property_type = schema["properties"][token_field_name]["type"]
    summary_property_type = schema["properties"][summary_field_name]["type"]
    updated = 0
    for record in records:
        token_string = record["token_string"]
        summary_text = record["classification_summary"]
        if not token_string and not summary_text:
            continue
        properties = {}
        if token_string:
            properties[token_field_name] = build_notion_property_payload(token_property_type, token_string)
        if summary_text:
            properties[summary_field_name] = build_notion_property_payload(summary_property_type, summary_text)
        payload = {"properties": properties}
        notion_request(api_key, f"pages/{record['id']}", method="PATCH", data=payload)
        updated += 1
    return updated, token_field_name, summary_field_name


def main() -> None:
    apply_mode = "--apply" in sys.argv

    config = load_json(CONFIG_PATH, {})
    api_key = config.get("NOTION_API_KEY")
    if not api_key:
        raise RuntimeError("notion_config.json에 NOTION_API_KEY가 없습니다.")

    logs = load_json(DATA_DIR / "t5t_log.json", [])
    project_lookup = build_project_lookup()
    stopwords = load_stopwords()
    stopwords.update(
        str(entry.get(FIELD_WRITER, "")).strip().lower()
        for entry in logs
        if str(entry.get(FIELD_WRITER, "")).strip()
    )

    records = []
    token_counter = Counter()
    for entry in logs:
        tokens = derive_tokens(entry, project_lookup, stopwords)
        token_string = make_token_string(tokens)
        classification_summary = derive_classification_summary(entry, project_lookup)
        for token in tokens:
            token_counter[token] += 1
        records.append(
            {
                "id": entry.get("_id"),
                "work_date": entry.get(FIELD_WORK_DATE),
                "task_type": entry.get(FIELD_TASK_TYPE),
                "line": entry.get(FIELD_LINE),
                "writer": entry.get(FIELD_WRITER),
                "log_name": entry.get(FIELD_LOG_NAME, ""),
                "summary": entry.get(FIELD_SOURCE_SUMMARY, ""),
                "classification_summary": classification_summary,
                "projects": normalize_project_names(entry, project_lookup),
                "tokens": tokens,
                "token_string": token_string,
            }
        )

    output = {
        "generated_at": datetime.now().isoformat(),
        "count": len(records),
        "top_tokens": [{"token": token, "count": count} for token, count in token_counter.most_common(120)],
        "records": records,
    }
    with OUTPUT_PATH.open("w", encoding="utf-8") as file:
        json.dump(output, file, ensure_ascii=False, indent=2)

    print(f"Saved token candidates: {OUTPUT_PATH}")

    if apply_mode:
        schema = fetch_database_schema(api_key)
        updated_count, token_field_name, summary_field_name = update_notion_fields(api_key, schema, records)
        print(f"Updated {updated_count} Notion pages via `{token_field_name}` and `{summary_field_name}`")
    else:
        print("Preview mode only. Add --apply to write tokens back to Notion.")


if __name__ == "__main__":
    main()
