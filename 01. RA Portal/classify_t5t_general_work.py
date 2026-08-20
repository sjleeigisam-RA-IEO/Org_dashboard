import json
from argparse import ArgumentParser
from collections import Counter

from supabase import create_client

from env_utils import get_required_supabase_config
from t5t_classification import GENERAL_WORK_STATUS
from t5t_classification import GENERAL_WORK_TASK_TYPE
from t5t_classification import is_general_work


def fetch_items(client, date_from=None, date_to=None):
    rows = []
    start = 0
    while True:
        query = client.table("t5t_form_items").select(
            "form_item_id,work_date,project_text,raw_text,classification_summary,match_status,task_type,metadata"
        )
        if date_from:
            query = query.gte("work_date", date_from)
        if date_to:
            query = query.lte("work_date", date_to)
        result = query.range(start, start + 999).execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def classify_candidates(rows):
    candidates = []
    for row in rows:
        if row.get("match_status") == "matched":
            continue
        if is_general_work(
            row.get("project_text"),
            row.get("raw_text"),
            row.get("classification_summary"),
            row.get("match_status"),
        ):
            candidates.append(row)
    return candidates


def update_candidates(client, candidates, chunk_size=500):
    updates = []
    for row in candidates:
        metadata = row.get("metadata") or {}
        metadata["general_work_rule"] = "no_project_or_generic_project_text"
        updates.append({
            "form_item_id": row["form_item_id"],
            "match_status": GENERAL_WORK_STATUS,
            "task_type": GENERAL_WORK_TASK_TYPE,
            "metadata": metadata,
        })

    for row in updates:
        form_item_id = row.pop("form_item_id")
        client.table("t5t_form_items").update(row).eq("form_item_id", form_item_id).execute()


def main():
    parser = ArgumentParser(description="Classify raw-unmatched T5T items that are general work.")
    parser.add_argument("--date-from", help="Inclusive work_date lower bound, YYYY-MM-DD.")
    parser.add_argument("--date-to", help="Inclusive work_date upper bound, YYYY-MM-DD.")
    parser.add_argument("--apply", action="store_true", help="Update Supabase. Default is dry-run.")
    parser.add_argument("--sample-size", type=int, default=20)
    args = parser.parse_args()

    url, key = get_required_supabase_config()
    client = create_client(url, key)
    rows = fetch_items(client, args.date_from, args.date_to)
    candidates = classify_candidates(rows)

    status_counts = Counter(row.get("match_status") or "EMPTY" for row in rows)
    month_counts = Counter((row.get("work_date") or "")[:7] for row in candidates)
    result = {
        "mode": "apply" if args.apply else "dry_run",
        "source_items": len(rows),
        "source_status_counts": dict(status_counts),
        "general_work_candidates": len(candidates),
        "candidate_month_counts": dict(sorted(month_counts.items())),
        "sample": [
            {
                "form_item_id": row.get("form_item_id"),
                "work_date": row.get("work_date"),
                "project_text": row.get("project_text"),
                "raw_text": (row.get("raw_text") or "")[:240],
                "classification_summary": row.get("classification_summary"),
            }
            for row in candidates[:args.sample_size]
        ],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if args.apply:
        update_candidates(client, candidates)
        print(json.dumps({"updated": len(candidates)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
