import requests

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets"
headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

updates = [
    {"fund_id": "112093", "asset_name": "Paris Office Louis David", "address": "Pernerova 149/35, 186 00 Karlín, Czech"},
    {"fund_id": "112347", "asset_name": "Townsend Europe Logistics Venture II Korea Feeder", "address": "네덜란드"},
    {"fund_id": "112496", "asset_name": "Lakeville Amazon Warehouse", "address": "25 Strategy Drive, Fredericksburg, Stafford, VA"},
    {"fund_id": "112496", "asset_name": "Kansas city Amazon Warehouse", "address": "25 Strategy Drive, Fredericksburg, Stafford, VA"},
    {"fund_id": "112497", "asset_name": "Lakeville Amazon Warehouse", "address": "25 Strategy Drive, Fredericksburg, Stafford, VA"},
    {"fund_id": "112497", "asset_name": "Kansas city Amazon Warehouse", "address": "25 Strategy Drive, Fredericksburg, Stafford, VA"},
    {"fund_id": "R00006", "asset_name": "북미DC포트폴리오", "address": "분당구 장미로 36"}
]

def apply_updates():
    success_count = 0
    for up in updates:
        # Patch requires filtering
        params = {
            "fund_id": f"eq.{up['fund_id']}",
            "asset_name": f"eq.{up['asset_name']}"
        }
        res = requests.patch(BASE_URL, params=params, json={"address": up['address']}, headers=headers)
        if res.status_code in [200, 201, 204]:
            print(f"Updated: {up['fund_id']} | {up['asset_name']}")
            success_count += 1
        else:
            print(f"Failed to update {up['fund_id']}: {res.status_code} {res.text}")
    
    print(f"\nSuccessfully updated {success_count} records.")

apply_updates()
