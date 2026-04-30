import pandas as pd
import sys

sys.stdout = open('scratch/pandas_hex.txt', 'w', encoding='utf-8')

file_path = 'D:/Project/00. 2025 RA 기획추진/03. 부문 내 업무/00. 부문데이터/업무시스템/raw/CRM_base/_archive/[new]펀드 관리_20260428.xlsx'
df = pd.read_excel(file_path, header=None)
row0 = df.iloc[0].astype(str).tolist()
row1 = df.iloc[1].astype(str).tolist()

print("--- Row 0 (Header) ---")
for i, s in enumerate(row0):
    if i >= 35 and i <= 45:
        print(f"{i}: {s} | {s.encode('utf-16le').hex()}")

print("\n--- Row 1 (Data) ---")
for i, s in enumerate(row1):
    if i >= 35 and i <= 45:
        print(f"{i}: {s} | {s.encode('utf-16le').hex()}")
