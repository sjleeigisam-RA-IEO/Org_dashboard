from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
OUTPUT_DIR = BASE_DIR / "output"
PLAN_CSV = OUTPUT_DIR / "asset_location_merge_plan.csv"
BACKUP_DIR = OUTPUT_DIR / "merge_backups"

STEP1_ACTIONS = {"update_asset_name_only", "update_asset_master_location"}


def load_env() -> dict[str, str]:
    values = {}
    for line in (PROJECT_DIR / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def clean(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"", "none", "null", "nan", "-"} else text


def as_float(value):
    text = clean(value)
    if not text:
        return None
    return float(text.replace(",", ""))


def fetch_asset(client, asset_id: str) -> dict:
    rows = (
        client.table("asset_master")
        .select(
            "asset_id,canonical_name,address_text,latitude,longitude,pnu,geocode_source,building_ledger_source,metadata,updated_at"
        )
        .eq("asset_id", asset_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else {}


def make_update_payload(row: dict[str, str]) -> dict:
    payload = {}
    accepted_name = clean(row.get("accepted_asset_name"))
    if accepted_name:
        payload["canonical_name"] = accepted_name

    if row["merge_action"] == "update_asset_master_location":
        proposed_address = clean(row.get("proposed_address"))
        proposed_pnu = clean(row.get("proposed_pnu"))
        proposed_lat = as_float(row.get("proposed_latitude"))
        proposed_lng = as_float(row.get("proposed_longitude"))
        if proposed_address:
            payload["address_text"] = proposed_address
        if proposed_pnu:
            payload["pnu"] = proposed_pnu
        if proposed_lat is not None:
            payload["latitude"] = proposed_lat
        if proposed_lng is not None:
            payload["longitude"] = proposed_lng
        if proposed_lat is not None and proposed_lng is not None:
            payload["geocode_source"] = "deal_board_domestic_completed_20240812"

    return payload


def flatten_backup(asset: dict) -> dict:
    return {
        "asset_id": asset.get("asset_id", ""),
        "canonical_name": asset.get("canonical_name", ""),
        "address_text": asset.get("address_text", ""),
        "pnu": asset.get("pnu", ""),
        "latitude": asset.get("latitude", ""),
        "longitude": asset.get("longitude", ""),
        "geocode_source": asset.get("geocode_source", ""),
        "building_ledger_source": asset.get("building_ledger_source", ""),
        "updated_at": asset.get("updated_at", ""),
        "metadata_json": json.dumps(asset.get("metadata") or {}, ensure_ascii=False, sort_keys=True),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply updates to Supabase. Defaults to dry-run.")
    args = parser.parse_args()

    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])

    with PLAN_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        plan_rows = [
            row
            for row in csv.DictReader(handle)
            if row.get("merge_action") in STEP1_ACTIONS
        ]

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_csv = BACKUP_DIR / f"step1_asset_master_backup_{timestamp}.csv"
    dry_run_csv = BACKUP_DIR / f"step1_asset_master_plan_{timestamp}.csv"

    backup_rows = []
    dry_rows = []
    update_results = []
    grouped_rows: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in plan_rows:
        grouped_rows[clean(row.get("asset_id"))].append(row)

    for asset_id, rows in grouped_rows.items():
        current = fetch_asset(client, asset_id)
        if not current:
            for row in rows:
                dry_rows.append({**row, "db_fetch_status": "asset_not_found", "update_payload_json": "{}"})
            continue

        backup_rows.append(flatten_backup(current))
        payloads = [make_update_payload(row) for row in rows]
        payload_keys = {
            json.dumps(payload, ensure_ascii=False, sort_keys=True)
            for payload in payloads
        }
        has_conflict = len(payload_keys) > 1

        for row, payload in zip(rows, payloads):
            dry_rows.append(
                {
                    **row,
                    "db_fetch_status": "payload_conflict_same_asset_id" if has_conflict else "found",
                    "current_canonical_name": current.get("canonical_name", ""),
                    "current_address_text": current.get("address_text", ""),
                    "current_pnu": current.get("pnu", ""),
                    "current_latitude": current.get("latitude", ""),
                    "current_longitude": current.get("longitude", ""),
                    "update_payload_json": json.dumps(payload, ensure_ascii=False, sort_keys=True),
                }
            )

        if has_conflict:
            update_results.append(
                {
                    "asset_id": asset_id,
                    "merge_action": "skipped_conflicting_payloads",
                    "updated_rows": 0,
                    "payload": [json.loads(key) for key in sorted(payload_keys)],
                }
            )
            continue

        payload = payloads[0] if payloads else {}
        if args.apply and payload:
            response = (
                client.table("asset_master")
                .update(payload)
                .eq("asset_id", asset_id)
                .execute()
            )
            update_results.append(
                {
                    "asset_id": asset_id,
                    "merge_action": rows[0].get("merge_action", ""),
                    "updated_rows": len(response.data or []),
                    "payload": payload,
                }
            )

    if backup_rows:
        with backup_csv.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(backup_rows[0].keys()))
            writer.writeheader()
            writer.writerows(backup_rows)

    if dry_rows:
        with dry_run_csv.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(dry_rows[0].keys()))
            writer.writeheader()
            writer.writerows(dry_rows)

    result = {
        "mode": "apply" if args.apply else "dry_run",
        "candidate_rows": len(plan_rows),
        "backup_csv": str(backup_csv),
        "plan_csv": str(dry_run_csv),
        "applied_updates": update_results,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
