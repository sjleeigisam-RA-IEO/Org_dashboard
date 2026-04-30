import requests
import sys

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1"
headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def check_funds(fund_nos):
    for no in fund_nos:
        query = f"ilike.*{no}호*"
        r = requests.get(f"{BASE_URL}/funds?fund_name={query}", headers=headers)
        funds = r.json()
        
        print(f"\n{'='*20} [펀드 {no}호 정보] {'='*20}")
        if not funds:
            print(f"{no}호 펀드를 찾을 수 없습니다.")
            continue

        for f in funds:
            fid = f['fund_id']
            meta = f.get('metadata') or {}
            aum = meta.get('benchmark_aum', 0) or 0
            print(f"▶ {f['fund_name']} ({fid})")
            print(f"   - 상태: {f.get('status')} | 설정일: {f.get('setup_date')} | 만기일: {f.get('maturity_date')}")
            print(f"   - AUM: {aum/1e8:,.0f} 억 원 | 섹터: {meta.get('investment_sector')}")
            
            # Linked Assets
            r_assets = requests.get(f"{BASE_URL}/fund_assets?fund_id=eq.{fid}", headers=headers)
            assets = r_assets.json()
            if assets:
                print("   - 연결 기초자산:")
                for a in assets:
                    print(f"     * {a['asset_name']} [용도: {a.get('main_usage') or '미분류'}]")
                    if a.get('address'): print(f"       주소: {a.get('address')}")
            else:
                print("   - 연결된 기초자산 정보가 없습니다.")
            print("-" * 50)

if __name__ == "__main__":
    check_funds(['468', '463', '542', '572'])
