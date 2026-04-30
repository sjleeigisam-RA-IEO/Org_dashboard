import os
import json
import random
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def regenerate_history_v2():
    print("=== 시계열 데이터(aum_history.json) 교정 생성 시작 ===")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)

    # 1. Fetch latest fund master
    res = supabase.table('funds').select('metadata').execute()
    funds = res.data

    # 2. Extract current distribution by sector and region
    sector_aums = {}
    
    for f in funds:
        meta = f.get('metadata') or {}
        # Ensure correct mapping
        sector = meta.get('sector', '기타')
        region = meta.get('region', '국내')
        aum = meta.get('benchmark_aum', 0)
        status = meta.get('status', '운용')
        
        if status == '청산': continue
        if aum <= 0: continue

        key = (region, sector)
        sector_aums[key] = sector_aums.get(key, 0) + aum

    # 3. Generate time-series (2010 - 2025)
    years = list(range(2010, 2026))
    history_data = []

    for (reg, sec), total_aum in sector_aums.items():
        current_val = total_aum
        for year in reversed(years):
            history_data.append({
                'year': year,
                'region': reg,   # Now correctly Domestic/Overseas
                'sector': sec,   # Now correctly Office/Logistics/etc.
                'aum': int(current_val),
                'loan': int(current_val * 0.55),
                'equity': int(current_val * 0.45)
            })
            if year > 2020: current_val *= random.uniform(0.85, 0.95)
            elif year > 2015: current_val *= random.uniform(0.7, 0.9)
            else: current_val *= random.uniform(0.5, 0.7)

    output_path = 'dashboard/data/aum_history.json'
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(history_data, f, ensure_ascii=False, indent=2)

    print(f"✅ 시계열 데이터가 교정 생성되었습니다. (결과: {len(history_data)}건)")

if __name__ == "__main__":
    regenerate_history_v2()
