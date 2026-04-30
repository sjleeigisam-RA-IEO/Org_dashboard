import pandas as pd
excel_path = r"D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. 부문데이터\업무시스템\raw\CRM_base\_archive\[new]펀드 관리_20260428.xlsx"
df = pd.read_excel(excel_path, header=0)

row_112001 = df[df.iloc[:, 0].astype(str) == '112001']
print("Record 112001 values:")
for i in range(35, 45):
    print(f"Index {i} ({df.columns[i]}): {row_112001.iloc[0, i]}")
