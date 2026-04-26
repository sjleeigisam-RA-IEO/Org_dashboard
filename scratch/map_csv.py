import pandas as pd
import sys
import io

# Force UTF-8 for console output
sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')

def map_csv_columns():
    file_path = '_archive/Project & Mission_all.csv'
    # Try different encodings
    try:
        df = pd.read_csv(file_path, encoding='utf-8-sig')
    except:
        df = pd.read_csv(file_path, encoding='cp949')
        
    print("--- Column Mapping Analysis ---")
    for col in df.columns:
        unique_vals = df[col].dropna().unique()[:5]
        print(f"[{col}]: {unique_vals}")

if __name__ == "__main__":
    map_csv_columns()
