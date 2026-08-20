import argparse
import json
import os
from pathlib import Path

from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent


def load_env():
    env_path = PROJECT_DIR / ".env"
    values = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key] = value
    values.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    return values


def fetch_all(client, table, select="*"):
    rows = []
    start = 0
    size = 1000
    while True:
        batch = client.table(table).select(select).range(start, start + size - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < size:
            return rows
        start += size


def verify_columns(client):
    checks = [
        ("iota_seoul_log_links", "link_id,proj_id,asset_id"),
        ("risk_management_points", "id,fund_id,asset_id"),
        ("lender_exposures", "id,fund_id,asset_id"),
        ("beneficiary_exposures", "id,fund_id,asset_id"),
    ]
    for table, select in checks:
        client.table(table).select(select).limit(1).execute()


def build_updates(client):
    funds = fetch_all(client, "funds", "fund_id,primary_asset_id")
    projects = fetch_all(client, "projects", "project_id,primary_asset_id")
    fund_asset = {row["fund_id"]: row.get("primary_asset_id") for row in funds if row.get("fund_id")}
    project_asset = {row["project_id"]: row.get("primary_asset_id") for row in projects if row.get("project_id")}

    updates = {
        "iota_seoul_log_links": [],
        "risk_management_points": [],
        "lender_exposures": [],
        "beneficiary_exposures": [],
    }

    for row in fetch_all(client, "iota_seoul_log_links", "link_id,proj_id,asset_id"):
        asset_id = project_asset.get(row.get("proj_id")) or fund_asset.get(row.get("proj_id"))
        if asset_id and row.get("asset_id") != asset_id:
            updates["iota_seoul_log_links"].append({"link_id": row["link_id"], "asset_id": asset_id})

    for table in ["risk_management_points"]:
        for row in fetch_all(client, table, "id,fund_id,asset_id"):
            asset_id = fund_asset.get(row.get("fund_id"))
            if asset_id and row.get("asset_id") != asset_id:
                updates[table].append({"id": row["id"], "asset_id": asset_id})

    for table in ["lender_exposures", "beneficiary_exposures"]:
        for row in fetch_all(client, table, "id,fund_id,asset_id"):
            # Only backfill if asset_id is currently null, preserving precise excel-level mappings
            if not row.get("asset_id"):
                asset_id = fund_asset.get(row.get("fund_id"))
                if asset_id:
                    updates[table].append({"id": row["id"], "asset_id": asset_id})


    return updates


def apply_updates(client, updates):
    for row in updates["iota_seoul_log_links"]:
        client.table("iota_seoul_log_links").update({"asset_id": row["asset_id"]}).eq("link_id", row["link_id"]).execute()
    for table in ["risk_management_points", "lender_exposures", "beneficiary_exposures"]:
        for row in updates[table]:
            client.table(table).update({"asset_id": row["asset_id"]}).eq("id", row["id"]).execute()


def summary(client):
    result = {}
    for table, key in [
        ("iota_seoul_log_links", "link_id"),
        ("risk_management_points", "id"),
        ("lender_exposures", "id"),
        ("beneficiary_exposures", "id"),
    ]:
        result[f"{table}_with_asset_id"] = (
            client.table(table).select(key, count="exact").not_.is_("asset_id", "null").limit(1).execute().count
        )
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])
    verify_columns(client)
    updates = build_updates(client)
    print(
        json.dumps(
            {
                "pending_updates": {table: len(rows) for table, rows in updates.items()},
                "sample_updates": {table: rows[:5] for table, rows in updates.items()},
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    if not args.apply:
        print("DRY_RUN only. Run with --apply after SQL migration is applied.")
        return

    apply_updates(client, updates)
    print("APPLIED")
    print(json.dumps(summary(client), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
