import os
import csv
import sys
from pathlib import Path

# Add parent path to import env_utils
sys.path.append(str(Path(__file__).resolve().parent))

from env_utils import get_required_supabase_config
from supabase import create_client

def fetch_all(client, table, select="*"):
    rows = []
    start = 0
    size = 1000
    while True:
        try:
            batch = client.table(table).select(select).range(start, start + size - 1).execute().data or []
            rows.extend(batch)
            if len(batch) < size:
                return rows
            start += size
        except Exception as e:
            print(f"Error fetching batch at start {start}: {e}")
            break
    return rows

def main():
    print("Connecting to Supabase...")
    url, key = get_required_supabase_config()
    client = create_client(url, key)

    print("Fetching asset relationship summary data...")
    assets = fetch_all(client, "asset_relationship_summary", "*")
    print(f"Loaded {len(assets)} canonical asset summaries.")

    complete_list = []
    incomplete_list = []

    for row in assets:
        asset_id = row.get("asset_id")
        name = row.get("canonical_name") or "-"
        address = row.get("address_text") or "-"
        fund_count = row.get("fund_count") or 0
        project_count = row.get("project_count") or 0
        fund_ids = row.get("fund_ids") or []
        project_ids = row.get("project_ids") or []

        # Convert lists to comma-separated strings
        fund_ids_str = ", ".join(fund_ids)
        project_ids_str = ", ".join(project_ids)

        record = {
            "asset_id": asset_id,
            "canonical_name": name,
            "address_text": address,
            "fund_count": fund_count,
            "project_count": project_count,
            "linked_fund_ids": fund_ids_str,
            "linked_project_ids": project_ids_str
        }

        # Classify based on completeness of Asset-Fund-Project mappings
        # Complete means the asset HAS BOTH associated funds and associated projects
        if fund_count > 0 and project_count > 0:
            complete_list.append(record)
        else:
            incomplete_list.append(record)

    output_dir = Path(__file__).resolve().parent / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    complete_csv_path = output_dir / "complete_relationships.csv"
    incomplete_csv_path = output_dir / "incomplete_relationships.csv"

    headers = ["asset_id", "canonical_name", "address_text", "fund_count", "project_count", "linked_fund_ids", "linked_project_ids"]

    # Write Complete mappings
    with open(complete_csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(complete_list)

    # Write Incomplete mappings
    with open(incomplete_csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(incomplete_list)

    print("\n" + "="*50)
    print(" RELATIONSHIP CLASSIFICATION SUMMARY")
    print("="*50)
    print(f"Total Canonical Assets Checked : {len(assets)}")
    print(f"Complete (Asset-Fund-Project ALL Exist): {len(complete_list)} (saved to complete_relationships.csv)")
    print(f"Incomplete (One or more missing)       : {len(incomplete_list)} (saved to incomplete_relationships.csv)")
    print("="*50)
    print(f"Output files stored in: {output_dir.resolve()}\n")

if __name__ == "__main__":
    main()
