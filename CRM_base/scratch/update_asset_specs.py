import requests
import xml.etree.ElementTree as ET
from urllib.parse import unquote, quote
import os
import time
from dotenv import load_dotenv

load_dotenv()

# API Keys
DATA_GO_KR_KEY = os.getenv("DATA_GO_KR_KEY")
VWORLD_KEY = os.getenv("VWORLD_KEY")
SB_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets"
SB_KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"

headers = {
    "apikey": SB_KEY,
    "Authorization": f"Bearer {SB_KEY}",
    "Content-Type": "application/json"
}

USAGE_MAP = {
    "업무시설": "오피스",
    "숙박시설": "호텔",
    "창고시설": "물류",
    "판매시설": "리테일",
    "공동주택": "주거",
    "단독주택": "주거",
    "방송통신시설": "데이터센터",
    "노유자시설": "기타(노유자)",
    "교육연구시설": "기타(교육)",
    "운동시설": "기타(운동)",
    "근린생활시설": "리테일",
    "공장": "물류"
}

class LedgerFetcher:
    def __init__(self):
        self.service_key = DATA_GO_KR_KEY
        self.vworld_key = VWORLD_KEY
        self.ledger_url = "http://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo"

    def get_pnu_info(self, address):
        if not address or '대한민국' in address or any(k in address for k in ['USA', 'UK', 'Germany']): return None
        url = "http://api.vworld.kr/req/search"
        params = {
            "service": "search", "request": "search", "type": "address",
            "category": "parcel", "query": address, "format": "json", "key": self.vworld_key
        }
        try:
            res = requests.get(url, params=params).json()
            if res['response']['status'] == 'OK' and res['response']['result']['items']:
                item = res['response']['result']['items'][0]
                pnu = item['id']
                if len(pnu) >= 19:
                    plat_gb_cd = '0' if pnu[10] == '1' else '1'
                    return {
                        'pnu': pnu, 'sigunguCd': pnu[:5], 'bjdongCd': pnu[5:10],
                        'platGbCd': plat_gb_cd, 'bun': pnu[11:15], 'ji': pnu[15:19]
                    }
        except: pass
        return None

    def fetch_ledger_info(self, pnu_info):
        if not self.service_key or not pnu_info: return None
        safe_key = quote(unquote(self.service_key))
        full_url = (
            f"{self.ledger_url}?serviceKey={safe_key}"
            f"&sigunguCd={pnu_info['sigunguCd']}&bjdongCd={pnu_info['bjdongCd']}"
            f"&platGbCd={pnu_info['platGbCd']}&bun={pnu_info['bun']}&ji={pnu_info['ji']}"
            "&numOfRows=1&pageNo=1"
        )
        try:
            res = requests.get(full_url, timeout=10)
            if 'NORMAL SERVICE' not in res.text: return None
            root = ET.fromstring(res.text)
            item = root.find(".//item")
            if item is not None:
                raw_usage = item.findtext("mainPurpsCdNm")
                mapped_usage = USAGE_MAP.get(raw_usage, raw_usage)
                
                return {
                    "main_usage": mapped_usage,
                    "gfa": float(item.findtext("totArea")) if item.findtext("totArea") else None,
                    "structure": item.findtext("strctCdNm"),
                    "floors_up": int(item.findtext("grndFlrCnt")) if item.findtext("grndFlrCnt") else None,
                    "floors_down": int(item.findtext("ugndFlrCnt")) if item.findtext("ugndFlrCnt") else None,
                    "completion_date": item.findtext("useAprvDe")
                }
        except: pass
        return None

def update_assets():
    fetcher = LedgerFetcher()
    print("Fetching assets from DB...")
    r = requests.get(f"{SB_URL}?select=fund_id,asset_name,address", headers=headers)
    assets = r.json()
    
    korean_prefixes = ['서울', '경기', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
    targets = [a for a in assets if a['address'] and any(a['address'].startswith(p) for p in korean_prefixes)]
    
    print(f"Found {len(targets)} candidate assets for ledger lookup.")

    success_count = 0
    for i, a in enumerate(targets):
        print(f"[{i+1}/{len(targets)}] {a['asset_name']}...", end=" ")
        pnu = fetcher.get_pnu_info(a['address'])
        if pnu:
            info = fetcher.fetch_ledger_info(pnu)
            if info and info['main_usage']:
                params = {"fund_id": f"eq.{a['fund_id']}", "asset_name": f"eq.{a['asset_name']}"}
                payload = {k: v for k, v in info.items() if v is not None}
                
                res = requests.patch(SB_URL, params=params, json=payload, headers=headers)
                if res.status_code in [200, 204]:
                    print(f"-> {info['main_usage']}")
                    success_count += 1
                else:
                    print(f"-> Update Failed ({res.status_code})")
            else:
                print("-> No info found")
        else:
            print("-> PNU fetch failed")
        
        if i % 10 == 0: time.sleep(0.1)

    print(f"\nFinished. Successfully updated {success_count} assets.")

if __name__ == "__main__":
    update_assets()
