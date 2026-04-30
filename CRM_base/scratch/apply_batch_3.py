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
    {"fund_id": "120050", "asset_name": "수서역세권 공공주택지구 B1-3BL 개발사업 브릿지대출", "address": "서울특별시 강남구 수서동 187 일원"},
    {"fund_id": "120076", "asset_name": "이지스경산물류제1호일반사모부동산투자회사의 1종 종류주식", "address": "경상북도 경산시 진량읍 문천리 903"},
    {"fund_id": "120081", "asset_name": "이지스경산로지스1호(보통주)", "address": "경상북도 경산시 진량읍 문천리 903"},
    {"fund_id": "190002", "asset_name": "분당야탑물류센터", "address": "경기도 성남시 분당구 야탑동 403"},
    {"fund_id": "200017", "asset_name": "London Canon Bridge House Senior Loan", "address": "Cannon Bridge House, 25 Dowgate Hill, London, EC4R 2YA, UK"}
]

def apply_batch_3():
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

apply_batch_3()
