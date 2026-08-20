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
        self.archive_dir = os.path.join(data_dir, "_archive")
        
        # mapping_file 경로 유연화
        actual_mapping_path = mapping_file if os.path.exists(mapping_file) else os.path.join(self.archive_dir, os.path.basename(mapping_file))
        if not os.path.exists(actual_mapping_path):
            raise FileNotFoundError(f"Mapping file not found: {mapping_file}")
            
        with open(actual_mapping_path, 'r', encoding='utf-8') as f:
            self.mapping = json.load(f)
        self.geocoder = VWorldGeocoder()
        self.ledger_fetcher = BuildingLedgerFetcher()
        
        # 캐시 파일 경로 (Root에 없으면 Archive 참조)
        self.cache_file = self._resolve_path("geocoding_cache.json")
        self.ledger_cache_file = self._resolve_path("building_cache.json")
            
    def _resolve_path(self, filename):
        root_path = os.path.join(self.data_dir, filename)
        archive_path = os.path.join(self.archive_dir, filename)
        return root_path if os.path.exists(root_path) else archive_path

    def get_latest_file(self, pattern):
        # Root와 Archive 양쪽에서 파일을 찾음
        files = glob.glob(os.path.join(self.data_dir, pattern))
        if os.path.exists(self.archive_dir):
            files.extend(glob.glob(os.path.join(self.archive_dir, pattern)))
            
        if not files: return None
        # 임시 파일(~$ 시작) 제외
        files = [f for f in files if not os.path.basename(f).startswith('~$')]
        if not files: return None
        # 모든 검색 결과 중 가장 최근에 생성된 파일 선택
        return max(files, key=os.path.getctime)

    def super_fix_encoding(self, s):
        if not s or str(s).lower() == 'nan': return ''
        s = str(s).strip()
        
        # 1. 부문/조직 관련 깨진 문자 교정
        mojibake_map = {
            '\U000ff87c': '리얼에셋',
            'ºι': '부문',
            'ι': '부문',
            'μ': '부문',
            'ڻ': '부동산',
            'Ʈ': '팀'
        }
        for k, v in mojibake_map.items():
            if k in s: s = s.replace(k, v)
            
        if '󿡼' in s or 'ºι' in s:
            return '리얼에셋부문'

        # 2. CP949 복원 시도
        for enc in ['latin-1', 'cp1252', 'iso-8859-1']:
            try:
                test_s = s.encode(enc).decode('cp949')
                if any(k in test_s for k in ['부문', '파트', '팀', '실', '호', '리얼에셋', '운용', '청산']): return test_s
            except: pass
            
        return s

    def process_fund_management(self):
        # 1. 파일 찾기
        f_org = self.get_latest_file("*펀드 관리*20260428*.xlsx")
        f_aum = self.get_latest_file("*AUM*20260427*.xlsx")
        
        if not f_org or not f_aum:
            print(f"ERROR: Missing files. Org: {f_org}, AUM: {f_aum}")
            return None
            
        print(f"Loading Org: {os.path.basename(f_org)}")
        print(f"Loading AUM: {os.path.basename(f_aum)}")
        
        # 2. 데이터 로드
        df_org = pd.read_excel(f_org, header=None)
        df_aum = pd.read_excel(f_aum, header=None)
        
        # 3. 데이터 매핑 (Verified Indices)
        # Org File (펀드 관리) - 0: FundID, 37: Division, 38: Dept, 39: Manager
        org_mapped = df_org[[0, 37, 38, 39]].copy()
        org_mapped.columns = ['fund_id', 'division', 'department', 'manager']
        
        # AUM File (펀드 AUM 현황) - 0: FundID, 2: Name, 5: Status, 7: Setup, 8: Maturity, 17: Equity(Committed), 18: Loan(Committed), 20: AUM(Committed)
        aum_mapped = df_aum.iloc[2:][[0, 2, 5, 7, 8, 17, 18, 20]].copy()
        aum_mapped.columns = ['fund_id', 'fund_name', 'status', 'setup_date', 'maturity_date', 'equity_won', 'loan_won', 'benchmark_aum']
        
        # 4. 병합 (Merge on fund_id)
        df = pd.merge(aum_mapped, org_mapped, on='fund_id', how='left')
        
        # 5. 데이터 클리닝
        df['fund_id'] = df['fund_id'].astype(str)
        
        def clean_status(val):
            s = str(val).strip()
            if not s or s.lower() == 'nan': return '기타'
            if 'ǹ' in s: return '운용'
            if 'û' in s: return '청산'
            fixed = self.super_fix_encoding(s)
            if '운용' in fixed: return '운용'
            if '청산' in fixed: return '청산'
            return fixed if fixed in ['운용', '청산'] else '운용' # Default to active if unknown but present

        df['status'] = df['status'].apply(clean_status)
        
        text_cols = ['fund_name', 'division', 'department', 'manager']
        for col in text_cols:
            df[col] = df[col].apply(self.super_fix_encoding)
            
        # Dates
        for col in ['setup_date', 'maturity_date']:
            df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%d')
            
        # Values
        num_cols = ['equity_won', 'loan_won', 'benchmark_aum']
        for col in num_cols:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            
        # Extras
        df['short_name'] = df['fund_name'].str[:12]
        df['sector'] = '미분류'
        df['asset_name'] = ''
        df['location'] = ''
        
        # Add other empty attr cols to avoid errors in uploader
        attrs = ['vehicle_type', 'fund_class', 'fund_type', 'investment_strategy']
        for attr in attrs:
            df[attr] = '미분류'
            
        return df

    def process_lenders(self):
        file_path = self.get_latest_file("대주 정보 조회_*.xlsx")
        if not file_path: return None
        df = pd.read_excel(file_path)
        df['대주_정제'] = df['대주'].apply(lambda x: str(x).strip())
        date_cols = ['기준일자', '대출인출일', '대출만기일']
        for col in date_cols:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%d')
        return df

    def process_beneficiaries(self):
        file_path = self.get_latest_file("수익자 정보 조회_*.xlsx")
        if not file_path: return None
        df = pd.read_excel(file_path)
        df['수익자_정제'] = df['수익자'].apply(lambda x: str(x).strip())
        date_cols = ['기준일자', '최초약정일']
        for col in date_cols:
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors='coerce').dt.strftime('%Y-%m-%d')
        return df

    def process_assets(self):
        file_path = self.get_latest_file("투자 자산 조회_*.xlsx")
        if not file_path: return None
        df = pd.read_excel(file_path)
        
        # 주소 컬럼 찾기
        addr_col = next((c for c in df.columns if '주소' in str(c)), None)
        if not addr_col: return None

        geo_cache = {}
        if os.path.exists(self.cache_file):
            with open(self.cache_file, 'r', encoding='utf-8') as f:
                geo_cache = json.load(f)
        bld_cache = {}
        if os.path.exists(self.ledger_cache_file):
            with open(self.ledger_cache_file, 'r', encoding='utf-8') as f:
                bld_cache = json.load(f)

        assets = []
        for i, row in df.iterrows():
            fund_id = str(row.get('펀드코드', '')).strip()
            asset_name = str(row.get('자산(건물)명', '')).strip()
            raw_addr = str(row.get(addr_col, '')).strip()
            
            if not fund_id or not asset_name or fund_id == 'nan': continue
            
            lat, lng, refined_addr = None, None, raw_addr
            spec = {}
            if raw_addr in geo_cache:
                lat, lng, refined_addr = geo_cache[raw_addr]
                spec = bld_cache.get(raw_addr, {})
            else:
                pnu_info = self.ledger_fetcher.refine_address(raw_addr)
                if pnu_info:
                    refined_addr = pnu_info['refined_address']
                    lat, lng = self.geocoder.get_coordinates(refined_addr)
                    spec = self.ledger_fetcher.fetch_info_by_pnu(pnu_info)
                else:
                    lat, lng = self.geocoder.get_coordinates(raw_addr)
                geo_cache[raw_addr] = (lat, lng, refined_addr); bld_cache[raw_addr] = spec
                time.sleep(0.01)

            asset_record = {
                'fund_id': fund_id,
                'asset_name': asset_name,
                'location_category': row.get('투자지역') or row.get('국내/해외'),
                'lat': lat,
                'lng': lng,
                'site_area': row.get('토지면적(㎡)') or spec.get('대지면적'),
                'gfa': row.get('연면적(m²)') or spec.get('연면적'),
                'floors_up': spec.get('지상층수'),
                'floors_down': spec.get('지하층수'),
                'parking': spec.get('주차대수'),
                'completion_date': str(row.get('준공(예정)일', '')),
                'main_usage': row.get('기초자산') or spec.get('주용도')
            }
            assets.append(asset_record)

        return pd.DataFrame(assets)

    def process_market_rent(self, category):
        pattern = "office_rent_*.xlsx" if category == 'OFFICE' else "logistic_rent_*.xlsx"
        file_path = self.get_latest_file(pattern)
        if not file_path: return None
        df = pd.read_excel(file_path)
        
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
