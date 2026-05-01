import os
import re
import json
from pathlib import Path
from datetime import datetime
from dotenv import dotenv_values
from supabase import create_client

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"

# NLP Patterns from backfill_classification_tokens.py
LOW_SIGNAL_PATTERNS = [
    re.compile(r"^(진행|협의|검토|논의|준비|추진|대응|보고|확인|작업|정리|공유)(중|중인|중임)$"),
    re.compile(r"^(진행|협의|검토|논의|준비|추진|대응|보고|확인|작업|정리|공유)하고$"),
]
STOPWORDS = {"관련", "진행", "검토", "협의", "대응", "보고", "준비", "업무", "프로젝트", "펀드"}

# Stakeholder keywords (Categories)
STAKEHOLDER_SUFFIXES = ["건설", "건축", "공사", "은행", "증권", "자산운용", "신탁", "법무법인", "회계법인", "본부", "파트너스"]

def get_client():
    cfg = dotenv_values(ENV_PATH)
    return create_client(cfg["SUPABASE_URL"], cfg["SUPABASE_KEY"])

def clean_token(token):
    token = token.strip().lstrip("#").strip()
    # Remove josa (simple version)
    token = re.sub(r"(에서|으로|에게|까지|부터|보다|처럼|의|을|를|이|가|은|는|와|과|도|만)$", "", token)
    return token

def extract_tokens(text):
    if not text: return []
    # Match Korean words (2+ chars) or English words
    matches = re.findall(r"[A-Za-z]{2,}|[가-힣]{2,}", text)
    tokens = []
    seen = set()
    for raw in matches:
        token = clean_token(raw)
        if len(token) < 2 or token in STOPWORDS: continue
        if any(p.fullmatch(token) for p in LOW_SIGNAL_PATTERNS): continue
        
        lowered = token.lower()
        if lowered not in seen:
            seen.add(lowered)
            tokens.append(token)
    return tokens[:15]

def extract_stakeholders(text):
    if not text: return []
    stakeholders = []
    # Simple pattern: Name + Suffix (e.g., 현대건설, 국민은행)
    for suffix in STAKEHOLDER_SUFFIXES:
        pattern = rf"([가-힣A-Za-z0-9]+{suffix})"
        found = re.findall(pattern, text)
        for name in found:
            stakeholders.append({"name": name, "category": suffix})
    return stakeholders

def process_logs():
    client = get_client()
    print("Fetching submitted logs...")
    
    # Get logs that need processing
    result = client.table("t5t_logs").select("*").eq("input_status", "submitted").execute()
    logs = result.data or []
    
    if not logs:
        print("No new logs to process.")
        return

    for log in logs:
        log_id = log["t5t_log_id"]
        raw_text = log["raw_text"]
        print(f"Processing Log: {log_id}")
        
        tokens = extract_tokens(raw_text)
        stakeholders = extract_stakeholders(raw_text)
        
        # 1. Update Log with tokens
        client.table("t5t_logs").update({
            "classification_tokens": tokens,
            "classification_summary": raw_text[:200],
            "input_status": "processed",
            "updated_at": datetime.now().isoformat()
        }).eq("t5t_log_id", log_id).execute()
        
        # 2. Insert Stakeholders
        for s in stakeholders:
            client.table("t5t_log_stakeholders").upsert({
                "stakeholder_id": f"sh_{log_id}_{s['name']}",
                "t5t_log_id": log_id,
                "stakeholder_name": s["name"],
                "role_category": s["category"]
            }).execute()
            
    print(f"Processed {len(logs)} logs.")

if __name__ == "__main__":
    process_logs()
