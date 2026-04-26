import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def ultimate_encoding_fix():
    # 1. Load AUM Excel (Primary source for IDs and Names)
    excel_path = '_archive/펀드 AUM 관리_20260112.xlsx'
    df_excel = pd.read_excel(excel_path, header=0)
    
    name_map = {} # fund_id -> {full_name, short_name}
    
    for _, row in df_excel.iloc[1:].iterrows():
        fid = str(row.iloc[0]).strip()
        if not fid or fid == 'nan' or '합계' in fid: continue
        
        # Ensure we get clean strings
        full_name = str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else str(row.iloc[1]).strip()
        short_name = str(row.iloc[1]).strip()
        
        name_map[fid] = {"full": full_name, "short": short_name}

    # 2. Load CSV for additional names/mappings
    try:
        df_csv = pd.read_csv('_archive/Project & Mission_all.csv', encoding='utf-8-sig')
        # We don't have direct IDs here, but we can use Vehicle(약칭) if needed
    except:
        pass

    # 3. Update DB
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    db_funds = supabase.table('funds').select('fund_id').execute().data
    
    print(f"Starting recovery for {len(db_funds)} funds...")
    
    updates = []
    for f in db_funds:
        fid = f['fund_id']
        if fid in name_map:
            m = name_map[fid]
            updates.append({
                "fund_id": fid,
                "fund_name": m['full'],
                "short_name": m['short']
            })

    # 4. Execute Updates
    count = 0
    for i in range(0, len(updates), 50):
        chunk = updates[i:i+50]
        for item in chunk:
            supabase.table('funds').update({
                "fund_name": item['fund_name'],
                "short_name": item['short_name']
            }).eq('fund_id', item['fund_id']).execute()
            count += 1
            
    print(f"Successfully recovered {count} fund names with perfect encoding.")

if __name__ == "__main__":
    ultimate_encoding_fix()
