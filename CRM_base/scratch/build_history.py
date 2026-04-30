import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def build_long_time_series():
    file_path = '_archive/펀드 AUM 관리_20251224_all.xlsx'
    df = pd.read_excel(file_path, header=0)
    
    # Define mapping
    # Col 0: ID, Col 3: Sector, Col 31: Region, Col 7: SetDate, Col 8: CancelDate, Col 16: AUM
    
    records = []
    for _, row in df.iloc[1:].iterrows():
        fid = str(row.iloc[0]).strip()
        if not fid or fid == 'nan' or '합계' in fid: continue
        
        # Mapping Sector (Heuristic based on keywords)
        raw_sector = str(row.iloc[3])
        sector = "기타"
        if "오피스" in raw_sector or "ǽ" in raw_sector: sector = "오피스"
        elif "물류" in raw_sector or "" in raw_sector: sector = "물류"
        elif "리테일" in raw_sector: sector = "리테일"
        elif "호텔" in raw_sector or "ȣ" in raw_sector: sector = "호텔"
        elif "인프라" in raw_sector: sector = "인프라"
        
        # Mapping Region
        raw_region = str(row.iloc[31])
        region = "국내"
        if "해외" in raw_region or "ؿ" in raw_region: region = "해외"
        
        set_date = pd.to_datetime(row.iloc[7], errors='coerce')
        cancel_date = pd.to_datetime(row.iloc[8], errors='coerce')
        aum = pd.to_numeric(row.iloc[16], errors='coerce') or 0
        
        records.append({
            "id": fid,
            "region": region,
            "sector": sector,
            "set_date": set_date,
            "cancel_date": cancel_date,
            "aum": aum
        })

    df_master = pd.DataFrame(records)
    
    # 2. Generate Yearly Snapshots (2010 - 2025)
    history_data = []
    for year in range(2010, 2026):
        snapshot_date = pd.Timestamp(year=year, month=12, day=31)
        
        active = df_master[
            (df_master['set_date'] <= snapshot_date) & 
            ((df_master['cancel_date'].isna()) | (df_master['cancel_date'] > snapshot_date))
        ]
        
        # Group by Region and Sector
        grouped = active.groupby(['region', 'sector']).agg({'aum': 'sum', 'id': 'count'}).reset_index()
        
        for _, g in grouped.iterrows():
            history_data.append({
                "year": year,
                "region": g['region'],
                "sector": g['sector'],
                "aum": int(g['aum']),
                "fund_count": int(g['id'])
            })

    # 3. Save to Supabase (Table: aum_history)
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    # (Optional) Create table via SQL if it doesn't exist, but here we assume we can insert
    # To be safe, we'll upsert or insert. Let's try upsert.
    if history_data:
        # Clear old history to avoid duplicates
        # supabase.table('aum_history').delete().neq('year', 0).execute()
        
        # Insert in chunks
        for i in range(0, len(history_data), 100):
            chunk = history_data[i:i+100]
            supabase.table('aum_history').upsert(chunk).execute()
            
    print(f"Successfully populated 'aum_history' with {len(history_data)} snapshot records.")

if __name__ == "__main__":
    build_long_time_series()
