import pandas as pd
import os

# Files
file_latest = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 조회_20260428.xlsx"
file_mgmt = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 관리_20260428.xlsx"
file_old = r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\투자 자산 조회_20260427.xlsx"

def cross_check():
    if not all(os.path.exists(f) for f in [file_latest, file_mgmt, file_old]):
        print("Missing files.")
        return

    # 1. Load Latest (Base)
    df_latest = pd.read_excel(file_latest, header=None)
    # fid:0, name:6, addr:15
    missing = df_latest[df_latest[15].astype(str).str.strip().replace('nan', '') == ''].copy()
    missing_list = []
    for _, row in missing.iterrows():
        fid = str(row[0]).strip()
        name = str(row[6]).strip()
        if fid != 'nan' or name != 'nan':
            missing_list.append({'fid': fid, 'name': name})

    print(f"Total missing in Latest File: {len(missing_list)}")

    # 2. Load Management File for comparison
    df_mgmt = pd.read_excel(file_mgmt, header=None)
    # fid:1, name:2, addr:4
    mgmt_map_id = {}
    mgmt_map_name = {}
    for _, row in df_mgmt.iterrows():
        fid = str(row[1]).strip()
        name = str(row[2]).strip()
        addr = str(row[4]).strip()
        if addr and addr != 'nan':
            if fid != 'nan': mgmt_map_id[fid] = addr
            if name != 'nan': mgmt_map_name[name] = addr

    # 3. Load Old File
    df_old = pd.read_excel(file_old, header=None)
    # fid:0, addr:13
    old_map = {}
    for _, row in df_old.iterrows():
        fid = str(row[0]).strip()
        addr = str(row[13]).strip()
        if addr and addr != 'nan':
            old_map[fid] = addr

    # 4. Perform Cross-Check
    results = []
    for m in missing_list:
        fid = m['fid']
        name = m['name']
        
        found_in_mgmt = mgmt_map_id.get(fid) or mgmt_map_name.get(name)
        found_in_old = old_map.get(fid)
        
        if found_in_mgmt or found_in_old:
            results.append({
                'fid': fid,
                'name': name,
                'mgmt_addr': found_in_mgmt,
                'old_addr': found_in_old
            })

    print(f"Found via Cross-Check: {len(results)}")
    if results:
        import sys
        sys.stdout.reconfigure(encoding='utf-8')
        print("\nRecoverable Items:")
        print("| 펀드코드 | 자산명 | 관리파일 주소 | 과거조회파일 주소 |")
        print("| :--- | :--- | :--- | :--- |")
        for r in results:
            print(f"| {r['fid']} | {r['name']} | {r['mgmt_addr'] or '-'} | {r['old_addr'] or '-'} |")

cross_check()
