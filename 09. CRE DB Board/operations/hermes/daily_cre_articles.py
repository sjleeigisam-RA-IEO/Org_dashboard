from __future__ import annotations

from datetime import datetime
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
UV = shutil.which("uv")
LOCAL_APP_DATA = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
LOG = LOCAL_APP_DATA / "hermes" / "cron" / "output" / "cre-daily-articles-latest.log"

if not UV:
    raise SystemExit("uv executable was not found on PATH")


def run_step(arguments: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [UV, "run", *arguments],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


collector = run_step(
    [
        "--with", "psycopg[binary]",
        "python", "scripts/collect_daily_rss_supabase.py",
        "--lookback-days", "2",
    ],
    timeout=1200,
)
LOG.parent.mkdir(parents=True, exist_ok=True)
LOG.write_text(
    f"collector_completed_at={datetime.now().astimezone().isoformat()}\nexit_code={collector.returncode}\n"
    + collector.stdout
    + ("\nSTDERR\n" + collector.stderr if collector.stderr else ""),
    encoding="utf-8",
)
if collector.returncode != 0:
    print("CRE 일일 기사 수집 실패\n" + (collector.stderr or collector.stdout)[-4000:])
    raise SystemExit(collector.returncode)

enrichment = run_step(
    [
        "--with", "psycopg[binary]",
        "--with", "googlenewsdecoder",
        "--with", "trafilatura",
        "python", "scripts/enrich_document_content.py",
        "--types", "RSS_ITEM", "--limit", "150",
    ],
    timeout=1800,
)
with LOG.open("a", encoding="utf-8") as handle:
    handle.write(
        "\nENRICHMENT\n"
        f"enrichment_completed_at={datetime.now().astimezone().isoformat()}\n"
        + enrichment.stdout
    )
    if enrichment.stderr:
        handle.write("\nSTDERR\n" + enrichment.stderr)
if enrichment.returncode != 0:
    print("CRE 기사 본문 요약 실패\n" + (enrichment.stderr or enrichment.stdout)[-4000:])
    raise SystemExit(enrichment.returncode)
