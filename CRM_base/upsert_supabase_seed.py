import argparse
import json
from pathlib import Path

from supabase import create_client
from env_utils import get_required_supabase_config


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_SEED_DIR = BASE_DIR / "supabase_seed"

TABLE_ORDER = [
    "orgs",
    "staff",
    "staff_org_assignments",
    "seats",
    "seat_layout_shapes",
    "aum_snapshots",
    "fund_lifecycle",
    "projects",
    "project_staff_links",
    "t5t_logs",
    "t5t_log_project_links",
    "t5t_form_submissions",
    "t5t_form_items",
]

CONFLICT_KEYS = {
    "orgs": "org_id",
    "staff": "staff_id",
    "staff_org_assignments": "assignment_id",
    "seats": "seat_id",
    "seat_layout_shapes": "shape_id",
    "aum_snapshots": "snapshot_id",
    "fund_lifecycle": "fund_id",
    "projects": "project_id",
    "project_staff_links": "link_id",
    "t5t_logs": "t5t_log_id",
    "t5t_log_project_links": "link_id",
    "t5t_form_submissions": "submission_id",
    "t5t_form_items": "form_item_id",
}


def read_rows(seed_dir, table):
    path = seed_dir / f"{table}.json"
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def chunked(rows, size):
    for idx in range(0, len(rows), size):
        yield rows[idx:idx + size]


def get_client():
    url, key = get_required_supabase_config()
    return create_client(url, key)


def upload(seed_dir, tables, chunk_size, dry_run):
    client = None if dry_run else get_client()
    summary = {}

    for table in tables:
        rows = read_rows(seed_dir, table)
        summary[table] = len(rows)
        if dry_run:
            print(f"[dry-run] {table}: {len(rows)} rows")
            continue

        conflict = CONFLICT_KEYS[table]
        for batch_no, batch in enumerate(chunked(rows, chunk_size), start=1):
            client.table(table).upsert(batch, on_conflict=conflict).execute()
            print(f"{table}: uploaded batch {batch_no} ({len(batch)} rows)")

    return summary


def main():
    parser = argparse.ArgumentParser(description="Upsert generated dashboard migration seed data to Supabase.")
    parser.add_argument("--seed-dir", default=str(DEFAULT_SEED_DIR), help="Directory created by build_supabase_seed.py.")
    parser.add_argument("--table", action="append", choices=TABLE_ORDER, help="Upload only this table. Can repeat.")
    parser.add_argument("--chunk-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true", help="Validate seed files and print counts without uploading.")
    args = parser.parse_args()

    tables = args.table or TABLE_ORDER
    summary = upload(Path(args.seed_dir), tables, args.chunk_size, args.dry_run)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
