import pandas as pd
import re

def discover_fund_id_col():
    df = pd.read_csv('_archive/Project & Mission_all.csv', encoding='utf-8-sig')
    
    pattern = re.compile(r'^\d{6}$')
    
    for col in df.columns:
        # Check first 500 rows for 6-digit IDs
        matches = df[col].astype(str).str.match(pattern).sum()
        if matches > 10:
            print(f"FOUND: Column '{col}' has {matches} matches for 6-digit IDs.")
            print(f"Sample: {df[df[col].astype(str).str.match(pattern)][col].head(5).tolist()}")
            return col
    
    print("No 6-digit ID column found.")
    return None

if __name__ == "__main__":
    discover_fund_id_col()
