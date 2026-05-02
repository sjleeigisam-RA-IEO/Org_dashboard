import csv
import io
from pathlib import Path
from datetime import datetime
from supabase import create_client
from env_utils import get_required_supabase_config

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
CSV_PATH = ROOT_DIR / "t5t-dashboard" / "IGIS RA T-5-T Forms_Submissions_2026-05-01.csv"

PILOT_MAPPING = {
    "iota-427": ["와이디427", "IOTA427", "YD427"],
    "iota-816": ["와이드816", "IOTA816", "WIDE816"],
    "iota-421f": ["421호", "421호펀드"]
}

def get_client():
    url, key = get_required_supabase_config()
    return create_client(url, key)

def backfill():
    client = get_client()
    print(f"Reading CSV: {CSV_PATH.name}")
    
    text = CSV_PATH.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    
    backfill_count = 0
    for row in reader:
        # Check if 2026
        work_date_str = row.get("ۼ(Date)") or row.get("Date") or ""
        if not work_date_str.startswith("2026"):
            continue
            
        # Check all 5 T5T entries
        for i in range(1, 6):
            t5t_col = f"T5T - {i}"
            proj_col = f" Ʈ Էϼ.()" if i == 1 else f" Ʈ Էϼ.() ({i})"
            
            raw_text = row.get(t5t_col)
            proj_text = row.get(proj_col)
            
            if not raw_text or not proj_text: continue
            
            # Match with Pilot Projects
            matched_id = None
            for pid, keywords in PILOT_MAPPING.items():
                if any(k.lower() in proj_text.lower() or k.lower() in raw_text.lower() for k in keywords):
                    matched_id = pid
                    break
            
            if matched_id:
                log_id = f"csv_2026_{row['Submission ID']}_{i}"
                print(f"Found Pilot Match: {proj_text} -> {matched_id}")
                
                # Insert Log
                client.table("t5t_logs").upsert({
                    "t5t_log_id": log_id,
                    "writer_name": row.get("̸(Name)"),
                    "work_date": work_date_str,
                    "raw_text": raw_text,
                    "summary": raw_text[:100],
                    "input_status": "submitted", # Set to submitted so analysis engine picks it up
                    "source_system": "csv_backfill_2026"
                }).execute()
                
                # Link Project
                client.table("t5t_log_project_links").upsert({
                    "link_id": f"link_{log_id}",
                    "t5t_log_id": log_id,
                    "project_id": matched_id,
                    "relation_type": "backfill_match"
                }).execute()
                
                backfill_count += 1
                
    print(f"Backfilled {backfill_count} items for pilot projects.")

if __name__ == "__main__":
    backfill()
