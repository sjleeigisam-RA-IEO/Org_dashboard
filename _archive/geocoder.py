import requests
import os
import xml.etree.ElementTree as ET
from urllib.parse import unquote, quote
from dotenv import load_dotenv

load_dotenv()

class VWorldGeocoder:
    def __init__(self):
        self.api_key = os.getenv("VWORLD_KEY")
        self.url = "http://api.vworld.kr/req/address"

    def get_coordinates(self, address):
        if not address or str(address) == 'nan': return None, None
        params = {
            "service": "address", "request": "getcoord", "crs": "epsg:4326",
            "address": address, "format": "json", "type": "ROAD", "key": self.api_key
        }
        try:
            res = requests.get(self.url, params=params).json()
            if res['response']['status'] == 'OK':
                pt = res['response']['result']['point']
                return float(pt['y']), float(pt['x'])
            params['type'] = 'PARCEL'
            res = requests.get(self.url, params=params).json()
            if res['response']['status'] == 'OK':
                pt = res['response']['result']['point']
                return float(pt['y']), float(pt['x'])
        except: pass
        return None, None

class BuildingLedgerFetcher:
    def __init__(self):
        self.service_key = os.getenv("DATA_GO_KR_KEY")
        self.vworld_key = os.getenv("VWORLD_KEY")
        self.ledger_url = "http://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo"

    def refine_address(self, query_address):
        """VWorld를 이용해 오타가 있는 주소를 공식 도로명 주소로 정제하고 PNU 추출"""
        url = "http://api.vworld.kr/req/search"
        # 지번 주소 형태인 경우 parcel 우선 검색
        is_jibun = any(char.isdigit() for char in query_address) and '동 ' in query_address
        category = "parcel" if is_jibun else "road"
        
        params = {
            "service": "search", "request": "search", "type": "address",
            "category": category, "query": query_address, "format": "json", "key": self.vworld_key
        }
        try:
            res = requests.get(url, params=params).json()
            if res['response']['status'] != 'OK':
                params['category'] = "road" if category == "parcel" else "parcel"
                res = requests.get(url, params=params).json()

            if res['response']['status'] == 'OK' and res['response']['result']['items']:
                item = res['response']['result']['items'][0]
                pnu = item['id']
                refined_addr = item.get('address', {}).get('road') or item.get('address', {}).get('parcel', query_address)
                
                if len(pnu) >= 19:
                    plat_gb_cd = '0' if pnu[10] == '1' else '1'
                    return {
                        'refined_address': refined_addr, 'pnu': pnu,
                        'sigunguCd': pnu[:5], 'bjdongCd': pnu[5:10],
                        'platGbCd': plat_gb_cd, 'bun': pnu[11:15], 'ji': pnu[15:19]
                    }
        except: pass
        return None

    def fetch_info_by_pnu(self, pnu_info):
        """정제된 PNU 정보를 바탕으로 건축HUB API 호출"""
        if not self.service_key or not pnu_info: return {}
        
        # requests의 자동 인코딩 방지를 위해 전체 URL을 수동으로 조립
        safe_key = quote(unquote(self.service_key))
        full_url = (
            f"{self.ledger_url}?serviceKey={safe_key}"
            f"&sigunguCd={pnu_info['sigunguCd']}"
            f"&bjdongCd={pnu_info['bjdongCd']}"
            f"&platGbCd={pnu_info['platGbCd']}"
            f"&bun={pnu_info['bun']}"
            f"&ji={pnu_info['ji']}"
            f"&numOfRows=1&pageNo=1"
        )
        
        try:
            res = requests.get(full_url, timeout=10)
            if not res.text or 'NORMAL SERVICE' not in res.text:
                return {}
                
            root = ET.fromstring(res.text)
            item = root.find(".//item")
            if item is not None:
                return {
                    "site_area": float(item.findtext("platArea")) if item.findtext("platArea") else None,
                    "scr": float(item.findtext("bcRat")) if item.findtext("bcRat") else None,
                    "far": float(item.findtext("vlRat")) if item.findtext("vlRat") else None,
                    "main_usage": item.findtext("mainPurpsCdNm") or None,
                    "structure": item.findtext("strctCdNm") or None,
                    "floors_up": int(item.findtext("grndFlrCnt")) if item.findtext("grndFlrCnt") else None,
                    "floors_down": int(item.findtext("ugndFlrCnt")) if item.findtext("ugndFlrCnt") else None,
                    "elevators": f"승용 {item.findtext('rideLftCnt') or 0} / 비상 {item.findtext('emgenLftCnt') or 0}" if item.findtext("rideLftCnt") else None,
                    "parking": f"옥내 {item.findtext('indrAutoUtcnt') or 0} / 옥외 {item.findtext('oudrAutoUtcnt') or 0}" if item.findtext("indrAutoUtcnt") else None,
                    "completion_date": item.findtext("useAprvDe") or None,
                    "height": float(item.findtext("heit")) if item.findtext("heit") else None,
                    "gfa": float(item.findtext("totArea")) if item.findtext("totArea") else None,
                    "pnu": pnu_info['pnu']
                }
        except: pass
        return {}
