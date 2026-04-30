import pandas as pd
import sys
import io

# Force UTF-8 for console output to see Korean properly
sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')

def find_columns():
    file_path = '_archive/펀드 AUM 관리_20251224_all.xlsx'
    df = pd.read_excel(file_path, header=0)
    
    print("--- Identifying Column Contents (Top 10 Samples) ---")
    for i in range(11):
        unique_vals = df.iloc[1:20, i].unique()
        print(f"Col [{i}]: {unique_vals}")

if __name__ == "__main__":
    find_columns()
