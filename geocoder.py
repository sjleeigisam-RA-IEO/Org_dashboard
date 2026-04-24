import requests
import os
import xml.etree.ElementTree as ET
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
        self.ledger_url = "http://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo"

    def parse_address_for_api(self, address):
        """VWorld Search API를 이용해 행정코드 및 번지 추출"""
        url = "http://api.vworld.kr/req/search"
        params = {
            "service": "search", "request": "search", "type": "address",
            "query": address, "format": "json", "key": self.vworld_key
        }
        try:
            res = requests.get(url, params=params).json()
            if res['response']['status'] == 'OK':
                item = res['response']['result']['items'][0]
                # PNU 19자리: 시군구(5) + 법정동(5) + 산(1) + 본번(4) + 부번(4)
                pnu = item['id']
                if len(pnu) >= 19:
                    return {
                        'sigunguCd': pnu[:5], 'bjdongCd': pnu[5:10],
                        'bun': pnu[11:15], 'ji': pnu[15:19]
                    }
        except: pass
        return None

    def fetch_info(self, address):
        if not self.service_key: return {}
        addr_parts = self.parse_address_for_api(address)
        if not addr_parts: return {}

        params = {
            'serviceKey': self.service_key, 'platGbCd': '0',
            'sigunguCd': addr_parts['sigunguCd'], 'bjdongCd': addr_parts['bjdongCd'],
            'bun': addr_parts['bun'], 'ji': addr_parts['ji'],
            'numOfRows': '1', 'pageNo': '1'
        }
        
        try:
            res = requests.get(self.ledger_url, params=params)
            root = ET.fromstring(res.text)
            item = root.find(".//item")
            if item is not None:
                return {
                    "site_area": float(item.findtext("platArea") or 0),
                    "scr": float(item.findtext("bcRat") or 0),
                    "far": float(item.findtext("vlRat") or 0),
                    "main_usage": item.findtext("mainPurpsCdNm") or "-",
                    "structure": item.findtext("strctCdNm") or "-",
                    "floors_up": int(item.findtext("grndFlrCnt") or 0),
                    "floors_down": int(item.findtext("ugndFlrCnt") or 0),
                    "elevators": f"승용 {item.findtext('rideLftCnt') or 0} / 비상 {item.findtext('emgenLftCnt') or 0}",
                    "parking": f"옥내 {item.findtext('indrAutoUtcnt') or 0} / 옥외 {item.findtext('oudrAutoUtcnt') or 0}",
                    "completion_date": item.findtext("useAprvDe") or "-",
                    "height": float(item.findtext("heit") or 0),
                    "gfa": float(item.findtext("totArea") or 0)
                }
        except Exception as e:
            print(f"Building Ledger API Error: {e}")
            
        return {}
