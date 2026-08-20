import json
from argparse import ArgumentParser
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from supabase import create_client

from env_utils import get_required_supabase_config
from generate_t5t_weekly_summary import build_summary
from generate_t5t_weekly_summary import fetch_all
from generate_t5t_weekly_summary import fetch_lookup
from generate_t5t_weekly_summary import parse_date
from generate_t5t_weekly_summary import reporting_week
from generate_t5t_weekly_summary import upsert_summary_snapshot
from generate_t5t_weekly_summary import week_key_from_end
from generate_t5t_weekly_summary import write_json


def fetch_date_bounds(client):
    earliest = (
        client.table("t5t_form_items")
        .select("work_date")
        .not_.is_("work_date", "null")
        .order("work_date", desc=False)
        .limit(1)
        .execute()
        .data
        or []
    )
    latest = (
        client.table("t5t_form_items")
        .select("work_date")
        .not_.is_("work_date", "null")
        .order("work_date", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not earliest or not latest:
        raise RuntimeError("No dated t5t_form_items were found.")
    return parse_date(earliest[0]["work_date"]), parse_date(latest[0]["work_date"])


def iter_reporting_weeks(date_from, date_to):
    current_start, current_end = reporting_week(date_from)
    if current_end < date_from:
        current_start += timedelta(days=7)
        current_end += timedelta(days=7)
    while current_start <= date_to:
        yield max(current_start, date_from), min(current_end, date_to), current_end
        current_start += timedelta(days=7)
        current_end += timedelta(days=7)


def build_and_save_snapshot(client, staff, projects, funds, week_start, week_end, source, out_dir=None):
    rows = fetch_all(
        client,
        "t5t_form_items",
        "form_item_id,submission_id,item_no,writer_staff_id,work_date,line,raw_text,project_text,stakeholder_text,matched_project_id,matched_fund_id,classification_summary,task_type,match_status,metadata",
        week_start,
        week_end,
    )
    payload = build_summary(rows, staff, projects, funds, week_start, week_end)
    payload["week_key"] = week_key_from_end(week_end)
    payload["snapshot_backfilled_at"] = datetime.now(timezone.utc).isoformat()
    snapshot_key = upsert_summary_snapshot(client, payload, source=source)
    if out_dir:
        write_json(Path(out_dir) / f"{snapshot_key}.json", payload)
    return {
        "week_key": snapshot_key,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "total_logs": payload["total_logs"],
    }


def main():
    parser = ArgumentParser(description="Backfill Supabase T5T weekly summary snapshots by reporting week.")
    parser.add_argument("--date-from", help="Inclusive lower bound, YYYY-MM-DD. Defaults to earliest T5T item.")
    parser.add_argument("--date-to", help="Inclusive upper bound, YYYY-MM-DD. Defaults to latest T5T item.")
    parser.add_argument("--source", default="weekly_summary_backfill")
    parser.add_argument("--out-dir", help="Optional directory to also write week JSON files.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned weeks without writing snapshots.")
    args = parser.parse_args()

    url, key = get_required_supabase_config()
    client = create_client(url, key)

    min_date, max_date = fetch_date_bounds(client)
    date_from = parse_date(args.date_from) if args.date_from else min_date
    date_to = parse_date(args.date_to) if args.date_to else max_date
    if date_from > date_to:
        raise ValueError("--date-from must be on or before --date-to")

    weeks = list(iter_reporting_weeks(date_from, date_to))
    if args.dry_run:
        print(json.dumps({
            "status": "dry_run",
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "weeks": [
                {"week_start": start.isoformat(), "week_end": end.isoformat(), "week_key": week_key_from_end(end)}
                for start, end, _anchor in weeks
            ],
        }, ensure_ascii=False, indent=2))
        return

    staff = fetch_lookup(client, "staff", "staff_id,name,email", "staff_id")
    projects = fetch_lookup(client, "projects", "project_id,project_name", "project_id")
    funds = fetch_lookup(client, "funds", "fund_id,fund_name,short_name,asset_name", "fund_id")

    results = [
        build_and_save_snapshot(client, staff, projects, funds, week_start, week_end, args.source, args.out_dir)
        for week_start, week_end, _anchor in weeks
    ]
    print(json.dumps({
        "status": "ok",
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "snapshots": len(results),
        "total_logs": sum(item["total_logs"] for item in results),
        "first_week": results[0]["week_key"] if results else None,
        "last_week": results[-1]["week_key"] if results else None,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
