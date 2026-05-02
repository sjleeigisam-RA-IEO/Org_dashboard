import os
from supabase import create_client
from dotenv import load_dotenv
from collections import Counter
import re

import sys
import io

load_dotenv()
sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding = 'utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.detach(), encoding = 'utf-8')

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")
supabase = create_client(url, key)

def analyze():
    print("Fetching 'Other' logs...")
    # '기타'로 매핑된 로그들을 가져오기 위해 전수 조사 (서버 로직과 동일하게 구현)
    # 실제로는 detectCategory 로직을 파이썬으로 재현하여 분류되지 않는 것들을 찾음
    
    res = supabase.table("t5t_form_items").select("raw_text, classification_summary").execute()
    logs = res.data
    
    # 현재 JS에 정의된 키워드들 (이것들에 걸리지 않는 것들을 찾아야 함)
    existing_keywords = [
        "매각", "매입", "입찰", "우협", "클로징", "계약", "SPA", "MOU", "LOI",
        "PF", "리파이낸싱", "대출", "담보", "브릿지", "선순위", "후순위", "LTV",
        "인허가", "건축허가", "심의", "민원", "설계", "착공",
        "임대차", "재계약", "공실", "임차인", "운용보고", "보험", "CapEx",
        "소송", "분쟁", "법무", "EOD", "경매",
        "IR", "RFP", "PT", "사이트투어", "탭핑", "투자자"
    ]
    
    others = []
    for log in logs:
        text = (log.get("classification_summary") or "") + (log.get("raw_text") or "")
        matched = False
        for kw in existing_keywords:
            if kw in text:
                matched = True
                break
        if not matched:
            others.append(text)
            
    print(f"Found {len(others)} unidentified logs.")
    
    # 명사 위주 키워드 추출 (간이)
    words = []
    for text in others:
        # 2글자 이상의 한글 단어 추출
        found = re.findall(r'[가-힣]{2,}', text)
        words.extend(found)
        
    # 불용어 제외
    stop_words = ["있음", "진행", "예정", "확인", "검토", "협의", "관리", "보고", "관련", "사항", "논의", "완료", "대해", "업무"]
    filtered_words = [w for w in words if w not in stop_words]
    
    common = Counter(filtered_words).most_common(50)
    print("\n[Top Keywords in 'Others']")
    for word, count in common:
        print(f"{word}: {count}")

if __name__ == "__main__":
    analyze()
