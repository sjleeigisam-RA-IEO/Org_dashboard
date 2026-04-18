"""
Resolve Notion relation page IDs into display names for dashboard grouping.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR.parent / "notion_config.json"
DATA_DIR = BASE_DIR / "data"
T5T_LOG_PATH = DATA_DIR / "t5t_log.json"
RELATION_MAP_PATH = DATA_DIR / "relation_map.json"

with CONFIG_PATH.open("r", encoding="utf-8") as file:
    config = json.load(file)

API_KEY = config["NOTION_API_KEY"]
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
}

TITLE_CANDIDATES = [
    "Project & Mission 이름",
    "프로젝트명",
    "업무명",
    "이름",
    "Name",
    "title",
]


def notion_get_json(endpoint: str) -> dict:
    request = urllib.request.Request(f"https://api.notion.com/v1/{endpoint}", headers=HEADERS, method="GET")
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_title_from_property(prop: dict) -> str | None:
    prop_type = prop.get("type")
    if prop_type == "title":
        return "".join(item.get("plain_text", "") for item in prop.get("title", [])) or None
    if prop_type == "rich_text":
        return "".join(item.get("plain_text", "") for item in prop.get("rich_text", [])) or None
    return None


def get_page_title(page_id: str) -> str:
    try:
        page = notion_get_json(f"pages/{page_id}")
    except Exception as exc:  # pragma: no cover - network failure path
        return f"Error:{exc}"

    properties = page.get("properties", {})

    for key in TITLE_CANDIDATES:
        if key in properties:
            title = extract_title_from_property(properties[key])
            if title:
                return title

    for prop in properties.values():
        title = extract_title_from_property(prop)
        if title:
            return title

    return "Untitled"


def main() -> None:
    with T5T_LOG_PATH.open("r", encoding="utf-8") as file:
        t5t_logs = json.load(file)

    relation_ids: set[str] = set()
    for entry in t5t_logs:
        relation_ids.update(entry.get("Project & Mission", []) or [])
        relation_ids.update(entry.get("신규 프로젝트", []) or [])

    existing_map = {}
    if RELATION_MAP_PATH.exists():
        with RELATION_MAP_PATH.open("r", encoding="utf-8") as file:
            existing_map = json.load(file)

    relation_map = dict(existing_map)
    total = len(relation_ids)
    print(f"Resolving relation IDs: {total}")

    for index, relation_id in enumerate(sorted(relation_ids), start=1):
        current = relation_map.get(relation_id)
        if current and current != "Untitled" and not str(current).startswith("Error:"):
            continue

        title = get_page_title(relation_id)
        relation_map[relation_id] = title
        print(f"[{index}/{total}] {relation_id[:12]}... -> {title}")
        time.sleep(0.2)

    with RELATION_MAP_PATH.open("w", encoding="utf-8") as file:
        json.dump(relation_map, file, ensure_ascii=False, indent=2)

    print(f"Saved {len(relation_map)} mappings to {RELATION_MAP_PATH}")


if __name__ == "__main__":
    main()
