import pandas as pd
excel_path = r"D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]펀드 관리_20260428.xlsx"
df0 = pd.read_excel(excel_path, header=0)
df1 = pd.read_excel(excel_path, header=1)

print("Header 0 columns:")
print(df0.columns.tolist()[35:45])

print("\nHeader 1 columns:")
print(df1.columns.tolist()[35:45])
