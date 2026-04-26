import pandas as pd
import json

def debug_row():
    df = pd.read_csv('_archive/Project & Mission_all.csv', encoding='utf-8-sig')
    target = df[df['Project & Mission 이름'].astype(str).str.contains('427')]
    if not target.empty:
        row_dict = target.iloc[0].dropna().to_dict()
        with open('scratch/row_427.json', 'w', encoding='utf-8') as f:
            json.dump(row_dict, f, ensure_ascii=False, indent=2)
        print("Exported row 427 to scratch/row_427.json")
    else:
        print("No row found with 427")

if __name__ == "__main__":
    debug_row()
