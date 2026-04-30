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
    {"fund_id": "190001", "asset_name": "은평 시니어리빙 복합시설 개발", "address": "서울특별시 은평구 진관동 208-8"},
    {"fund_id": "112614", "asset_name": "와이디427피에프브이 주식회사", "address": "서울특별시 중구 소월로 50"},
    {"fund_id": "112641", "asset_name": "세운5구역PFV(주) 지분", "address": "서울 중구 산림동 190-3"},
    {"fund_id": "112661", "asset_name": "세운5구역PFV(주) 지분", "address": "서울 중구 산림동 190-3"}
]

def apply_online_updates():
    for up in updates:
        params = {"fund_id": f"eq.{up['fund_id']}", "asset_name": f"eq.{up['asset_name']}"}
        res = requests.patch(BASE_URL, params=params, json={"address": up['address']}, headers=headers)
        if res.status_code in [200, 204]:
            print(f"Updated DB: {up['asset_name']}")
        else:
            print(f"Failed DB Update: {up['asset_name']} ({res.status_code})")

    # Update the Excel file too
    excel_path = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\[new]주소_보완_대상_리스트.xlsx"
    df = pd.read_excel(excel_path)
    
    # Matching logic for Excel
    for up in updates:
        mask = (df['펀드코드'].astype(str) == up['fund_id']) & (df['자산명'].astype(str) == up['asset_name'])
        if mask.any():
            df.loc[mask, '주소(보완용)'] = up['address']
            print(f"Updated Excel: {up['asset_name']}")
            
    df.to_excel(excel_path, index=False)

apply_online_updates()
