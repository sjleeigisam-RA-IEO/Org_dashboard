import argparse
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from automation_runtime.t5t_jobs import AutomationRuntime


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local Notion automation jobs without MCP approvals.")
    parser.add_argument(
        "--job",
        required=True,
        choices=[
            "t5t_summary_draft",
            "t5t_summary_update",
            "t5t_activity_first",
            "t5t_activity_update",
        ],
    )
    parser.add_argument("--date", help="Override run date in YYYY-MM-DD")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    runtime = AutomationRuntime(ROOT)
    run_date = date.fromisoformat(args.date) if args.date else None
    result = runtime.run_job(args.job, run_date)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
