import pandas as pd
import requests
import os

KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets"
headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def create_recovery_list():
    # 1. Fetch remaining missing from DB
    r = requests.get(f"{BASE_URL}?select=fund_id,asset_name&or=(address.is.null,address.eq.)", headers=headers)
    missing_assets = r.json()
    
    print(f"Items remaining without address: {len(missing_assets)}")
    
    if not missing_assets:
        print("No missing addresses found.")
        return

    # 2. Prepare Data
    data = []
    for a in missing_assets:
        data.append({
            '펀드코드': a['fund_id'],
            '자산명': a['asset_name'],
            '주소(보완용)': '' # Empty column for user to fill
        })
    
    df = pd.DataFrame(data)
    
    # 3. Save to Excel
    output_path = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\[new]주소_보완_대상_리스트.xlsx"
    df.to_excel(output_path, index=False)
    print(f"Created file: {output_path}")

create_recovery_list()
