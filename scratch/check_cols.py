import pandas as pd
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')

def check_cols():
    lender = pd.read_excel('_archive/대주 정보 조회_20260424.xlsx', header=0)
    print("--- Lender Cols ---")
    for i, c in enumerate(lender.columns):
        if '금액' in str(c) or 'Amt' in str(c) or '원' in str(c):
            print(f"Col {i}: {c}")

    ben = pd.read_excel('_archive/수익자 정보 조회_20260331.xlsx', header=0)
    print("\n--- Ben Cols ---")
    for i, c in enumerate(ben.columns):
        if '금액' in str(c) or 'Amt' in str(c) or '원' in str(c):
            print(f"Col {i}: {c}")

if __name__ == "__main__":
    check_cols()
