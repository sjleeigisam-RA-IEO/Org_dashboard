import pandas as pd
import openpyxl
import os

def fix_mojibake(s):
    if not s or pd.isna(s): return s
    s = str(s)
    # Try common misinterpretations
    encodings = ['latin-1', 'cp1252', 'iso-8859-1']
    for enc in encodings:
        try:
            # Re-encode to bytes using the misread encoding, then decode as CP949
            b = s.encode(enc)
            return b.decode('cp949')
        except:
            continue
    return s

file_path = 'D:/Project/00. 2025 RA 기획추진/03. 부문 내 업무/00. 부문데이터/업무시스템/raw/CRM_base/_archive/[new]펀드 관리_20260428.xlsx'
wb = openpyxl.load_workbook(file_path, data_only=True)
sheet = wb.active

print("--- Header Row (Row 0) Fixed ---")
header = [c.value for c in sheet[1]]
fixed_header = [fix_mojibake(h) for h in header]
for i, h in enumerate(fixed_header):
    if h and ('부문' in h or '조직' in h or '코드' in h):
        print(f"{i}: {h} (Raw: {repr(header[i])})")

print("\n--- Data Row (Row 1) Fixed ---")
data_row = [c.value for c in sheet[2]]
fixed_data = [fix_mojibake(v) for v in data_row]
for i, v in enumerate(fixed_data):
    if v and i in [37, 38, 40, 41]:
        print(f"{i}: {v} (Raw: {repr(data_row[i])})")
