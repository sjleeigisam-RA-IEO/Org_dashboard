import sys
import os
sys.path.insert(0, os.getcwd())
from processor import CRMProcessor
import pandas as pd

p = CRMProcessor('.', 'mapping.json')
df = p.process_fund_management()
print(f"File: {p.get_latest_file('*펀드 관리_*.xlsx')}")
print(f"Total Funds: {len(df)}")
if 'notion_division_class' in df.columns:
    subset = df[['fund_id', 'notion_division_class', 'notion_dept_class']].dropna(subset=['notion_division_class'])
    print(f"Funds with Division: {len(subset)}")
    print(subset.head())
else:
    print("Column 'notion_division_class' missing!")
