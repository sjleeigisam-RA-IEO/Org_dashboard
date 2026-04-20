from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from automation_runtime.notion_runtime import NotionClient, NotionConfig, page_to_record


def main() -> None:
    config = NotionConfig.load(ROOT)
    client = NotionClient(config)
    pages = client.query_database(
        config.activity_log_db_id,
        filter_payload={"property": "주차종료일", "date": {"equals": "2026-04-20"}},
    )

    groups: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
    for page in pages:
        record = page_to_record(page)
        key = (
            str(record.get("원문 URL") or ""),
            str(record.get("작성자") or ""),
            str(record.get("업무일자") or ""),
        )
        groups[key].append(
            {
                "id": page["id"],
                "created_time": str(record.get("생성일시") or ""),
                "title": str(record.get("업무 로그명") or ""),
            }
        )

    delete_ids: list[str] = []
    for _, items in groups.items():
        if len(items) <= 5:
            continue
        for item in items:
            if item["id"].startswith("3488ced4-3c47-81"):
                delete_ids.append(item["id"])

    output = {"delete_count": len(delete_ids), "page_ids": delete_ids}
    output_path = ROOT / "automation_runtime" / "state" / "dedupe_cleanup_2026-04-20.json"
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(output_path))

    for page_id in delete_ids:
        client.archive_page(page_id)


if __name__ == "__main__":
    main()
