import requests
import sys

# Ensure UTF-8 output for console
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1"
headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def analyze_coverage_v2():
    # 1. Fetch Funds with metadata (containing AUM)
    print("Fetching funds and AUM data...")
    f_res = requests.get(f"{BASE_URL}/funds?select=fund_id,metadata", headers=headers).json()
    
    # 2. Fetch Assets with usage status
    print("Fetching asset classification status...")
    a_res = requests.get(f"{BASE_URL}/fund_assets?select=fund_id,asset_name,main_usage", headers=headers).json()

    # 3. Process AUM from metadata
    fund_aum_map = {}
    total_aum = 0
    for f in f_res:
        meta = f.get('metadata') or {}
        aum = meta.get('benchmark_aum', 0) or 0
        fund_aum_map[str(f['fund_id'])] = aum
        total_aum += aum

    # 4. Identify Matched and Dev assets
    matched_fund_ids = set()
    dev_fund_ids = set()
    dev_keywords = ['개발', 'PF', 'PFV', '브릿지', 'Bridge', '신축', '선매입']

    for a in a_res:
        fid = str(a['fund_id'])
        if a.get('main_usage'):
            matched_fund_ids.add(fid)
        elif any(k in str(a.get('asset_name','')) for k in dev_keywords):
            dev_fund_ids.add(fid)

    matched_aum = sum(fund_aum_map.get(fid, 0) for fid in matched_fund_ids)
    dev_aum = sum(fund_aum_map.get(fid, 0) for fid in dev_fund_ids if fid not in matched_fund_ids)

    print("\n" + "="*40)
    print("AUM Coverage Analysis Result")
    print("="*40)
    print(f"Total Portfolio AUM    : {total_aum/1e12:.2f} T KRW")
    print("-" * 40)
    print("Matched Real Assets (229 items)")
    print(f"   AUM Covered         : {matched_aum/1e12:.2f} T KRW")
    print(f"   Coverage Ratio      : {matched_aum/total_aum*100:.1f}%")
    print("-" * 40)
    print("Potential Dev Assets (48 items)")
    print(f"   AUM Target          : {dev_aum/1e12:.2f} T KRW")
    print(f"   Potential Gain      : {dev_aum/total_aum*100:.1f}%")
    print("-" * 40)
    print(f"FINAL EXPECTED COVERAGE: {(matched_aum + dev_aum)/total_aum*100:.1f}%")
    print("="*40)
    print(f"Total Assets: {len(a_res)} | Matched: 229 | Dev: 48")
    print(f"Total Funds : {len(f_res)} | Matched Funds: {len(matched_fund_ids)}")

if __name__ == "__main__":
    analyze_coverage_v2()
