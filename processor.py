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
        manage_path = self.get_latest_file("투자 자산 관리_*.xlsx")
        if not file_path: return None
        
        # 1. 자산 관리 파일에서 상세 정보 및 자산코드 매핑 추출
        asset_info_map = {}
        if manage_path:
            try:
                df_m = pd.read_excel(manage_path)
                for _, row in df_m.iterrows():
                    name = str(row.get('자산(건물)명', '')).strip()
                    addr = str(row.get('전체주소(시/도, 구/군 포함)', '')).strip()
                    code = str(row.get('자산코드', '')).strip()
                    if name:
                        info = {
                            'asset_code': code if code != 'nan' else None,
                            'site_area': row.get('토지면적(㎡)'),
                            'gfa': row.get('연면적(m²)'),
                            'floors_up': row.get('건물규모(지상 층수)'),
                            'floors_down': row.get('건물규모(지하 층수)'),
                            'parking': row.get('주차대수'),
                            'completion_date': str(row.get('준공(예정)일', '')),
                        }
                        asset_info_map[name] = info
                        if addr and addr != 'nan': asset_info_map[f"{name}_{addr}"] = info
            except Exception as e:
                print(f"Error reading asset management file: {e}")

        # 2. 투자 자산 조회 파일 처리
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
        total = len(df)
        print(f"Processing Assets with Management Data: total {total} records")

        for i, row in df.iterrows():
            fund_id = str(row.get('펀드코드', '')).strip()
            asset_name = str(row.get('자산(건물)명', '')).strip()
            raw_addr = str(row.get(addr_col, '')).strip()
            
            if not fund_id or not asset_name or fund_id == 'nan': continue
            
            # Geocoding & Ledger (기존 로직 유지)
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

            # 관리 파일 정보 병합
            m_info = asset_info_map.get(f"{asset_name}_{raw_addr}") or asset_info_map.get(asset_name, {})
            
            meta = {
                'notion_asset_code': m_info.get('asset_code'),
                'notion_base_asset_class': row.get('기초자산'),
                'notion_asset_nature_class': row.get('자산성격'),
                'notion_business_stage_class': row.get('사업단계'),
                'notion_investment_strategy': row.get('투자전략'),
                'pnu': spec.get('pnu'),
                'refined_address': refined_addr
            }
            
            # 날짜 형식 정제 (2026-02-27 형식)
            def clean_date(d):
                if pd.isna(d) or str(d).lower() == 'nan' or not str(d).strip(): return None
                try:
                    return pd.to_datetime(d).strftime('%Y-%m-%d')
                except: return None

            completion_date = clean_date(m_info.get('completion_date')) or clean_date(row.get('준공(예정)일'))
            
            asset_record = {
                'fund_id': fund_id,
                'asset_name': asset_name,
                'location_category': row.get('투자지역') or row.get('국내/해외'),
                'lat': lat,
                'lng': lng,
                'metadata': meta,
                'site_area': m_info.get('site_area') or spec.get('대지면적'),
                'gfa': m_info.get('gfa') or row.get('연면적(m²)') or spec.get('연면적'),
                'floors_up': m_info.get('floors_up') or spec.get('지상층수'),
                'floors_down': m_info.get('floors_down') or spec.get('지하층수'),
                'parking': m_info.get('parking') or spec.get('주차대수'),
                'completion_date': completion_date,
                'main_usage': row.get('기초자산') or spec.get('주용도')
            }
            assets.append(asset_record)
            
            if i % 50 == 0:
                print(f"Processing Assets... {i}/{total}")

        # 캐시 저장
        with open(self.cache_file, 'w', encoding='utf-8') as f: json.dump(geo_cache, f, ensure_ascii=False, indent=2)
        with open(self.ledger_cache_file, 'w', encoding='utf-8') as f: json.dump(bld_cache, f, ensure_ascii=False, indent=2)
        
        return pd.DataFrame(assets)

    def super_fix_encoding(self, s):
        if not s or str(s).lower() == 'nan': return ''
        s = str(s).strip()
        
        # 1. Check if already correct
        if any(k in s for k in ['부문', '파트', '팀', '실', '호', '리얼에셋']): return s
        
        # 2. Known mojibake mappings (Observed in target files)
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
        if any(k in s for k in ['부문', '파트', '팀', '실', '호', '리얼에셋']): return s

        # 3. Dynamic recovery (Latin-1 -> CP949)
        for enc in ['latin-1', 'cp1252', 'iso-8859-1']:
            try:
                test_s = s.encode(enc).decode('cp949')
                if any(k in test_s for k in ['부문', '파트', '팀', '실', '호', '리얼에셋']): return test_s
            except: pass
            
        return s

    def process_fund_management(self):
        file_path = self.get_latest_file("*펀드 관리_*.xlsx")
        if not file_path: return None
        
        # Use pandas read_excel which handles encoding better in this environment
        df = pd.read_excel(file_path, header=None)
        
        # 1. 헤더에서 컬럼 인덱스 찾기
        def find_col_idx(df, keywords):
            for r in range(min(5, len(df))):
                row = df.iloc[r].astype(str).tolist()
                for i, val in enumerate(row):
                    s = self.super_fix_encoding(val)
                    if any(k in s for k in keywords): return i
            return None

        # Standard indices for the latest source format
        div_idx = 37
        dept_idx = 38
        fund_idx = 0
        
        # Verification: Check if we can find them dynamically to confirm
        found_div = find_col_idx(df, ['부문', '담당부문'])
        found_dept = find_col_idx(df, ['조직', '담당조직', '부서'])
        if found_div is not None: div_idx = found_div
        if found_dept is not None: dept_idx = found_dept
        
        print(f"DEBUG: Indices - Div: {div_idx}, Dept: {dept_idx}, Fund: {fund_idx}")

        new_cols = [f"col_{i}" for i in range(len(df.columns))]
        if fund_idx is not None: new_cols[fund_idx] = 'fund_id'
        if div_idx is not None: new_cols[div_idx] = 'notion_division_class'
        if dept_idx is not None: new_cols[dept_idx] = 'notion_dept_class'
        
        for idx_str, new_name in self.mapping.items():
            try:
                idx = int(idx_str)
                if idx < len(new_cols) and new_cols[idx].startswith('col_'): new_cols[idx] = new_name
            except: pass
        df.columns = new_cols
        
        if fund_idx is not None:
            df = df[df['fund_id'].astype(str).str.contains('^[A-Z0-9]+$', na=False, regex=True)].copy()
        
        df['raw_div'] = df['notion_division_class'].copy()
        
        def clean_division(val):
            s = str(val).strip()
            if not s or s.lower() == 'nan': return None
            
            # Direct match for known garbled RA division
            if 'ºι' in s or 'ι' in s or 'μ' in s or '󿡼' in s:
                return '리얼에셋부문'
                
            exclude = ['TF', '파트', '팀', '실', '그룹', '센터', '호']
            if any(kw in s for kw in exclude): return None
            
            if '리얼에셋' in s or 'Real Asset' in s: return '리얼에셋부문'
            if '부동산' in s: return '부동산부문'
            if '리츠' in s: return '리츠부문'
            if '인프라' in s: return '인프라부문'
            if '증권' in s: return '증권부문'
            if '부문' in s: return s.split(' ')[0] if ' ' in s else s
            return None

        df['notion_division_class'] = df['notion_division_class'].apply(clean_division)
        
        def merge_dept(row):
            raw_div = self.super_fix_encoding(row['raw_div'])
            dept_val = self.super_fix_encoding(row['notion_dept_class'])
            if pd.isna(row['notion_division_class']) and raw_div:
                if dept_val and raw_div not in dept_val: return f"{raw_div}, {dept_val}"
                return raw_div
            return dept_val
            
        df['notion_dept_class'] = df.apply(merge_dept, axis=1)
        df = df.drop(columns=['raw_div'])
        
        date_cols = ['setup_date', 'maturity_date']
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
        if df_m is not None and 'fund_id' in df_m.columns: ids.update(df_m['fund_id'].dropna().unique())
        
        master = pd.DataFrame({'fund_id': list(ids)})
        
        if df_m is not None:
            # Categorical columns already renamed to notion_* in process_fund_management
            cat_cols = [c for c in df_m.columns if c.startswith('notion_')]
            essential_cols = ['fund_id', 'fund_name', 'short_name', 'setup_date', 'maturity_date', 'parent_fund_id', 'status', 'dept']
            
            all_target_cols = [c for c in essential_cols + cat_cols if c in df_m.columns]
            df_m_clean = df_m[all_target_cols].drop_duplicates(subset=['fund_id'])
            
            # Merge on fund_id
            master = master.merge(df_m_clean, on='fund_id', how='left')
            
        return master
