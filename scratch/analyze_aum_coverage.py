import requests

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1"
headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def analyze_coverage():
    # 1. Fetch Funds
    print("Fetching funds...")
    f_res = requests.get(f"{BASE_URL}/funds?select=fund_id,committed_amt", headers=headers).json()
    if isinstance(f_res, dict) and f_res.get('code'):
        print(f"Funds Fetch Error: {f_res}")
        return

    # 2. Fetch Assets
    print("Fetching assets...")
    a_res = requests.get(f"{BASE_URL}/fund_assets?select=fund_id,main_usage", headers=headers).json()
    if isinstance(a_res, dict) and a_res.get('code'):
        print(f"Assets Fetch Error: {a_res}")
        return

    # 3. Calculate
    total_aum = sum(f.get('committed_amt', 0) or 0 for f in f_res)
    
    # Funds linked to matched assets
    matched_fund_ids = set(str(a['fund_id']) for a in a_res if a.get('main_usage'))
    matched_aum = sum(f.get('committed_amt', 0) or 0 for f in f_res if str(f['fund_id']) in matched_fund_ids)
    
    # Potential Dev assets coverage (if they were matched)
    dev_keywords = ['개발', 'PF', 'PFV', '브릿지', 'Bridge', '신축', '선매입']
    dev_fund_ids = set(str(a['fund_id']) for a in a_res if not a.get('main_usage') and any(k in str(a.get('asset_name','')) for k in dev_keywords))
    dev_aum = sum(f.get('committed_amt', 0) or 0 for f in f_res if str(f['fund_id']) in dev_fund_ids)

    print("-" * 30)
    print(f"Total Portfolio AUM: {total_aum/1e12:.2f} T KRW")
    print(f"Matched Assets AUM: {matched_aum/1e12:.2f} T KRW")
    print(f"Coverage Ratio: {matched_aum/total_aum*100:.1f}%")
    print("-" * 30)
    print(f"Potential Dev Assets AUM: {dev_aum/1e12:.2f} T KRW")
    print(f"Future Coverage (Matched + Dev): {(matched_aum + dev_aum)/total_aum*100:.1f}%")
    print("-" * 30)
    print(f"Matched Funds: {len(matched_fund_ids)}")
    print(f"Total Funds: {len(f_res)}")

if __name__ == "__main__":
    analyze_coverage()
