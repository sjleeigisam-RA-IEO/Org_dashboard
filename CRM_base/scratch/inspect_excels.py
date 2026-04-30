import os
import pandas as pd
import json

archive_path = r"D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive"

def inspect_files():
    files = [f for f in os.listdir(archive_path) if f.startswith('[new]') and f.endswith('20260428.xlsx')]
    print(f"Found files: {files}")
    
    results = {}
    for f in files:
        full_path = os.path.join(archive_path, f)
        print(f"\n--- Inspecting: {f} ---")
        try:
            df = pd.read_excel(full_path)
            print(f"Columns: {df.columns.tolist()}")
            print(f"Head:\n{df.head(2)}")
            results[f] = {
                "columns": df.columns.tolist(),
                "head": df.head(2).to_dict(orient='records')
            }
        except Exception as e:
            print(f"Error reading {f}: {e}")
    
    # Save a summary to a scratch file for the assistant to read
    with open('inspect_results.json', 'w', encoding='utf-8') as jf:
        json.dump(results, jf, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    inspect_files()
