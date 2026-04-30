import os
import json
import random
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def regenerate_history():
    print("=== 시계열 데이터(aum_history.json) 재생성 시작 ===")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)

    # 1. Fetch latest fund master
    res = supabase.table('funds').select('metadata').execute()
    funds = res.data

    # 2. Extract current distribution by sector and region
    sector_aums = {}
    region_aums = {}
    
    all_sectors = set()
    all_regions = set()

    for f in funds:
        meta = f.get('metadata') or {}
        sector = meta.get('sector', '기타')
        region = meta.get('region', '국내')
        aum = meta.get('benchmark_aum', 0)
        
        all_sectors.add(sector)
        all_regions.add(region)
        
        # Sector grouping
        key_s = (region, sector)
        sector_aums[key_s] = sector_aums.get(key_s, 0) + aum

    # 3. Generate time-series (2010 - 2025)
    # We will simulate growth back from current AUM
    years = list(range(2010, 2026))
    history_data = []

    for (reg, sec), total_aum in sector_aums.items():
        if total_aum <= 0: continue
        
        # Simple growth simulation: current AUM is the 2025 value
        # Distribute backwards with some random growth factors
        current_val = total_aum
        for year in reversed(years):
            history_data.append({
                'year': year,
                'region': reg,
                'sector': sec,
                'aum': int(current_val),
                'loan': int(current_val * 0.6), # Simulated 60% LTV
                'equity': int(current_val * 0.4)
            })
            # Growth factor (AUM was smaller in the past)
            if year > 2018:
                current_val *= random.uniform(0.7, 0.9)
            elif year > 2014:
                current_val *= random.uniform(0.6, 0.8)
            else:
                current_val *= random.uniform(0.4, 0.6)

    # 4. Save to JSON
    output_path = 'dashboard/data/aum_history.json'
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(history_data, f, ensure_ascii=False, indent=2)

    print(f"✅ {len(history_data)}건의 시계열 데이터가 생성되었습니다. (섹터: {all_sectors})")

if __name__ == "__main__":
    regenerate_history()
