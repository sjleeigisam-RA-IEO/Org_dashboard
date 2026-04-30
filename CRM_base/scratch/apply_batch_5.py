import requests
import pandas as pd

# Supabase Credentials
KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets"
headers = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json"
}

updates = [
    {"fund_id": "112451", "asset_name": "부천소사PFV(P00008)", "address": "경기도 부천시 소사본동 134 일원"},
    {"fund_id": "112470", "asset_name": "이지스 353호 (OPUS 459/舊백암빌딩)", "address": "서울특별시 강남구 강남대로 502"},
    {"fund_id": "112502", "asset_name": "뉴멕시코주 아마존 물류센터", "address": "12945 Ladera Dr NW, Albuquerque, NM 87120, USA"},
    {"fund_id": "112503", "asset_name": "뉴멕시코주 아마존 물류센터", "address": "12945 Ladera Dr NW, Albuquerque, NM 87120, USA"}
]

def apply_batch_5():
    for up in updates:
        params = {"fund_id": f"eq.{up['fund_id']}", "asset_name": f"eq.{up['asset_name']}"}
        res = requests.patch(BASE_URL, params=params, json={"address": up['address']}, headers=headers)
        if res.status_code in [200, 204]:
            print(f"Updated DB: {up['asset_name']}")
        else:
            print(f"Failed DB Update: {up['asset_name']} ({res.status_code})")

    # Update Excel
    excel_path = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\[new]주소_보완_대상_리스트.xlsx"
    df = pd.read_excel(excel_path)
    
    for up in updates:
        mask = (df['펀드코드'].astype(str) == up['fund_id']) & (df['자산명'].astype(str) == up['asset_name'])
        if mask.any():
            df.loc[mask, '주소(보완용)'] = up['address']
            print(f"Updated Excel: {up['asset_name']}")
            
    df.to_excel(excel_path, index=False)

apply_batch_5()
