import argparse
import os
import re
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
SOURCE_FILE = BASE_DIR / "_archive" / "Project & Mission 2.csv"


def clean_str(value):
    if value is None or pd.isna(value):
        return None
    text = str(value).replace("\xa0", " ").strip()
    return text or None


def norm(value):
    value = clean_str(value)
    if not value:
        return ""
    return re.sub(r"\s+", "", value).lower()


def split_vehicle_aliases(value):
    value = clean_str(value)
    if not value:
        return []
    parts = re.split(r"[,/·;]", value)
    aliases = []
    for part in parts:
        alias = clean_str(part)
        if alias and alias not in aliases:
            aliases.append(alias)
    return aliases


def get_client():
    load_dotenv(BASE_DIR / ".env")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL/SUPABASE_KEY missing in .env")
    return create_client(url, key)


def fetch_all_funds(client):
    funds = []
    start = 0
    size = 1000
    while True:
        rows = (
            client.table("funds")
            .select("fund_id,short_name,fund_name,asset_name,project_mission_name,metadata")
            .range(start, start + size - 1)
            .execute()
            .data
        )
        funds.extend(rows)
        if len(rows) < size:
            break
        start += size
    return funds


def build_updates(funds):
    pm = pd.read_csv(SOURCE_FILE, encoding="utf-8-sig", dtype=object)
    short_index = {}
    for fund in funds:
        short_key = norm(fund.get("short_name"))
        if short_key:
            short_index.setdefault(short_key, []).append(fund)

    updates = {}
    unmatched = []
    ambiguous = []

    for _, row in pm.iterrows():
        project_name = clean_str(row.get("Project & Mission 이름"))
        vehicle_cell = clean_str(row.get("Vehicle(약칭)"))
        pm_asset_name = clean_str(row.get("자산명"))
        if not project_name or not vehicle_cell:
            continue

        matched_funds = []
        for alias in split_vehicle_aliases(vehicle_cell):
            hits = short_index.get(norm(alias), [])
            if len(hits) == 1:
                matched_funds.append((alias, hits[0]))
            elif len(hits) > 1:
                ambiguous.append((vehicle_cell, project_name, alias, [h["fund_id"] for h in hits]))

        seen = set()
        matched_funds = [(a, f) for a, f in matched_funds if not (f["fund_id"] in seen or seen.add(f["fund_id"]))]
        if not matched_funds:
            unmatched.append((vehicle_cell, project_name, pm_asset_name))
            continue

        for alias, fund in matched_funds:
            fund_id = fund["fund_id"]
            metadata = fund.get("metadata") or {}
            if not isinstance(metadata, dict):
                metadata = {}
            if fund_id in updates:
                metadata = updates[fund_id]["metadata"]

            aliases = metadata.get("project_mission_vehicle_aliases") or []
            if not isinstance(aliases, list):
                aliases = [aliases]
            for item in split_vehicle_aliases(vehicle_cell):
                if item not in aliases:
                    aliases.append(item)

            project_names = metadata.get("project_mission_names") or []
            if not isinstance(project_names, list):
                project_names = [project_names]
            if project_name not in project_names:
                project_names.append(project_name)

            metadata.update(
                {
                    "project_mission_vehicle_aliases": aliases,
                    "project_mission_names": project_names,
                    "project_mission_asset_name": pm_asset_name,
                    "project_mission_source": "Project & Mission 2.csv",
                    "project_mission_previous_name": fund.get("project_mission_name"),
                }
            )

            display_project_name = " / ".join(project_names)
            updates[fund_id] = {
                "fund_id": fund_id,
                "short_name": fund.get("short_name"),
                "fund_name": fund.get("fund_name"),
                "old_project_mission_name": fund.get("project_mission_name"),
                "project_mission_name": display_project_name,
                "metadata": metadata,
            }

    multi_name_updates = [
        (row["fund_id"], row["project_mission_name"])
        for row in updates.values()
        if " / " in row["project_mission_name"]
    ]
    return updates, unmatched, ambiguous, multi_name_updates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Update funds.project_mission_name in Supabase.")
    args = parser.parse_args()

    client = get_client()
    funds = fetch_all_funds(client)
    updates, unmatched, ambiguous, multi_name_updates = build_updates(funds)

    changed = [u for u in updates.values() if u["old_project_mission_name"] != u["project_mission_name"]]

    print("Project & Mission sync preview")
    print(f"  funds in DB: {len(funds)}")
    print(f"  matched funds: {len(updates)}")
    print(f"  changed project names: {len(changed)}")
    print(f"  unmatched project rows: {len(unmatched)}")
    print(f"  ambiguous aliases: {len(ambiguous)}")
    print(f"  multi-name funds: {len(multi_name_updates)}")
    print("\nSample changes:")
    for row in changed[:20]:
        print(
            f"  {row['fund_id']} | {row['short_name']} | "
            f"{row['old_project_mission_name']} -> {row['project_mission_name']}"
        )

    if unmatched:
        print("\nUnmatched samples:")
        for row in unmatched[:20]:
            print(f"  vehicle={row[0]} | project={row[1]} | asset={row[2]}")

    if multi_name_updates:
        print("\nMulti-name fund samples:")
        for row in multi_name_updates[:20]:
            print(f"  fund_id={row[0]} | {row[1]}")

    if not args.apply:
        print("\nDry-run only. Re-run with --apply to update Supabase.")
        return

    for idx, row in enumerate(updates.values(), 1):
        client.table("funds").update(
            {
                "project_mission_name": row["project_mission_name"],
                "metadata": row["metadata"],
            }
        ).eq("fund_id", row["fund_id"]).execute()
        if idx % 50 == 0 or idx == len(updates):
            print(f"Updated {idx}/{len(updates)} funds...")

    print("\nProject & Mission sync completed.")


if __name__ == "__main__":
    main()
