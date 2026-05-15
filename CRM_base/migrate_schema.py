import os
import sys
from supabase import create_client
from dotenv import load_dotenv

# Add CRM_base to path for env_utils
sys.path.append(r'd:\Project\00. 2025 RA 기획추진\RA dashboard\CRM_base')
from env_utils import get_required_supabase_config

def migrate():
    url, key = get_required_supabase_config()
    client = create_client(url, key)

    print("Checking for required columns in 'funds' table...")
    # List of new standard columns
    new_cols = [
        ('vehicle_type', 'VARCHAR'),
        ('recruitment_type', 'VARCHAR'),
        ('parent_child_type', 'VARCHAR'),
        ('legal_form', 'VARCHAR'),
        ('fund_class', 'VARCHAR'),
        ('investment_strategy', 'VARCHAR'),
        ('division', 'VARCHAR'),
        ('department', 'VARCHAR'),
        ('manager_name', 'VARCHAR'),
        ('is_development', 'VARCHAR'),
        ('is_delegated', 'VARCHAR'),
        ('primary_region', 'VARCHAR')
    ]

    # Try to add columns via RPC if available, or just log if not
    # Since we don't have a reliable DDL RPC, we'll focus on the 'ingestion script'
    # to handle the mapping to EXISTING columns (like 'notion_...')
    # and use the 'metadata' as a fallback.
    
    # However, I want to see if I can add them.
    # If the user has access to the SQL editor, they should run this:
    sql = "\n".join([f"ALTER TABLE funds ADD COLUMN IF NOT EXISTS {name} {dtype};" for name, dtype in new_cols])
    
    print("MIGRATION INSTRUCTIONS (Please run in Supabase SQL Editor if script fails):")
    print(sql)

    try:
        # Check if RPC exists
        print("Attempting to run migration via RPC 'exec_sql'...")
        client.rpc('exec_sql', {'sql_query': sql}).execute()
        print("Success: Columns added via RPC.")
    except Exception as e:
        print(f"Notice: Could not run DDL via RPC ({e}).")
        print("We will proceed by mapping data to existing columns and metadata.")

    # Data Migration: Sync from metadata to existing/new columns
    print("Syncing data from metadata to columns for existing records...")
    # We'll fetch records that have metadata and update their top-level columns
    # To keep it simple, we'll do it in batches
    page_size = 500
    start = 0
    while True:
        res = client.table('funds').select('fund_id, metadata').range(start, start + page_size - 1).execute()
        rows = res.data or []
        if not rows: break
        
        updates = []
        for row in rows:
            meta = row.get('metadata')
            if not meta: continue
            
            # Mapping logic
            fid = row['fund_id']
            upd = {
                'fund_id': fid,
                'aum_status': meta.get('aum_status') or meta.get('status'),
                'setup_date': meta.get('setup_date'),
                # Add more mappings as we discover them
            }
            # Also sync to 'notion_' columns for backward compatibility if they exist
            if 'investment_strategy' in meta: upd['notion_investment_strategy_class'] = meta['investment_strategy']
            if 'vehicle_type' in meta: upd['notion_vehicle_class'] = meta['vehicle_type']
            if 'parent_child_type' in meta: upd['notion_holding_type_class'] = meta['parent_child_type']
            
            updates.append(upd)
        
        if updates:
            client.table('funds').upsert(updates, on_conflict='fund_id').execute()
            print(f"Synced {len(updates)} records...")
        
        if len(rows) < page_size: break
        start += page_size

if __name__ == "__main__":
    migrate()
