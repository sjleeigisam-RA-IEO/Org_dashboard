from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "03. Construction Board" / "data"
MARKS_OUT = OUTPUT_DIR / "construction_online_update_marks.json"
KST = timezone(timedelta(hours=9))

SOURCES = (
    {
        "id": "news",
        "label": "Google News",
        "file": "construction_company_news_cache.json",
        "list_key": "articles",
        "kind": "article",
    },
    {
        "id": "nara",
        "label": "나라장터",
        "file": "construction_nara_contracts_cache.json",
        "list_key": "awards",
        "kind": "award",
    },
    {
        "id": "dart_awards",
        "label": "OpenDART 수주",
        "file": "construction_dart_awards_cache.json",
        "list_key": "awards",
        "kind": "award",
    },
    {
        "id": "dart_strategy",
        "label": "OpenDART 전략공시",
        "file": "construction_dart_strategy_cache.json",
        "list_key": "articles",
        "kind": "article",
    },
)


def compact_text(value: Any) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"\s+", " ", text).strip()


def normalize_key(value: Any) -> str:
    text = compact_text(value).lower()
    for token in ("(주)", "㈜", "주식회사", "co., ltd.", "co. ltd.", "corporation", "inc.", "inc"):
        text = text.replace(token, "")
    return re.sub(r"[^0-9a-z\uac00-\ud7a3]", "", text)


def company_key(entry: dict[str, Any]) -> str:
    return normalize_key(entry.get("company"))


def item_key(item: dict[str, Any], kind: str) -> str:
    if kind == "article":
        return (
            normalize_key(item.get("receipt_no"))
            or normalize_key(item.get("title"))
            or normalize_key(item.get("url"))
        )
    if kind == "award":
        return normalize_key(item.get("receipt_no")) or "|".join(
            normalize_key(item.get(field)) for field in ("project", "client", "date", "amount")
        )
    return ""


def item_summary(item: dict[str, Any], kind: str) -> str:
    if kind == "article":
        title = compact_text(item.get("title"))
        published = compact_text(item.get("published") or item.get("date"))
        return " · ".join(part for part in (published, title) if part)
    project = compact_text(item.get("project"))
    date = compact_text(item.get("date"))
    amount = compact_text(item.get("amount"))
    return " · ".join(part for part in (date, project, amount) if part)


def read_cache(path: Path, list_key: str, kind: str) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    companies: dict[str, dict[str, Any]] = {}
    for entry in payload.get("companies") or []:
        key = company_key(entry)
        if not key:
            continue
        items: dict[str, dict[str, Any]] = {}
        for item in entry.get(list_key) or []:
            if not isinstance(item, dict):
                continue
            key_item = item_key(item, kind)
            if key_item:
                items[key_item] = item
        if items:
            companies[key] = {
                "company": entry.get("company") or "",
                "items": items,
            }
    return companies


def build_marks(before_dir: Path, after_dir: Path) -> dict[str, Any]:
    companies: dict[str, dict[str, Any]] = {}
    for source in SOURCES:
        before = read_cache(before_dir / source["file"], source["list_key"], source["kind"])
        after = read_cache(after_dir / source["file"], source["list_key"], source["kind"])
        for key, after_entry in after.items():
            before_items = before.get(key, {}).get("items", {})
            added_keys = [item_id for item_id in after_entry["items"] if item_id not in before_items]
            if not added_keys:
                continue
            packed = companies.setdefault(
                key,
                {
                    "company_key": key,
                    "company": after_entry.get("company") or before.get(key, {}).get("company") or key,
                    "added_count": 0,
                    "sources": [],
                },
            )
            samples = [item_summary(after_entry["items"][item_id], source["kind"]) for item_id in added_keys[:3]]
            source_entry = {
                "id": source["id"],
                "label": source["label"],
                "item_type": source["kind"],
                "added_count": len(added_keys),
                "item_keys": added_keys,
                "samples": [sample for sample in samples if sample],
            }
            packed["sources"].append(source_entry)
            packed["added_count"] += len(added_keys)

    return {
        "generated_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST"),
        "before_dir": str(before_dir),
        "after_dir": str(after_dir),
        "sources": [{key: source[key] for key in ("id", "label", "file")} for source in SOURCES],
        "companies": sorted(
            companies.values(),
            key=lambda item: (-int(item.get("added_count") or 0), compact_text(item.get("company"))),
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mark companies with newly added online cache items.")
    parser.add_argument("--before-dir", type=Path, required=True, help="Directory containing the pre-refresh cache files.")
    parser.add_argument("--after-dir", type=Path, default=OUTPUT_DIR, help="Directory containing refreshed cache files.")
    parser.add_argument("--output", type=Path, default=MARKS_OUT, help="Output JSON mark file.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = build_marks(args.before_dir, args.after_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {args.output}")
    print(f"Companies with online updates: {len(payload.get('companies') or [])}")


if __name__ == "__main__":
    main()
