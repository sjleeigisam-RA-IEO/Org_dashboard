import pandas as pd
import os

asset_file = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 조회_20260428.xlsx"
fund_file = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]펀드 관리_20260428.xlsx"

def fix_text(s):
    if not s or str(s).lower() == 'nan': return ''
    s = str(s).strip()
    # Basic encoding fix for CP949 data read as latin-1 or similar
    for enc in ['latin-1', 'cp1252', 'iso-8859-1']:
        try:
            test_s = s.encode(enc).decode('cp949')
            if any(k in test_s for k in ['부문', '파트', '호', '복합', '오피스', '주거', '개발', '시니어']): 
                return test_s
        except: pass
    return s

def create_comparison():
    if not os.path.exists(asset_file) or not os.path.exists(fund_file):
        return None

    df_asset = pd.read_excel(asset_file, header=None)
    df_asset_filtered = df_asset[df_asset[7].astype(str).str.contains('오피스복합')].copy()
    df_fund = pd.read_excel(fund_file, header=None)
    
    final_data = []
    for _, row in df_asset_filtered.iterrows():
        fid = str(row[0]).strip()
        asset_name = fix_text(row[6])
        asset_class = fix_text(row[7])
        fund_row = df_fund[df_fund[0].astype(str).str.strip() == fid]
        if not fund_row.empty:
            fund_name = fix_text(fund_row.iloc[0][1])
            fund_class = fix_text(fund_row.iloc[0][12])
        else:
            fund_name = "N/A"
            fund_class = "N/A"
            
        final_data.append([fid, fund_name, asset_name, asset_class, fund_class])
    
    return final_data

data = create_comparison()
if data:
    import sys
    # Ensure stdout handles UTF-8
    sys.stdout.reconfigure(encoding='utf-8')
    print("| 펀드코드 | 펀드명 | 자산명 | 자산조회(기초자산) | 펀드관리(용도) |")
    print("| :--- | :--- | :--- | :--- | :--- |")
    for row in data:
        print(f"| {' | '.join(row)} |")
