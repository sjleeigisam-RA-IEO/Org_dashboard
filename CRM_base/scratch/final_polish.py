import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def final_polish():
    # 1. Load CSV
    df_csv = pd.read_csv('_archive/Project & Mission_all.csv', encoding='utf-8-sig')
    csv_records = []
    for _, row in df_csv.iterrows():
        name = str(row['Project & Mission 이름']).strip()
        asset_name = str(row.get('자산명', '')).strip()
        v_short = str(row.get('Vehicle(약칭)', '')).strip()
        
        # Clean Sector
        raw_sector = str(row.get('투자자산유형', '미분류'))
        sector = "기타"
        if "오피스" in raw_sector: sector = "오피스"
        elif "물류" in raw_sector: sector = "물류"
        elif "리테일" in raw_sector: sector = "리테일"
        elif "호텔" in raw_sector: sector = "호텔"
        elif "인프라" in raw_sector: sector = "인프라"
        elif "주거" in raw_sector or "공동주택" in raw_sector: sector = "주거"
        elif "대출" in raw_sector: sector = "대출채권"

        csv_records.append({
            "name": name,
            "asset_name": asset_name,
            "v_short": v_short,
            "region": "해외" if "해외" in str(row.get('국내/해외(자산)', '')) else "국내",
            "status": "청산" if "설정 전" in str(row.get('진행 현황', '')) else "운용", # Simplified
            "sector": sector
        })

    # 2. Load DB Funds
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    db_funds = supabase.table('funds').select('fund_id, fund_name, short_name, metadata').execute().data

    updates = []
    for f in db_funds:
        fid = f['fund_id']
        fname = str(f['fund_name']).strip()
        sname = str(f['short_name']).strip()
        
        match = None
        # Priority 1: Exact Short Name
        for r in csv_records:
            if sname == r['v_short'] and sname != 'nan':
                match = r
                break
        
        # Priority 2: Fuzzy Name Match (Simple keyword match)
        if not match:
            for r in csv_records:
                if fname in r['name'] or r['name'] in fname or (len(sname) > 3 and sname in r['name']):
                    match = r
                    break
        
        if match:
            meta = f['metadata'] or {}
            meta.update({
                "region": match['region'],
                "status": match['status'],
                "sector": match['sector']
            })
            updates.append({
                "fund_id": fid,
                "fund_name": match['name'] if len(match['name']) > 5 else fname,
                "metadata": meta
            })

    # 3. Apply updates
    for i in range(0, len(updates), 50):
        chunk = updates[i:i+50]
        for item in chunk:
            supabase.table('funds').update({
                "fund_name": item['fund_name'],
                "metadata": item['metadata']
            }).eq('fund_id', item['fund_id']).execute()

    print(f"Final Polish: Matched and Updated {len(updates)} funds.")

if __name__ == "__main__":
    final_polish()
