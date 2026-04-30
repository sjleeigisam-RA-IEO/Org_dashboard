import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def final_master_encoding_fix():
    # 1. Load Master Fund List (The most comprehensive file)
    master_path = '_archive/펀드 관리_20260424.xlsx'
    df_master = pd.read_excel(master_path, header=0)
    
    name_map = {} # fund_id -> {full_name, short_name}
    
    for _, row in df_master.iterrows():
        fid = str(row.iloc[0]).strip()
        if not fid or fid == 'nan': continue
        
        # Col 0: ID, Col 1: ShortName, Col 2: FullName (Usually)
        short_name = str(row.iloc[1]).strip()
        full_name = str(row.iloc[2]).strip() if len(row) > 2 else short_name
        
        name_map[fid] = {"full": full_name, "short": short_name}

    # 2. Update DB
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    db_funds = supabase.table('funds').select('fund_id, fund_name').execute().data
    
    updates = []
    for f in db_funds:
        fid = f['fund_id']
        # If name contains '?' or '', it's likely garbled
        if fid in name_map:
            m = name_map[fid]
            updates.append({
                "fund_id": fid,
                "fund_name": m['full'],
                "short_name": m['short']
            })

    # 3. Execute Updates
    count = 0
    for i in range(0, len(updates), 50):
        chunk = updates[i:i+50]
        for item in chunk:
            supabase.table('funds').update({
                "fund_name": item['fund_name'],
                "short_name": item['short_name']
            }).eq('fund_id', item['fund_id']).execute()
            count += 1
            
    print(f"Final Sweep: Recovered {count} additional fund names from Master List.")

if __name__ == "__main__":
    final_master_encoding_fix()
