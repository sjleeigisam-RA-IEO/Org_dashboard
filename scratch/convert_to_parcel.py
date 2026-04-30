import requests
import time
import pandas as pd

# Credentials
KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
VWORLD_KEY = "02B5F8FA-CC59-3109-86FD-0C9C1B98B5BF"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets"

headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json"
}

def get_parcel_and_coords(query_address):
    """V-World Search API를 사용하여 지번 주소와 좌표를 가져옵니다."""
    if not query_address or str(query_address) == 'nan': return None, None, None
    
    # 해외 주소 키워드 체크 (매우 단순한 필터링)
    intl_keywords = ['USA', 'UK', 'Germany', 'Czech', '네덜란드', 'Paris', 'London', 'Germany', 'France']
    if any(k.lower() in query_address.lower() for k in intl_keywords):
        return None, None, None

    url = "http://api.vworld.kr/req/search"
    # 도로명/지번 모두 검색하기 위해 category를 유동적으로 하거나 place 타입 시도 가능하나 
    # 여기서는 address 타입으로 지번(parcel)을 우선 요청
    params = {
        "service": "search", "request": "search", "type": "address",
        "category": "parcel", "query": query_address, "format": "json", "key": VWORLD_KEY
    }
    
    try:
        res = requests.get(url, params=params).json()
        # 지번 검색 실패시 도로명으로 재시도하여 결과물에서 지번 추출
        if res['response']['status'] != 'OK':
            params['category'] = 'road'
            res = requests.get(url, params=params).json()

        if res['response']['status'] == 'OK' and res['response']['result']['items']:
            item = res['response']['result']['items'][0]
            parcel_addr = item['address']['parcel']
            coords = item['point']
            return parcel_addr, float(coords['y']), float(coords['x'])
    except Exception as e:
        print(f"Error geocoding {query_address}: {e}")
    
    return None, None, None

def run_conversion():
    # 1. Fetch all assets with addresses
    print("Fetching assets from DB...")
    r = requests.get(f"{BASE_URL}?select=fund_id,asset_name,address&address=not.is.null", headers=headers)
    assets = r.json()
    print(f"Found {len(assets)} assets with addresses.")

    success_count = 0
    # 2. Process each
    for i, a in enumerate(assets):
        fid = a['fund_id']
        name = a['asset_name']
        addr = a['address']
        
        parcel, lat, lng = get_parcel_and_coords(addr)
        
        if parcel:
            # Update DB
            params = {"fund_id": f"eq.{fid}", "asset_name": f"eq.{name}"}
            payload = {"address": parcel, "lat": lat, "lng": lng}
            res = requests.patch(BASE_URL, params=params, json=payload, headers=headers)
            
            if res.status_code in [200, 204]:
                print(f"[{i+1}/{len(assets)}] Converted: {name} -> {parcel}")
                success_count += 1
            else:
                print(f"[{i+1}/{len(assets)}] DB Update Failed for {name}")
        else:
            # Skip or just log
            pass
        
        # Small throttle to respect API limits
        if i % 10 == 0: time.sleep(0.1)

    print(f"\nConversion Finished. Successfully updated {success_count} assets.")

if __name__ == "__main__":
    run_conversion()
