import argparse
import json
import os
from collections import defaultdict
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


def relation_priority(row):
    priority = {
        "underlying_asset": 0,
        "inferred_underlying_asset": 1,
        "related_project": 2,
    }.get(row.get("relation_type"), 9)
    return (priority, -(row.get("confidence") or 0), row.get("asset_id") or "")


def choose_best(rows):
    if not rows:
        return None
    return sorted(rows, key=relation_priority)[0]


def verify_columns(client):
    checks = [
        ("fund_assets", "id,fund_id,asset_id"),
        ("funds", "fund_id,primary_asset_id"),
        ("projects", "project_id,primary_asset_id"),
    ]
    for table, select in checks:
        client.table(table).select(select).limit(1).execute()


def build_updates(client):
    fund_assets = fetch_all(client, "fund_assets", "id,asset_id")
    funds = fetch_all(client, "funds", "fund_id,primary_asset_id,primary_asset_ids")
    projects = fetch_all(client, "projects", "project_id,primary_asset_id,primary_asset_ids")
    fund_links = fetch_all(client, "asset_fund_links", "*")
    project_links = fetch_all(client, "asset_project_links", "*")

    direct_asset_by_source_id = {}
    for link in fund_links:
        if link.get("source_table") == "fund_assets" and link.get("source_id"):
            direct_asset_by_source_id[str(link["source_id"])] = link.get("asset_id")

    fund_asset_updates = []
    for row in fund_assets:
        asset_id = direct_asset_by_source_id.get(str(row.get("id")))
        if asset_id and row.get("asset_id") != asset_id:
            fund_asset_updates.append({"id": row["id"], "asset_id": asset_id})

    links_by_fund = defaultdict(list)
    for link in fund_links:
        if link.get("fund_id"):
            links_by_fund[link["fund_id"]].append(link)

    fund_updates = []
    for row in funds:
        all_links = links_by_fund.get(row.get("fund_id"), [])
        best = choose_best(all_links)
        asset_ids = list(sorted({link.get("asset_id") for link in all_links if link.get("asset_id")}))
        
        need_update = False
        update_payload = {"fund_id": row["fund_id"]}
        if best and row.get("primary_asset_id") != best.get("asset_id"):
            update_payload["primary_asset_id"] = best["asset_id"]
            need_update = True
        if row.get("primary_asset_ids") != asset_ids and asset_ids:
            update_payload["primary_asset_ids"] = asset_ids
            need_update = True
            
        if need_update:
            fund_updates.append(update_payload)

    links_by_project = defaultdict(list)
    for link in project_links:
        if link.get("project_id"):
            links_by_project[link["project_id"]].append(link)

    project_updates = []
    for row in projects:
        all_links = links_by_project.get(row.get("project_id"), [])
        best = choose_best(all_links)
        asset_ids = list(sorted({link.get("asset_id") for link in all_links if link.get("asset_id")}))
        
        need_update = False
        update_payload = {"project_id": row["project_id"]}
        if best and row.get("primary_asset_id") != best.get("asset_id"):
            update_payload["primary_asset_id"] = best["asset_id"]
            need_update = True
        if row.get("primary_asset_ids") != asset_ids and asset_ids:
            update_payload["primary_asset_ids"] = asset_ids
            need_update = True
            
        if need_update:
            project_updates.append(update_payload)

    return {
        "fund_assets": fund_asset_updates,
        "funds": fund_updates,
        "projects": project_updates,
    }


def apply_updates(client, updates):
    for row in updates["fund_assets"]:
        client.table("fund_assets").update({"asset_id": row["asset_id"]}).eq("id", row["id"]).execute()
    for row in updates["funds"]:
        payload = {k: v for k, v in row.items() if k != "fund_id"}
        if payload:
            client.table("funds").update(payload).eq("fund_id", row["fund_id"]).execute()
    for row in updates["projects"]:
        payload = {k: v for k, v in row.items() if k != "project_id"}
        if payload:
            client.table("projects").update(payload).eq("project_id", row["project_id"]).execute()



def relationship_summary(client):
    return {
        "fund_assets_with_asset_id": client.table("fund_assets").select("id", count="exact").not_.is_("asset_id", "null").limit(1).execute().count,
        "funds_with_primary_asset_id": client.table("funds").select("fund_id", count="exact").not_.is_("primary_asset_id", "null").limit(1).execute().count,
        "projects_with_primary_asset_id": client.table("projects").select("project_id", count="exact").not_.is_("primary_asset_id", "null").limit(1).execute().count,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])
    verify_columns(client)
    updates = build_updates(client)
    payload = {
        "pending_updates": {table: len(rows) for table, rows in updates.items()},
        "sample_updates": {table: rows[:5] for table, rows in updates.items()},
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))

    if not args.apply:
        print("DRY_RUN only. Run with --apply after SQL migration is applied.")
        return

    apply_updates(client, updates)
    print("APPLIED")
    print(json.dumps(relationship_summary(client), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
