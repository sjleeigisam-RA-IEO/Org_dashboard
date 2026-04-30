import requests
import json
import sys

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1"
headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def check_fund_472():
    # 1. Search for the fund
    r = requests.get(f"{BASE_URL}/funds?fund_name=ilike.*472호*", headers=headers)
    funds = r.json()
    
    if not funds:
        print("Fund 472 not found.")
        return

    for f in funds:
        fid = f['fund_id']
        print(f"--- Fund Info: {f['fund_name']} ({fid}) ---")
        print(f"Status: {f.get('status')}")
        print(f"Setup Date: {f.get('setup_date')}")
        print(f"Maturity: {f.get('maturity_date')}")
        
        meta = f.get('metadata') or {}
        aum = meta.get('benchmark_aum', 0) or 0
        print(f"AUM (Committed): {aum/1e8:,.0f} 억 원")
        print(f"Sector (Original): {meta.get('investment_sector')}")
        print(f"Division: {meta.get('division')} / {meta.get('department')}")
        
        # 2. Search for linked assets
        r_assets = requests.get(f"{BASE_URL}/fund_assets?fund_id=eq.{fid}", headers=headers)
        assets = r_assets.json()
        
        print("\nLinked Assets:")
        if not assets:
            print("  No linked assets found in fund_assets table.")
        for a in assets:
            print(f"  - Asset Name: {a['asset_name']}")
            print(f"    Usage: {a.get('main_usage')}")
            print(f"    Address: {a.get('address')}")
            print(f"    GFA: {a.get('gfa')} sqm")
        print("-" * 40)

if __name__ == "__main__":
    check_fund_472()
