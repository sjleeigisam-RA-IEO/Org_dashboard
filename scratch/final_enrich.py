import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def final_cleanup_and_enrich():
    # 1. Load Master CSV
    csv_path = '_archive/Project & Mission_all.csv'
    df_csv = pd.read_csv(csv_path, encoding='utf-8-sig')
    
    # 2. Load DB Funds
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)
    
    db_funds = supabase.table('funds').select('fund_id, short_name, metadata').execute().data
    
    # 3. Create Mapping Map
    csv_map = {}
    for _, row in df_csv.iterrows():
        key = str(row['Vehicle(약칭)']).strip()
        if not key or key == 'nan': continue
        
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

        # Clean Region
        raw_region = str(row.get('국내/해외(자산)', '국내'))
        region = "해외" if "해외" in raw_region else "국내"
        
        # Clean Status
        raw_status = str(row.get('진행 현황', '설정 후'))
        status = "청산" if "청산" in raw_status or "해지" in raw_status else "운용"
        
        csv_map[key] = {
            "region": region,
            "status": status,
            "sector": sector,
            "clean_name": str(row['Project & Mission 이름']).strip()
        }

    # 4. Update DB
    updates = []
    matched_count = 0
    for f in db_funds:
        sname = str(f['short_name']).strip()
        if sname in csv_map:
            matched_count += 1
            m = csv_map[sname]
            meta = f['metadata'] or {}
            meta.update({
                "region": m['region'],
                "status": m['status'],
                "sector": m['sector']
            })
            
            updates.append({
                "fund_id": f['fund_id'],
                "short_name": sname, # Ensure clean sname
                "fund_name": m['clean_name'], # Fix encoding/name from CSV
                "metadata": meta
            })

    # 5. Bulk Update
    if updates:
        for i in range(0, len(updates), 50):
            chunk = updates[i:i+50]
            for item in chunk:
                supabase.table('funds').update({
                    "fund_name": item['fund_name'],
                    "metadata": item['metadata']
                }).eq('fund_id', item['fund_id']).execute()
                
    print(f"Matched and Enriched {matched_count} funds out of {len(db_funds)} total funds in DB.")

if __name__ == "__main__":
    final_cleanup_and_enrich()
