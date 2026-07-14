import json
from argparse import ArgumentParser
from collections import Counter

from supabase import create_client

from env_utils import get_required_supabase_config
from t5t_writer_identity import WriterIdentityResolver


def fetch_all(client, table, columns, null_column=None):
    order_columns = {
        "staff": "staff_id",
        "t5t_form_submissions": "submission_id",
        "t5t_form_items": "form_item_id",
    }
    rows = []
    start = 0
    while True:
        query = client.table(table).select(columns)
        if null_column:
            query = query.is_(null_column, "null")
        if table in order_columns:
            query = query.order(order_columns[table])
        batch = query.range(start, start + 999).execute().data or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def build_plan(client):
    staff_rows = fetch_all(client, "staff", "staff_id,name,email,status,metadata")
    resolver = WriterIdentityResolver(staff_rows)
    submissions = fetch_all(
        client,
        "t5t_form_submissions",
        "submission_id,writer_staff_id,writer_name,writer_email,metadata",
    )
    null_items = fetch_all(
        client,
        "t5t_form_items",
        "form_item_id,submission_id,writer_staff_id",
        null_column="writer_staff_id",
    )
    submission_by_id = {row["submission_id"]: row for row in submissions}
    item_counts = Counter(row.get("submission_id") for row in null_items)
    updates = []
    unresolved = []

    for submission_id, item_count in sorted(item_counts.items()):
        submission = submission_by_id.get(submission_id)
        if not submission:
            unresolved.append({
                "submission_id": submission_id,
                "item_count": item_count,
                "reason": "missing_submission",
            })
            continue

        match = resolver.resolve(submission.get("writer_email"), submission.get("writer_name"))
        if not match:
            unresolved.append({
                "submission_id": submission_id,
                "item_count": item_count,
                "writer_name": submission.get("writer_name"),
                "writer_email": submission.get("writer_email"),
                "reason": "unmatched_writer",
            })
            continue

        metadata = dict(submission.get("metadata") or {})
        metadata["writer_identity_backfill"] = {
            "source": match["source"],
            "previous_writer_staff_id": submission.get("writer_staff_id"),
            "previous_writer_name": submission.get("writer_name"),
            "previous_writer_email": submission.get("writer_email"),
        }
        updates.append({
            "submission_id": submission_id,
            "item_count": item_count,
            "staff_id": match["staff_id"],
            "writer_name": match["name"],
            "writer_email": match["email"],
            "source": match["source"],
            "metadata": metadata,
        })

    return null_items, updates, unresolved


def apply_plan(client, updates):
    for update in updates:
        submission_id = update["submission_id"]
        writer_update = {
            "writer_staff_id": update["staff_id"],
            "writer_name": update["writer_name"],
            "writer_email": update["writer_email"],
            "metadata": update["metadata"],
        }
        client.table("t5t_form_submissions").update(writer_update).eq(
            "submission_id", submission_id
        ).execute()
        client.table("t5t_form_items").update({
            "writer_staff_id": update["staff_id"],
        }).eq("submission_id", submission_id).execute()


def main():
    parser = ArgumentParser(description="Backfill unresolved T5T writer identities.")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--require-complete",
        action="store_true",
        help="Fail if any dashboard item still has no writer_staff_id.",
    )
    args = parser.parse_args()

    url, key = get_required_supabase_config()
    client = create_client(url, key)
    null_items, updates, unresolved = build_plan(client)
    writer_counts = Counter()
    for update in updates:
        writer_counts[update["writer_name"]] += update["item_count"]

    print(json.dumps({
        "mode": "apply" if args.apply else "dry_run",
        "anonymous_items_before": len(null_items),
        "resolvable_items": sum(row["item_count"] for row in updates),
        "resolvable_submissions": len(updates),
        "writer_counts": dict(writer_counts),
        "unresolved": unresolved,
    }, ensure_ascii=False, indent=2))

    if args.apply:
        apply_plan(client, updates)

    remaining = fetch_all(
        client,
        "t5t_form_items",
        "form_item_id,submission_id",
        null_column="writer_staff_id",
    )
    print(json.dumps({"anonymous_items_after": len(remaining)}, ensure_ascii=False))
    if args.require_complete and remaining:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
