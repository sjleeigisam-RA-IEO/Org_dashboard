import pandas as pd
import os

asset_file = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 조회_20260428.xlsx"
fund_file = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]펀드 관리_20260428.xlsx"

def fix_text(s):
    if not s or str(s).lower() == 'nan': return ''
    s = str(s).strip()
    for enc in ['latin-1', 'cp1252', 'iso-8859-1']:
        try:
            test_s = s.encode(enc).decode('cp949')
            if any(k in test_s for k in ['부문', '파트', '호', '복합', '오피스', '주거', '개발', '시니어']): 
                return test_s
        except: pass
    return s

def count_mismatches():
    if not os.path.exists(asset_file) or not os.path.exists(fund_file):
        return None

    df_asset = pd.read_excel(asset_file, header=None)
    df_asset_filtered = df_asset[df_asset[7].astype(str).str.contains('오피스복합')].copy()
    df_fund = pd.read_excel(fund_file, header=None)
    
    total_office_complex_in_asset = len(df_asset_filtered)
    mismatches = []
    fund_class_stats = {}

    for _, row in df_asset_filtered.iterrows():
        fid = str(row[0]).strip()
        fund_row = df_fund[df_fund[0].astype(str).str.strip() == fid]
        if not fund_row.empty:
            fund_class = fix_text(fund_row.iloc[0][12])
        else:
            fund_class = "N/A"
            
        fund_class_stats[fund_class] = fund_class_stats.get(fund_class, 0) + 1
        
        # Define what is NOT a mismatch (e.g. '복합(오피스)' or '오피스')
        if fund_class not in ['복합(오피스)', '오피스']:
            mismatches.append(fid)

    return {
        'total_asset_office_complex': total_office_complex_in_asset,
        'mismatch_count': len(mismatches),
        'stats': fund_class_stats
    }

res = count_mismatches()
if res:
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    print(f"Total '오피스복합' in Asset File: {res['total_asset_office_complex']}")
    print(f"Mismatch Count (not Office/Mixed-Office in Fund File): {res['mismatch_count']}")
    print("\nBreakdown of Fund Management Classes for these items:")
    for cls, count in res['stats'].items():
        print(f"- {cls}: {count}")
