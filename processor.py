import pandas as pd
import os
import glob
import json
import numpy as np
from geocoder import VWorldGeocoder, BuildingLedgerFetcher
import time

class CRMProcessor:
    def __init__(self, data_dir, mapping_file):
        self.data_dir = data_dir
        with open(mapping_file, 'r', encoding='utf-8') as f:
            self.mapping = json.load(f)
        self.geocoder = VWorldGeocoder()
        self.ledger_fetcher = BuildingLedgerFetcher()
        self.cache_file = os.path.join(data_dir, "geocoding_cache.json")
        self.ledger_cache_file = os.path.join(data_dir, "building_cache.json")
            
    def get_latest_file(self, pattern):
        files = glob.glob(os.path.join(self.data_dir, pattern))
        if not files: return None
        return max(files, key=os.path.getctime)

    def clean_name(self, name, category):
        if pd.isna(name): return "Unknown"
        name = str(name).strip()
        return self.mapping.get(category, {}).get(name, name)

    def process_lenders(self):
        file_path = self.get_latest_file("대주 정보 조회_*.xlsx")
        if not file_path: return None
        df = pd.read_excel(file_path)
        df['대주_정제'] = df['대주'].apply(lambda x: self.clean_name(x, 'lenders'))
        num_cols = ['대출약정금액(원)', '대출인출금액(원)', '대출잔여금액(원)', '대출금리', 'All-in금리']
        for col in num_cols:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
        date_cols = ['기준일자', '펀드설정일', '펀드만기일', '대출인출일', '대출만기일']
        for col in date_cols:
            df[col] = pd.to_datetime(df[col], errors='coerce')
        return df

    def process_beneficiaries(self):
        file_path = self.get_latest_file("수익자 정보 조회_*.xlsx")
        if not file_path: return None
        df = pd.read_excel(file_path)
        df['수익자_정제'] = df['수익자'].apply(lambda x: self.clean_name(x, 'beneficiaries'))
        num_cols = ['총약정금액', '투입금액', '잔여약정금액', '비율(%)']
        for col in num_cols:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
        date_cols = ['기준일자', '펀드설정일', '펀드만기일', '최초약정일']
        for col in date_cols:
            df[col] = pd.to_datetime(df[col], errors='coerce')
        return df

    def process_assets(self):
        file_path = self.get_latest_file("펀드자산조회_*.xlsx")
        if not file_path: return None
        df = pd.read_excel(file_path)
        
        # 캐시 로드
        geo_cache = {}
        if os.path.exists(self.cache_file):
            with open(self.cache_file, 'r', encoding='utf-8') as f:
                geo_cache = json.load(f)
        bld_cache = {}
        if os.path.exists(self.ledger_cache_file):
            with open(self.ledger_cache_file, 'r', encoding='utf-8') as f:
                bld_cache = json.load(f)

        lats, lngs, bld_specs = [], [], []
        for addr in df['주소']:
            # 1. Geocoding
            if addr in geo_cache:
                lat, lng = geo_cache[addr]
            else:
                lat, lng = self.geocoder.get_coordinates(addr)
                geo_cache[addr] = (lat, lng)
            lats.append(lat); lngs.append(lng)
            
            # 2. Building Ledger
            if addr in bld_cache:
                spec = bld_cache[addr]
            else:
                spec = self.ledger_fetcher.fetch_info(addr)
                bld_cache[addr] = spec
            bld_specs.append(spec)

        # 캐시 저장
        with open(self.cache_file, 'w', encoding='utf-8') as f:
            json.dump(geo_cache, f, ensure_ascii=False, indent=2)
        with open(self.ledger_cache_file, 'w', encoding='utf-8') as f:
            json.dump(bld_cache, f, ensure_ascii=False, indent=2)

        df['lat'], df['lng'] = lats, lngs
        df = pd.concat([df, pd.DataFrame(bld_specs)], axis=1)
        return df

    def process_fund_management(self):
        file_path = self.get_latest_file("펀드 관리_*.xlsx")
        if not file_path: return None
        df = pd.read_excel(file_path, header=1)
        mapping = {
            '펀드코드': 'fund_id', '약칭': 'short_name', '펀드명': 'fund_name',
            '투자섹터': 'sector', '자산명': 'asset_name', '운용상태': 'status',
            '국내/해외': 'location', '설정일': 'setup_date', '만기일': 'maturity_date',
            '부서': 'dept', '담당자': 'manager'
        }
        df_master = df.rename(columns=mapping)
        def create_metadata(row):
            meta = {}
            for col in df.columns:
                if col not in mapping and not pd.isna(row[col]):
                    meta[col] = str(row[col])
            return meta
        df_master['metadata'] = df.apply(create_metadata, axis=1)
        cols_to_keep = list(mapping.values()) + ['metadata']
        df_master = df_master[[c for c in cols_to_keep if c in df_master.columns]]
        return df_master.drop_duplicates(subset=['fund_id'])

    def process_market_rent(self, type_str):
        pattern = "office_rent_*.xlsx" if type_str == 'OFFICE' else "logistic_rent_*.xlsx"
        file_path = self.get_latest_file(pattern)
        if not file_path: return None
        print(f"Processing {type_str} Rent file: {file_path}")
        df = pd.read_excel(file_path)
        df_market = pd.DataFrame()
        df_market['category'] = [type_str] * len(df)
        df_market['region'] = df['빌딩 이름'].astype(str)
        df_market['value'] = pd.to_numeric(df['임대료 (원/평)'], errors='coerce').fillna(0)
        def quarter_to_date(q_str):
            if pd.isna(q_str) or 'Q' not in str(q_str): return None
            year = str(q_str)[:4]
            q = str(q_str)[-1]
            month = {'1': '03-31', '2': '06-30', '3': '09-30', '4': '12-31'}.get(q, '01-01')
            return f"{year}-{month}"
        df_market['base_date'] = df['연도 분기'].apply(quarter_to_date)
        df_market['source'] = 'Internal Rent Data'
        def create_extra_info(row_idx):
            row = df.iloc[row_idx]
            info = {}
            for col in df.columns:
                val = row[col]
                if not pd.isna(val): info[col] = str(val)
            return info
        df_market['extra_info'] = [create_extra_info(i) for i in range(len(df))]
        return df_market

    def extract_fund_master(self, df_l, df_b, df_a, df_m):
        if df_m is not None: master = df_m.copy()
        else: master = pd.DataFrame()
        return master.drop_duplicates(subset=['fund_id'])

if __name__ == "__main__":
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    MAPPING_FILE = os.path.join(BASE_DIR, "mapping.json")
    processor = CRMProcessor(BASE_DIR, MAPPING_FILE)
    df_a = processor.process_assets()
    print(df_a[['자산(건물)명', 'lat', 'lng']].head())
