import pandas as pd

def find_value_in_csv():
    df = pd.read_csv('_archive/Project & Mission_all.csv', encoding='utf-8-sig')
    target = 'P00030'
    for col in df.columns:
        if df[col].astype(str).str.contains(target).any():
            print(f"FOUND: Column '{col}' contains {target}")
            return col
    print(f"{target} not found in any column.")
    return None

if __name__ == "__main__":
    find_value_in_csv()
