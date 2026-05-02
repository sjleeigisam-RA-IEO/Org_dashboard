import pandas as pd
import os
from datetime import datetime, timedelta
from dotenv import dotenv_values
from supabase import create_client

# 설정 및 초기화
env_path = '.env' if os.path.exists('.env') else '../.env'
cfg = dotenv_values(env_path)
supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

CSV_PATH = '../t5t-dashboard/IGIS RA T-5-T Forms_Submissions_2026-05-01.csv'

# 부동산/금융/운용 전문 키워드 풀
TASK_KEYWORDS = [
    '대출', '이자', '리파이낸싱', '금리', '담보', '약정', '인출', '상환', '자금집행', 'PF', '리츠', '배당',
    '설계', '시공', '인허가', '착공', '준공', '분양', '임대', '매각', '매입', '수주', '실사', '답사', '매매',
    '운용', '관리', '보고', '감사', '공시', '평가', '청산', '해지', '설정', '화재', '보험', '수선',
    '계약', '협의', '검토', '승인', '자문', '법무', '공증', '이사회', '주총', '날인'
]

def get_meeting_monday(dt):
    days_until_monday = (7 - dt.weekday()) % 7
    return dt + timedelta(days=days_until_monday)

def run_full_ingest():
    print(f"--- Fetching Master Data ---")
    proj_res = supabase.table('projects').select('project_id, project_name').execute()
    fund_res = supabase.table('funds').select('fund_id, fund_name, short_name, asset_name').execute()
    cp_res = supabase.table('counterparties').select('counterparty_id, name').execute()
    staff_res = supabase.table('staff').select('staff_id, name, email').execute()
    
    masters = {
        'projects': proj_res.data,
        'funds': fund_res.data,
        'counterparties': sorted(cp_res.data, key=lambda x: len(x['name']), reverse=True),
        'staff': pd.DataFrame(staff_res.data)
    }
    
    proj_name_map = {p['project_name']: p['project_id'] for p in masters['projects']}
    fund_name_map = {}
    for f in masters['funds']:
        if f['fund_name']: fund_name_map[f['fund_name']] = f['fund_id']
        if f['short_name']: fund_name_map[f['short_name']] = f['fund_id']
        if f['asset_name']: fund_name_map[f['asset_name']] = f['fund_id']

    print(f"--- Loading CSV ---")
    df = pd.read_csv(CSV_PATH, encoding='utf-8-sig')
    df.columns = [c.strip() for c in df.columns]
    print(f"Total rows to process: {len(df)}")

    submission_batch = []
    item_batch = []

    for idx, row in df.iterrows():
        sub_id = str(row['Submission ID'])
        submitted_at = pd.to_datetime(row['Submitted at'])
        meeting_monday = get_meeting_monday(submitted_at).date()
        
        email = str(row['E-mail'])
        staff_match = masters['staff'][masters['staff']['email'] == email]
        staff_id = staff_match['staff_id'].values[0] if not staff_match.empty else None
        
        submission_batch.append({
            'submission_id': sub_id,
            'respondent_id': str(row['Respondent ID']),
            'submitted_at': submitted_at.isoformat(),
            'writer_staff_id': staff_id,
            'writer_name': row['이름(Name)'],
            'writer_email': email,
            'position': row['직책(Position)'],
            'work_date': row['작성일(Date)'],
            'line': row['소속(Line)'],
            'source_file': os.path.basename(CSV_PATH)
        })

        for i in range(1, 6):
            text_col = f'T5T - {i}'
            raw_text = str(row.get(text_col, ""))
            if not raw_text or raw_text == 'nan' or len(raw_text) < 2: continue
            
            matched_project_id = None
            matched_fund_id = None
            proj_col = f'관련 프로젝트명을 입력하세요.(선택){" (" + str(i) + ")" if i > 1 else ""}'
            input_proj = str(row.get(proj_col, ""))
            
            for name, pid in proj_name_map.items():
                if (input_proj and name in input_proj) or (name in raw_text and len(name) > 1):
                    matched_project_id = pid
                    break
            if not matched_project_id:
                for name, fid in fund_name_map.items():
                    if (input_proj and name in input_proj) or (name in raw_text and len(name) > 1):
                        matched_fund_id = fid
                        break
            
            matched_cps = []
            for cp in masters['counterparties']:
                if cp['name'] in raw_text and len(cp['name']) > 1:
                    matched_cps.append(cp)
            
            tokens = [kw for kw in TASK_KEYWORDS if kw in raw_text]
            cp_names = ", ".join([c['name'] for c in matched_cps])
            token_str = ", ".join(tokens)
            
            summary = f"[{cp_names}] {token_str} 관련" if cp_names else f"{token_str} 관련 업무"
            if not tokens and not matched_cps:
                summary = raw_text[:30] + "..."
            
            item_batch.append({
                'form_item_id': f"{sub_id}-{i}",
                'submission_id': sub_id,
                'item_no': i,
                'writer_staff_id': staff_id,
                'work_date': meeting_monday.isoformat(),
                'line': row['소속(Line)'],
                'raw_text': raw_text,
                'project_text': input_proj if input_proj != 'nan' else None,
                'matched_project_id': matched_project_id,
                'matched_fund_id': matched_fund_id,
                'classification_summary': summary,
                'classification_tokens': tokens,
                'stakeholder_ids': list(set([c['counterparty_id'] for c in matched_cps])),
                'task_type': 'Project' if (matched_project_id or matched_fund_id) else 'General',
                'match_status': 'matched' if (matched_project_id or matched_fund_id) else 'raw_unmatched'
            })

        # 안전 적재: 부모(Submissions) 먼저, 그 다음 자식(Items)
        if len(submission_batch) >= 50:
            print(f"Flushing batch at row {idx}...")
            supabase.table('t5t_form_submissions').upsert(submission_batch).execute()
            supabase.table('t5t_form_items').upsert(item_batch).execute()
            submission_batch = []
            item_batch = []

    # 남은 데이터 처리
    if submission_batch:
        supabase.table('t5t_form_submissions').upsert(submission_batch).execute()
    if item_batch:
        supabase.table('t5t_form_items').upsert(item_batch).execute()

    print(f"FULL Ingest Complete! Processed {len(df)} submissions.")

if __name__ == "__main__":
    run_full_ingest()
