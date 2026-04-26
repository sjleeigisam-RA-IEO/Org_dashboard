import pandas as pd
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

def thorough_validation():
    files = {
        '펀드관리': '_archive/펀드 관리_20260424.xlsx',
        '대주조회': '_archive/대주 정보 조회_20260424.xlsx',
        '수익자조회': '_archive/수익자 정보 조회_20260331.xlsx',
        '자산조회': '_archive/투자 자산 조회_20260424.xlsx',
        'AUM관리': '_archive/펀드 AUM 관리_20260112.xlsx'
    }
    
    master_map = {} # fund_id -> {source: name}
    
    print("--- Reading and Cross-Referencing Files ---")
    for name, path in files.items():
        try:
            # Excel usually doesn't need encoding param, but let's ensure strings are handled
            df = pd.read_excel(path)
            
            # Find fund_id and short_name columns
            f_id_col = None
            f_name_col = None
            for c in df.columns:
                c_str = str(c)
                if '펀드코드' in c_str: f_id_col = c
                if '약칭' in c_str or '펀드명' in c_str or '자산명' in c_str: f_name_col = c
            
            if not f_id_col: f_id_col = df.columns[0]
            if not f_name_col: f_name_col = df.columns[1] if len(df.columns) > 1 else df.columns[0]
            
            for _, row in df.iterrows():
                fid = str(row[f_id_col]).strip()
                fname = str(row[f_name_col]).strip()
                if not fid or fid == 'nan' or len(fid) < 3: continue
                
                if fid not in master_map: master_map[fid] = {}
                master_map[fid][name] = fname
                
        except Exception as e:
            print(f"Error reading {name}: {e}")

    # Identify Mismatches
    mismatches = []
    for fid, names in master_map.items():
        unique_names = set(names.values())
        if len(unique_names) > 1:
            mismatches.append({
                "fund_id": fid,
                "names": names
            })

    print(f"\n--- Validation Result ---")
    print(f"Total Unique IDs checked: {len(master_map)}")
    print(f"Name Mismatches found: {len(mismatches)}")
    
    if len(mismatches) > 0:
        print("\n[!] Conflict Examples:")
        for m in mismatches[:10]:
            print(f"ID: {m['fund_id']}")
            for src, n in m['names'].items():
                print(f"  - {src}: {n}")

    # Special Check for P00030 (The one user mentioned)
    if 'P00030' in master_map:
        print(f"\n--- Special Audit: P00030 ---")
        for src, n in master_map['P00030'].items():
            print(f"Source [{src}]: {n}")

if __name__ == "__main__":
    thorough_validation()
