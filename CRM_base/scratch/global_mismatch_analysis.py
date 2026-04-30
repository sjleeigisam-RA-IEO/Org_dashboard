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
            # Look for common Korean terms in these files
            if any(k in test_s for k in ['부문', '파트', '호', '복합', '오피스', '주거', '개발', '시니어', '물류', '리테일', '특별', '지분', '채권']): 
                return test_s
        except: pass
    return s

def global_analysis():
    if not os.path.exists(asset_file) or not os.path.exists(fund_file):
        return None

    df_asset = pd.read_excel(asset_file, header=None)
    df_fund = pd.read_excel(fund_file, header=None)
    
    # Pre-process fund file for fast lookup
    fund_map = {}
    for _, row in df_fund.iterrows():
        fid = str(row[0]).strip()
        fund_map[fid] = fix_text(row[12])

    matches = 0
    mismatches = 0
    patterns = {}
    asset_class_counts = {}

    for _, row in df_asset.iterrows():
        fid = str(row[0]).strip()
        if fid == '펀드코드' or fid == 'nan' or not fid: continue
        
        asset_class = fix_text(row[7])
        fund_class = fund_map.get(fid)
        
        if fund_class is None: continue # No matching fund found
        
        matches += 1
        asset_class_counts[asset_class] = asset_class_counts.get(asset_class, 0) + 1
        
        # Simple string equality for now, but strip whitespace and handle 'nan'
        if asset_class != fund_class:
            mismatches += 1
            pattern = (asset_class, fund_class)
            patterns[pattern] = patterns.get(pattern, 0) + 1

    return {
        'total_matched': matches,
        'mismatch_count': mismatches,
        'patterns': patterns,
        'asset_counts': asset_class_counts
    }

res = global_analysis()
if res:
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    print(f"Global Classification Analysis")
    print(f"==============================")
    print(f"Total Matched Records: {res['total_matched']}")
    print(f"Mismatch Count: {res['mismatch_count']} ({res['mismatch_count']/res['total_matched']*100:.1f}%)")
    
    print("\nTop 15 Mismatch Patterns (Asset File -> Fund File):")
    sorted_patterns = sorted(res['patterns'].items(), key=lambda x: x[1], reverse=True)
    for (a, f), count in sorted_patterns[:15]:
        print(f"- {a} -> {f}: {count}")

    print("\nMismatch Rate by Asset Category (Asset File):")
    category_mismatches = {}
    for (a, f), count in res['patterns'].items():
        category_mismatches[a] = category_mismatches.get(a, 0) + count
        
    for cat, total in sorted(res['asset_counts'].items(), key=lambda x: x[1], reverse=True):
        miss = category_mismatches.get(cat, 0)
        rate = (miss / total * 100) if total > 0 else 0
        print(f"- {cat}: {miss}/{total} ({rate:.1f}%)")
