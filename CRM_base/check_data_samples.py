import pandas as pd
import sys
from pathlib import Path

SOURCE_DIR = Path(r'd:\Project\00. 2025 RA 기획추진\RA dashboard\DB sources')

try:
    df_fund = pd.read_excel(SOURCE_DIR / '펀드 관리_20260515.xlsx')
    df_asset = pd.read_excel(SOURCE_DIR / '투자 자산 관리_20260515.xlsx')
    
    output = []
    output.append("--- 펀드 관리 주요 컬럼 샘플 ---")
    output.append(f"펀드형태: {df_fund['펀드형태'].unique()[:10].tolist()}")
    output.append(f"개발여부: {df_fund['개발여부'].unique()[:10].tolist()}")
    output.append(f"펀드유형: {df_fund['펀드유형'].unique()[:10].tolist()}")
    
    output.append("\n--- 투자 자산 관리 주요 컬럼 샘플 ---")
    output.append(f"사업단계: {df_asset['사업단계'].unique()[:10].tolist()}")
    output.append(f"기초자산: {df_asset['기초자산'].unique()[:10].tolist()}")
    output.append(f"재간접투자유형: {df_asset['재간접투자유형'].unique()[:10].tolist()}")
    
    sys.stdout.buffer.write("\n".join(output).encode('utf-8'))
except Exception as e:
    print(f"Error: {e}")
