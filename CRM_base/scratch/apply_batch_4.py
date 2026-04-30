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
    {"fund_id": "P00003", "asset_name": "오시리아타워레지던스", "address": "부산광역시 기장군 기장읍 동부산관광7로 17"},
    {"fund_id": "P00039", "asset_name": "용산전자상가 특별계획구역8 개발사업", "address": "서울특별시 용산구 한강로2가 15-2 일원"},
    {"fund_id": "R00014", "asset_name": "신도림 디큐브시티 백화점", "address": "서울특별시 구로구 경인로 662"},
    {"fund_id": "112202", "asset_name": "제주 신화월드 개발사업(한화전문투자형사모부동산자투자신탁5호6M)", "address": "제주특별자치도 서귀포시 안덕면 신화역사로304번길 38"},
    {"fund_id": "112215", "asset_name": "제주 신화월드 개발사업(한화전문투자형사모부동산자투자신탁5호6M)", "address": "제주특별자치도 서귀포시 안덕면 신화역사로304번길 38"},
    {"fund_id": "112207", "asset_name": "시흥 센트럴푸르지오 사업장 공사대금 예금반환채권 금전채권신탁 담보대출", "address": "경기도 시흥시 수인로3312번길 16"},
    {"fund_id": "112379", "asset_name": "이지스 330호 (OPUS407/舊뉴욕제과빌딩)", "address": "서울특별시 서초구 강남대로 407"}
]

def apply_batch_4():
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

apply_batch_4()
