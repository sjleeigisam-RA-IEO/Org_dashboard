import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv
import numpy as np

load_dotenv()

def safe_int(val):
    try:
        if pd.isna(val): return 0
        return int(float(val))
    except:
        return 0

def sync_data():
    # 1. Load Excel
    excel_path = '_archive/펀드 AUM 관리_20260112.xlsx'
    df_excel = pd.read_excel(excel_path, header=0)
    
    # 2. Prepare Data for Upsert
    # Skip row 0 (sub-header)
    df_data = df_excel.iloc[1:].copy()
    
    # Supabase Client
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    # Get existing funds
    existing_funds_res = supabase.table('funds').select('fund_id, metadata').execute()
    existing_map = {f['fund_id']: f['metadata'] for f in existing_funds_res.data}
    
    upsert_data = []
    new_count = 0
    update_count = 0
    
    for _, row in df_data.iterrows():
        f_id = str(row.iloc[0]).strip()
        if not f_id or f_id == 'nan' or '합계' in f_id: continue
        
        short_name = str(row.iloc[1]).strip()
        
        # [13] Equity, [17] Debt, [16] AUM
        equity = row.iloc[13]
        debt = row.iloc[17]
        aum = row.iloc[16]
        
        eq_val = safe_int(equity)
        debt_val = safe_int(debt)
        aum_val = safe_int(aum)
        
        # Calculate lease deposit as remainder if aum_val exists, otherwise 0
        deposit_val = aum_val - eq_val - debt_val
        if deposit_val < 0: deposit_val = 0 # 산식 보정
        
        # Merge with existing metadata
        meta = existing_map.get(f_id, {})
        if not isinstance(meta, dict): meta = {}
        
        meta['committed_equity'] = eq_val
        meta['committed_debt'] = debt_val
        meta['lease_deposit'] = deposit_val
        meta['benchmark_aum'] = aum_val if aum_val > 0 else (eq_val + debt_val + deposit_val)
        
        item = {
            "fund_id": f_id,
            "short_name": short_name,
            "metadata": meta
        }
        
        upsert_data.append(item)
        if f_id in existing_map: update_count += 1
        else: new_count += 1

    # 3. Execution
    print(f"Total to sync: {len(upsert_data)} (New: {new_count}, Update: {update_count})")
    
    # Chunked upsert
    chunk_size = 50
    for i in range(0, len(upsert_data), chunk_size):
        chunk = upsert_data[i:i + chunk_size]
        try:
            supabase.table('funds').upsert(chunk, on_conflict='fund_id').execute()
        except Exception as e:
            print(f"Error in chunk {i}: {e}")
        
    print("--- Sync Finished! ---")

if __name__ == "__main__":
    sync_data()
