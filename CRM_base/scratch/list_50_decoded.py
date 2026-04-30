import pandas as pd
import json
import sys
import argparse

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

parser = argparse.ArgumentParser()
parser.add_argument('--offset', type=int, default=0)
args = parser.parse_args()

df = pd.read_excel(r'd:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\[new]주소_보완_대상_리스트.xlsx')
data = df.iloc[args.offset:args.offset+50].to_dict(orient='records')

def fix_text(s):
    if not s or str(s).lower() == 'nan': return ''
    s = str(s).strip()
    for enc in ['latin-1', 'cp1252']:
        try:
            return s.encode(enc).decode('cp949')
        except: pass
    return s

fixed_data = []
for item in data:
    new_item = {}
    for k, v in item.items():
        new_k = fix_text(k)
        new_v = fix_text(v) if isinstance(v, str) else v
        new_item[new_k] = new_v
    fixed_data.append(new_item)

print(json.dumps(fixed_data, indent=2, ensure_ascii=False))
