import pandas as pd
import os
import requests

# Supabase Credentials
KEY = "sb_publishable_Eb3TAC7BPbFrv8Odwwjc1g_Vv81Nf4P"
BASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co/rest/v1/fund_assets"
headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

# Excel Files Configuration
# (Path, ID_Col_Idx, Name_Col_Idx, Addr_Col_Idx)
files = [
    (r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 관리_20260428.xlsx", 1, 2, 4),
    (r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]투자 자산 조회_20260428.xlsx", 0, 6, 15),
    (r"d:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\투자 자산 조회_20260427.xlsx", 0, 7, 13)
]

def recover_v2():
    # 1. Fetch missing from DB
    r = requests.get(f"{BASE_URL}?select=fund_id,asset_name&or=(address.is.null,address.eq.)", headers=headers)
    missing_assets = r.json()
    
    print(f"Missing in DB: {len(missing_assets)} assets.")
    
    recovered = {} # (fund_id, asset_name) -> address
    
    # 2. Iterate through files
    for f_path, id_idx, name_idx, addr_idx in files:
        if not os.path.exists(f_path): continue
        print(f"Checking {os.path.basename(f_path)}...")
        try:
            df = pd.read_excel(f_path, header=None)
            for _, row in df.iterrows():
                fid = str(row[id_idx]).strip()
                name = str(row[name_idx]).strip()
                addr = str(row[addr_idx]).strip()
                
                if not addr or addr == 'nan': continue
                
                # Match by fund_id AND asset_name
                for a in missing_assets:
                    m_fid = str(a['fund_id']).strip()
                    m_name = str(a['asset_name']).strip()
                    
                    if (m_fid == fid and m_fid != 'nan') or (m_name == name and m_name != 'nan'):
                        key = (m_fid, m_name)
                        if key not in recovered:
                            recovered[key] = addr
                            
        except Exception as e:
            print(f"Error reading {f_path}: {e}")

    # 3. Report
    print(f"\nRecovery Results (V2):")
    print(f"Total Recovered: {len(recovered)} / {len(missing_assets)}")
    
    if recovered:
        print("\nSample of Recovered Addresses:")
        for (fid, name), addr in list(recovered.items())[:20]:
            print(f"- Fund {fid} | {name} -> {addr}")

recover_v2()
