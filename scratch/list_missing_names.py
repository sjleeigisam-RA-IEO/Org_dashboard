import requests

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets"

headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}"
}

def list_missing():
    r = requests.get(f"{BASE_URL}?select=asset_name&or=(address.is.null,address.eq.)&limit=30", headers=headers)
    assets = r.json()
    print("Sample of Asset Names with missing addresses:")
    for a in assets:
        print(f"- {a['asset_name']}")

list_missing()
