import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def safe_int(val):
    try:
        if pd.isna(val): return 0
        return int(float(val))
    except: return 0

def purge_and_sync():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)

    # 1. Load Excel (Benchmark Source)
    excel_path = '_archive/펀드 AUM 관리_20260112.xlsx'
    df_excel = pd.read_excel(excel_path, header=0)
    df_data = df_excel.iloc[1:].copy()
    
    excel_map = {}
    for _, row in df_data.iterrows():
        f_id = str(row.iloc[0]).strip()
        if not f_id or f_id == 'nan' or '합계' in f_id: continue
        
        eq = safe_int(row.iloc[13])
        dt = safe_int(row.iloc[17])
        aum = safe_int(row.iloc[16])
        dep = aum - eq - dt
        if dep < 0: dep = 0
        
        excel_map[f_id] = {
            "committed_equity": eq,
            "committed_debt": dt,
            "lease_deposit": dep,
            "benchmark_aum": aum if aum > 0 else (eq + dt + dep)
        }

    # 2. Identify Safe IDs from ALL related tables
    lenders_res = supabase.table('lender_exposures').select('fund_id').execute()
    bens_res = supabase.table('beneficiary_exposures').select('fund_id').execute()
    assets_res = supabase.table('fund_assets').select('fund_id').execute()
    
    safe_ids = set()
    safe_ids.update([str(l['fund_id']).strip() for l in lenders_res.data])
    safe_ids.update([str(b['fund_id']).strip() for b in bens_res.data])
    safe_ids.update([str(a['fund_id']).strip() for a in assets_res.data])
    safe_ids.update(excel_map.keys())
    
    print(f"Total Safe Funds to Keep: {len(safe_ids)}")

    # 3. Purge truly orphaned funds
    funds_res = supabase.table('funds').select('fund_id').execute()
    db_ids = set([str(f['fund_id']).strip() for f in funds_res.data])
    
    orphan_ids = db_ids - safe_ids
    print(f"Orphaned Funds to Delete: {len(orphan_ids)}")
    
    if len(orphan_ids) > 0:
        orphan_list = list(orphan_ids)
        for i in range(0, len(orphan_list), 50):
            chunk = orphan_list[i:i+50]
            try:
                supabase.table('funds').delete().in_('fund_id', chunk).execute()
            except Exception as e:
                print(f"Error deleting chunk at {i}: {e}")
        print(f"Purge process completed.")

    # 4. Sync AUM metadata
    excel_ids = list(excel_map.keys())
    update_data = []
    # Fetch in chunks to avoid large query limits
    for i in range(0, len(excel_ids), 100):
        chunk_ids = excel_ids[i:i+100]
        funds_to_sync = supabase.table('funds').select('fund_id, metadata').in_('fund_id', chunk_ids).execute()
        
        for f in funds_to_sync.data:
            f_id = f['fund_id']
            meta = f['metadata'] or {}
            if not isinstance(meta, dict): meta = {}
            
            meta.update(excel_map.get(f_id, {}))
            update_data.append({"fund_id": f_id, "metadata": meta})

    if update_data:
        for i in range(0, len(update_data), 50):
            chunk = update_data[i:i+50]
            supabase.table('funds').upsert(chunk).execute()
        print(f"Successfully synced AUM for {len(update_data)} funds.")

    print("\n--- Refined Cleanup & Sync Finished! ---")

if __name__ == "__main__":
    purge_and_sync()
