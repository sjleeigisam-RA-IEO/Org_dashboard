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
        date_cols = ['기준일자', '대출인출일', '대출만기일']
        for col in date_cols:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%d')
        return df

    def process_beneficiaries(self):
        file_path = self.get_latest_file("수익자 정보 조회_*.xlsx")
        if not file_path: return None
        df = pd.read_excel(file_path)
        df['수익자_정제'] = df['수익자'].apply(lambda x: self.clean_name(x, 'beneficiaries'))
        date_cols = ['기준일자', '최초약정일']
        for col in date_cols:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%d')
        return df

    def process_assets(self):
        file_path = self.get_latest_file("투자 자산 조회_*.xlsx")
        if not file_path: return None
        df = pd.read_excel(file_path)
        
        addr_col = None
        for c in df.columns:
            if '주소' in str(c):
                addr_col = c
                break
        if not addr_col: return None

        geo_cache = {}
        if os.path.exists(self.cache_file):
            with open(self.cache_file, 'r', encoding='utf-8') as f:
                geo_cache = json.load(f)
        bld_cache = {}
        if os.path.exists(self.ledger_cache_file):
            with open(self.ledger_cache_file, 'r', encoding='utf-8') as f:
                bld_cache = json.load(f)

        refined_addresses, lats, lngs, bld_specs = [], [], [], []
        total = len(df)
        print(f"Starting asset processing: total {total} records")

        for i, addr in enumerate(df[addr_col]):
            addr = str(addr)
            if i % 10 == 0: print(f"Processing... {i}/{total}")
            
            if addr in geo_cache:
                lat, lng, refined_addr = geo_cache[addr]
                spec = bld_cache.get(addr, {})
            else:
                pnu_info = self.ledger_fetcher.refine_address(addr)
                if pnu_info:
                    refined_addr = pnu_info['refined_address']
                    lat, lng = self.geocoder.get_coordinates(refined_addr)
                    spec = self.ledger_fetcher.fetch_info_by_pnu(pnu_info)
                else:
                    refined_addr = addr; lat, lng = self.geocoder.get_coordinates(addr); spec = {}
                geo_cache[addr] = (lat, lng, refined_addr); bld_cache[addr] = spec
                time.sleep(0.02) # 약간의 딜레이
                
            refined_addresses.append(refined_addr); lats.append(lat); lngs.append(lng); bld_specs.append(spec)
            
        with open(self.cache_file, 'w', encoding='utf-8') as f:
            json.dump(geo_cache, f, ensure_ascii=False, indent=2)
        with open(self.ledger_cache_file, 'w', encoding='utf-8') as f:
            json.dump(bld_cache, f, ensure_ascii=False, indent=2)

        df = df.reset_index(drop=True)
        df['주소'] = refined_addresses
        df['lat'], df['lng'] = lats, lngs
        spec_df = pd.DataFrame(bld_specs).reset_index(drop=True)
        df = pd.concat([df, spec_df], axis=1)
        
        mapping = {}
        for c in df.columns:
            cs = str(c)
            if '펀드코드' in cs: mapping[c] = '펀드코드'
            elif '자산(건물)명' in cs: mapping[c] = '자산(건물)명'
            elif '권역' in cs: mapping[c] = '권역'
        # 최종 컬럼 확인 (디버깅용)
        print(f"Final Asset Columns: {df.columns.tolist()}")
        return df.rename(columns=mapping)

    def process_fund_management(self):
        file_path = self.get_latest_file("펀드 관리_*.xlsx")
        if not file_path: return None
        df = pd.read_excel(file_path, header=1)
        mapping = {}
        found_keys = set()
        for idx, c in enumerate(df.columns):
            cs = str(c)
            target = None
            if idx == 53 or '모펀드코드' in cs: target = '모펀드코드'
            elif '코드' in cs and '펀드코드' not in found_keys: target = '펀드코드'
            elif ('약칭' in cs or 'Ī' in cs) and '약칭' not in found_keys: target = '약칭'
            elif ('명칭' in cs or '펀드명' in cs) and '펀드명' not in found_keys: target = '펀드명'
            elif '부서' in cs and '운용부서' not in found_keys: target = '운용부서'
            elif '설정일' in cs and '설정일' not in found_keys: target = '설정일'
            elif '만기일' in cs and '만기일' not in found_keys: target = '만기일'
            if target: mapping[c] = target; found_keys.add(target)
        df = df.rename(columns=mapping)
        date_cols = ['설정일', '만기일']
        for col in date_cols:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%d')
        return df

    def process_market_rent(self, category):
        pattern = "office_rent_*.xlsx" if category == 'OFFICE' else "logistic_rent_*.xlsx"
        file_path = self.get_latest_file(pattern)
        if not file_path: return None
        df = pd.read_excel(file_path)
        
        # 컬럼명이 깨져있으므로 인덱스로 접근하여 강제 매핑
        # 오피스: 3:분기, 4:건물명, 5:권역, 8:보증금, 9:임대료, 10:관리비
        # 물류: 3:분기, 4:권역/이름, 5:유형, 9:보증금, 10:임대료, 11:관리비
        new_df = pd.DataFrame()
        try:
            if category == 'OFFICE':
                new_df['base_date'] = df.iloc[:, 3]
                new_df['asset_name'] = df.iloc[:, 4]
                new_df['region'] = df.iloc[:, 5]
                new_df['rent_deposit'] = df.iloc[:, 8]
                new_df['rent_monthly'] = df.iloc[:, 9]
                new_df['maint_fee'] = df.iloc[:, 10]
            else:
                new_df['base_date'] = df.iloc[:, 3]
                new_df['region'] = df.iloc[:, 4]
                new_df['sub_type'] = df.iloc[:, 5]
                new_df['rent_deposit'] = df.iloc[:, 9]
                new_df['rent_monthly'] = df.iloc[:, 10]
                new_df['maint_fee'] = df.iloc[:, 11]
            
            new_df['category'] = category
            # 분기 데이터(2022Q4)를 날짜형식(2022-12-31)으로 변환
            def q_to_date(q):
                try:
                    if pd.isna(q): return '2025-12-31'
                    qs = str(q)
                    year = qs[:4]
                    if 'Q1' in qs: return f"{year}-03-31"
                    if 'Q2' in qs: return f"{year}-06-30"
                    if 'Q3' in qs: return f"{year}-09-30"
                    if 'Q4' in qs: return f"{year}-12-31"
                    return '2025-12-31'
                except: return '2025-12-31'
            
            new_df['base_date'] = new_df['base_date'].apply(q_to_date)
            return new_df.dropna(subset=['region'])
        except Exception as e:
            print(f"Error processing market rent: {e}")
            return None

    def extract_fund_master(self, df_l, df_b, df_a, df_m):
        ids = set()
        if df_l is not None and '펀드코드' in df_l.columns: ids.update(df_l['펀드코드'].dropna().unique())
        if df_b is not None and '펀드코드' in df_b.columns: ids.update(df_b['펀드코드'].dropna().unique())
        if df_a is not None and '펀드코드' in df_a.columns: ids.update(df_a['펀드코드'].dropna().unique())
        if df_m is not None and '펀드코드' in df_m.columns: ids.update(df_m['펀드코드'].dropna().unique())
        master = pd.DataFrame({'fund_id': list(ids)})
        if df_m is not None:
            cols = [c for c in ['펀드코드', '펀드명', '약칭', '운용부서', '설정일', '만기일', '모펀드코드'] if c in df_m.columns]
            master = master.merge(df_m[cols], left_on='fund_id', right_on='펀드코드', how='left')
            rename_map = {'펀드명': 'fund_name', '약칭': 'short_name', '운용부서': 'dept', '설정일': 'setup_date', '만기일': 'expiry_date', '모펀드코드': 'parent_fund_id'}
            master = master.rename(columns={k: v for k, v in rename_map.items() if k in master.columns})
            korean_cols = [c for c in master.columns if any(ord(char) > 127 for char in str(c))]
            master = master.drop(columns=korean_cols)
        return master
