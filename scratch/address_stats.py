import requests

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets"

headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Prefer": "count=exact"
}

def get_stats():
    # Total count
    r_total = requests.get(f"{BASE_URL}?select=id", headers=headers)
    total = int(r_total.headers.get('Content-Range', '0/0').split('/')[-1])
    
    # Filled address
    # Not null and not empty string
    r_filled = requests.get(f"{BASE_URL}?address=neq.&address=not.is.null&select=id", headers=headers)
    filled = int(r_filled.headers.get('Content-Range', '0/0').split('/')[-1])
    
    empty = total - filled
    
    print(f"Total Assets: {total}")
    print(f"Filled Address: {filled}")
    print(f"Empty/Null Address: {empty}")

get_stats()
