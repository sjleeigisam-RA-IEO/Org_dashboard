import requests
import time

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
VWORLD_KEY = "02B5F8FA-CC59-3109-86FD-0C9C1B98B5BF"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets"

headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}"
}

def search_vworld(query):
    url = "http://api.vworld.kr/req/search"
    params = {
        "service": "search", "request": "search", "type": "place",
        "query": query, "format": "json", "key": VWORLD_KEY
    }
    try:
        res = requests.get(url, params=params).json()
        if res['response']['status'] == 'OK' and res['response']['result']['items']:
            item = res['response']['result']['items'][0]
            return item['address']['road'] or item['address']['parcel']
    except: pass
    return None

def analyze_missing_addresses():
    # Fetch assets where address is empty or null
    # neq. is for empty string, is.null is for null
    r = requests.get(f"{BASE_URL}?select=asset_name,fund_id&or=(address.is.null,address.eq.)", headers=headers)
    assets = r.json()
    
    print(f"Analyzing {len(assets)} assets with missing addresses...")
    
    found_count = 0
    samples = []
    
    # Process a few to avoid hitting rate limits too hard and for speed in this demo
    # But I'll try to do more if needed. Let's do 50 samples or so.
    limit = 50 
    for i, a in enumerate(assets):
        name = a['asset_name']
        if not name or name == 'nan': continue
        
        addr = search_vworld(name)
        if addr:
            found_count += 1
            if len(samples) < 10:
                samples.append(f"- {name} -> {addr}")
        
        if i >= limit: break
        time.sleep(0.05) # Small throttle

    estimated_total = (found_count / (i + 1)) * len(assets)
    
    print(f"\nSearch Results (Sample of {i+1} processed):")
    for s in samples:
        print(s)
        
    print(f"\nFound in sample: {found_count} / {i+1}")
    print(f"Estimated total findable: ~{int(estimated_total)} / {len(assets)}")

analyze_missing_addresses()
