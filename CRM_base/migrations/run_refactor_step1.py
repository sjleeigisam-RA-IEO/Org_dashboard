import sys
from pathlib import Path
from supabase import create_client

# Add CRM_base to path for env_utils
sys.path.append(r'd:\Project\00. 2025 RA 기획추진\RA dashboard\CRM_base')
from env_utils import get_required_supabase_config

def run_migration():
    url, key = get_required_supabase_config()
    client = create_client(url, key)

    sql_file = Path(r'd:\Project\00. 2025 RA 기획추진\RA dashboard\CRM_base\migrations\2026-05-15_refactor_step1.sql')
    if not sql_file.exists():
        print(f"Error: {sql_file} not found.")
        return

    print(f"Reading migration SQL from {sql_file.name}...")
    with open(sql_file, 'r', encoding='utf-8') as f:
        sql = f.read()

    print("Attempting to execute migration via RPC 'exec_sql'...")
    try:
        # Supabase RPC call
        res = client.rpc('exec_sql', {'sql_query': sql}).execute()
        print("Successfully applied migration Step 1.")
        print("1. Created 'staff_status_history' table.")
        print("2. Created 'v_funds_enriched' compatibility view.")
    except Exception as e:
        print(f"Failed to execute SQL via RPC: {e}")
        print("\n[MANUAL ACTION REQUIRED]")
        print("If RPC is not available, please copy the content of the .sql file")
        print("and run it directly in the Supabase SQL Editor.")

if __name__ == "__main__":
    run_migration()
