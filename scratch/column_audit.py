import pandas as pd
import os

def analyze_columns():
    excel_path = '_archive/펀드 AUM 관리_20260112.xlsx'
    df = pd.read_excel(excel_path, header=0)
    
    print("--- Detailed Numeric Column Audit ---")
    for i in range(11, 21):
        col_data = pd.to_numeric(df.iloc[1:, i], errors='coerce')
        s = col_data.sum()
        col_name = str(df.columns[i]).replace('\n', ' ')
        print(f"Column [{i}] ({col_name}): {s:,.0f}")
        
    # Summary of totals from the actual 'Total' row (377)
    total_row = df.iloc[-1]
    print("\n--- Summary Row Values (Row 377) ---")
    for i in [11, 13, 15, 16, 17, 20]:
        val = total_row.iloc[i]
        print(f"Column [{i}]: {val}")

if __name__ == "__main__":
    analyze_columns()
