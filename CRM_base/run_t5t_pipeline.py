import json
import subprocess
import sys
from argparse import ArgumentParser
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent


def run_step(name, args):
    print(f"--- {name} ---", flush=True)
    result = subprocess.run(
        [sys.executable, *args],
        cwd=BASE_DIR.parent,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"{name} failed with exit code {result.returncode}")


def append_date_args(args, date_from=None, date_to=None):
    out = list(args)
    if date_from:
        out.extend(["--date-from", date_from])
    if date_to:
        out.extend(["--date-to", date_to])
    return out


def main():
    parser = ArgumentParser(description="Run the full T5T Notion-to-dashboard pipeline.")
    parser.add_argument("--date-from", help="Inclusive work_date lower bound, YYYY-MM-DD.")
    parser.add_argument("--date-to", help="Inclusive work_date upper bound, YYYY-MM-DD.")
    parser.add_argument(
        "--skip-sync",
        action="store_true",
        help="Skip Notion raw sync and only reclassify/normalize existing SQL rows.",
    )
    args = parser.parse_args()

    if not args.skip_sync:
        run_step(
            "1. Sync raw Notion T5T into SQL",
            append_date_args(["CRM_base/sync_notion_raw_to_sql.py"], args.date_from, args.date_to),
        )

    run_step(
        "2. Apply alias/project/mission rules to unmatched rows",
        append_date_args(
            ["CRM_base/apply_t5t_manual_aliases.py", "--apply", "--sample-size", "0"],
            args.date_from,
            args.date_to,
        ),
    )
    run_step(
        "3. Re-apply alias rules to prior general-work rows",
        append_date_args(
            [
                "CRM_base/apply_t5t_manual_aliases.py",
                "--status",
                "general_work",
                "--apply",
                "--sample-size",
                "0",
            ],
            args.date_from,
            args.date_to,
        ),
    )
    run_step(
        "4. Classify remaining non-project work as general work",
        append_date_args(["CRM_base/classify_t5t_general_work.py", "--apply", "--sample-size", "0"], args.date_from, args.date_to),
    )
    run_step(
        "5. Match remaining items against project/fund/asset masters",
        append_date_args(["CRM_base/match_t5t_entities.py", "--apply", "--sample-size", "0"], args.date_from, args.date_to),
    )
    run_step(
        "6. Normalize dashboard tables",
        append_date_args(["CRM_base/normalize_t5t_logs.py"], args.date_from, args.date_to),
    )

    print(json.dumps({"status": "ok", "date_from": args.date_from, "date_to": args.date_to}, ensure_ascii=False))


if __name__ == "__main__":
    main()
