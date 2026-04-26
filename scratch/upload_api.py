import os
import json
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def upload_api_data():
    print("=== 고품질 API 캐시 데이터 DB 주입 시작 ===")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    supabase = create_client(url, key)

    # 1. Load Caches
    with open('_archive/geocoding_cache.json', 'r', encoding='utf-8') as f:
        geo_cache = json.load(f)
    with open('_archive/building_cache.json', 'r', encoding='utf-8') as f:
        bld_cache = json.load(f)

    # 2. Fetch Assets
    assets = supabase.table('fund_assets').select('id, asset_name, address').execute().data
    
    updates = []
    matched_geo = 0
    matched_bld = 0

    for a in assets:
        aid = a['id']
        addr = str(a.get('address') or '').strip()
        
        update_data = {}
        
        # Match Geo
        if addr in geo_cache:
            g = geo_cache[addr]
            if len(g) >= 2:
                update_data['lat'] = g[0]
                update_data['lng'] = g[1]
                matched_geo += 1
                
        # Match Building
        if addr in bld_cache:
            b = bld_cache[addr]
            if isinstance(b, dict):
                update_data['main_usage'] = b.get('main_usage')
                update_data['structure'] = b.get('structure')
                update_data['site_area'] = b.get('site_area')
                update_data['far'] = b.get('far')
                update_data['scr'] = b.get('scr')
                matched_bld += 1

        if update_data:
            updates.append({"id": aid, "data": update_data})

    # 3. Bulk Update
    print(f"업데이트 대상 자산: {len(updates)}건 (위경도 {matched_geo}건, 대장 {matched_bld}건 매핑)")
    
    for i in range(0, len(updates), 50):
        chunk = updates[i:i+50]
        for item in chunk:
            supabase.table('fund_assets').update(item['data']).eq('id', item['id']).execute()
            
    print("✅ DB 주입이 완료되었습니다.")

if __name__ == "__main__":
    upload_api_data()
