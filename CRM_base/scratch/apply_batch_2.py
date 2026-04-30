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
    {"fund_id": "120008", "asset_name": "용산더프라임", "address": "서울특별시 용산구 원효로90길 11"},
    {"fund_id": "120009", "asset_name": "용산더프라임", "address": "서울특별시 용산구 원효로90길 11"},
    {"fund_id": "120010", "asset_name": "용산더프라임", "address": "서울특별시 용산구 원효로90길 11"},
    {"fund_id": "120037", "asset_name": "성수동2가 268-2 업무시설 개발사업 브릿지대출", "address": "서울특별시 성동구 성수동2가 268-2"},
    {"fund_id": "120042", "asset_name": "디어스판교", "address": "경기도 성남시 수정구 대왕판교로 815"},
    {"fund_id": "120043", "asset_name": "디어스판교", "address": "경기도 성남시 수정구 대왕판교로 815"},
    {"fund_id": "112798", "asset_name": "성내동 개발부지 담보대출(브릿지론)", "address": "서울특별시 강동구 성내동 19-1"},
    {"fund_id": "112799", "asset_name": "성내동 개발부지 담보대출(브릿지론)", "address": "서울특별시 강동구 성내동 19-1"},
    {"fund_id": "112800", "asset_name": "성내동 개발부지 담보대출(브릿지론)", "address": "서울특별시 강동구 성내동 19-1"},
    {"fund_id": "112704", "asset_name": "인천 가좌동 소재 개발자산 선매입", "address": "인천광역시 서구 가좌동 585-1"},
    {"fund_id": "112706", "asset_name": "와이디427피에프브이 주식회사", "address": "서울특별시 중구 소월로 50"},
    {"fund_id": "112707", "asset_name": "와이디427피에프브이 주식회사", "address": "서울특별시 중구 소월로 50"},
    {"fund_id": "120016", "asset_name": "와이디427피에프브이 주식회사", "address": "서울특별시 중구 소월로 50"}
]

def apply_batch_2():
    for up in updates:
        params = {"fund_id": f"eq.{up['fund_id']}", "asset_name": f"eq.{up['asset_name']}"}
        res = requests.patch(BASE_URL, params=params, json={"address": up['address']}, headers=headers)
        if res.status_code in [200, 204]:
            print(f"Updated DB: {up['asset_name']} ({up['fund_id']})")
        else:
            print(f"Failed DB Update: {up['asset_name']} ({res.status_code})")

    # Update Excel
    excel_path = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\[new]주소_보완_대상_리스트.xlsx"
    df = pd.read_excel(excel_path)
    
    for up in updates:
        mask = (df['펀드코드'].astype(str) == up['fund_id']) & (df['자산명'].astype(str) == up['asset_name'])
        if mask.any():
            df.loc[mask, '주소(보완용)'] = up['address']
            print(f"Updated Excel: {up['asset_name']} ({up['fund_id']})")
            
    df.to_excel(excel_path, index=False)

apply_batch_2()
