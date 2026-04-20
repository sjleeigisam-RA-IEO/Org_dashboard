from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from automation_runtime.notion_runtime import NotionClient, NotionConfig, page_to_record


def normalize_key(value: str) -> str:
    return re.sub(r"[^0-9a-z가-힣]+", "", (value or "").lower())


def main() -> None:
    config = NotionConfig.load(ROOT)
    client = NotionClient(config)
    pages = client.query_database(
        config.activity_log_db_id,
        filter_payload={
            "and": [
                {"property": "주차종료일", "date": {"equals": "2026-04-20"}},
                {"property": "업무일자", "date": {"on_or_after": "2026-04-14"}},
                {"property": "업무일자", "date": {"on_or_before": "2026-04-20"}},
            ]
        },
    )

    records = []
    for page in pages:
        record = page_to_record(page)
        record["id"] = page["id"]
        records.append(record)

    by_signature: dict[tuple[str, str, str, str, str], list[dict[str, object]]] = defaultdict(list)
    for record in records:
        title = str(record.get("업무 로그명") or "")
        title = re.sub(r"^\d{4}-\d{2}-\d{2}\s*\|\s*[^|]+\|\s*", "", title).strip()
        signature = (
            str(record.get("원문 URL") or ""),
            str(record.get("작성자") or ""),
            str(record.get("업무일자") or ""),
            str(record.get("업무유형") or ""),
            normalize_key(title),
        )
        by_signature[signature].append(record)

    by_source: dict[tuple[str, str, str], list[dict[str, object]]] = defaultdict(list)
    for record in records:
        source_signature = (
            str(record.get("원문 URL") or ""),
            str(record.get("작성자") or ""),
            str(record.get("업무일자") or ""),
        )
        by_source[source_signature].append(record)

    duplicate_groups = []
    for signature, items in by_signature.items():
        if len(items) <= 1:
            continue
        duplicate_groups.append(
            {
                "signature": signature,
                "count": len(items),
                "rows": [
                    {
                        "id": row["id"],
                        "created_time": row.get("생성일시"),
                        "업무유형": row.get("업무유형"),
                        "업무 로그명": row.get("업무 로그명"),
                        "원문 요약": str(row.get("원문 요약") or "")[:240],
                    }
                    for row in sorted(items, key=lambda row: str(row.get("생성일시") or ""))
                ],
            }
        )

    source_groups = []
    for source_signature, items in by_source.items():
        if len(items) <= 1:
            continue
        source_groups.append(
            {
                "signature": source_signature,
                "count": len(items),
                "rows": [
                    {
                        "id": row["id"],
                        "created_time": row.get("생성일시"),
                        "업무유형": row.get("업무유형"),
                        "업무 로그명": row.get("업무 로그명"),
                    }
                    for row in sorted(
                        items,
                        key=lambda row: (str(row.get("생성일시") or ""), str(row.get("업무 로그명") or "")),
                    )
                ],
            }
        )

    output = {
        "count": len(records),
        "duplicate_group_count": len(duplicate_groups),
        "source_group_count": len(source_groups),
        "duplicate_groups": sorted(duplicate_groups, key=lambda item: item["signature"]),
        "source_groups": sorted(source_groups, key=lambda item: item["signature"]),
    }

    output_path = ROOT / "automation_runtime" / "state" / "dedupe_check_2026-04-14_2026-04-20.json"
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(output_path))


if __name__ == "__main__":
    main()
