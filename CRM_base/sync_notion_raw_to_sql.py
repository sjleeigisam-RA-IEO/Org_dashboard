import json
import urllib.request
import urllib.error
import os
import re
from datetime import datetime, timedelta
from dotenv import dotenv_values
from supabase import create_client

# 1. 설정 로드
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "notion_config.json")
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

env_path = '.env' if os.path.exists('.env') else '../.env'
cfg = dotenv_values(env_path)
supabase = create_client(cfg['SUPABASE_URL'], cfg['SUPABASE_KEY'])

NOTION_HEADERS = {
    "Authorization": f"Bearer {config['NOTION_API_KEY']}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

TASK_KEYWORDS = [
    '대출', '이자', '리파이낸싱', '금리', '담보', '약정', '인출', '상환', '자금집행', 'PF', '리츠', '배당',
    '설계', '시공', '인허가', '착공', '준공', '분양', '임대', '매각', '매입', '수주', '실사', '답사', '매매',
    '운용', '관리', '보고', '감사', '공시', '평가', '청산', '해지', '설정', '화재', '보험', '수선',
    '계약', '협의', '검토', '승인', '자문', '법무', '공증', '이사회', '주총', '날인'
]

def notion_api(endpoint, method="POST", data=None):
    url = f"https://api.notion.com/v1/{endpoint}"
    if method == "POST" and data is None:
        data = {}
    req_body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=req_body, headers=NOTION_HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode()
        print(f"Notion API Error: {e.code} - {err_msg}")
        raise e

def parse_t5t_blocks(blocks):
    items = []
    current_item = None
    for block in blocks:
        btype = block.get("type")
        text = ""
        if btype == "paragraph":
            text = "".join([t["plain_text"] for t in block["paragraph"].get("rich_text", [])])
        elif btype == "bulleted_list_item":
            text = "".join([t["plain_text"] for t in block["bulleted_list_item"].get("rich_text", [])])
        elif btype == "callout":
            text = "".join([t["plain_text"] for t in block["callout"].get("rich_text", [])])
        
        if not text.strip(): continue
        if "[" in text and "T" in text and "]" in text:
            if current_item and current_item.get("text"): items.append(current_item)
            current_item = {"no": len(items)+1, "text": "", "project": "", "stakeholder": ""}
            continue
        if not current_item: continue
        if "내용 :" in text or "내용:" in text: current_item["text"] = text.split("내용")[-1].strip(": ").strip()
        elif "관련 프로젝트 :" in text or "관련 프로젝트:" in text: current_item["project"] = text.split("관련 프로젝트")[-1].strip(": ").strip()
        elif "상대방 :" in text or "상대방:" in text: current_item["stakeholder"] = text.split("상대방")[-1].strip(": ").strip()
        else: current_item["text"] += " " + text.strip()
    if current_item and current_item.get("text"): items.append(current_item)
    return items

def run_sync():
    print(f"--- Fetching Master Data ---")
    proj_res = supabase.table('projects').select('project_id, project_name').execute()
    fund_res = supabase.table('funds').select('fund_id, fund_name, short_name, asset_name').execute()
    cp_res = supabase.table('counterparties').select('counterparty_id, name').execute()
    staff_res = supabase.table('staff').select('staff_id, name, email').execute()
    
    new_proj_notion = notion_api(f"databases/{config['NEW_PROJECT_DB_ID']}/query")
    new_proj_list = []
    for p in new_proj_notion.get("results", []):
        props = p["properties"]
        title_key = next((k for k, v in props.items() if v.get("id") == "title"), None)
        if title_key and props[title_key].get("title"):
            new_proj_list.append(props[title_key]["title"][0]["plain_text"])

    masters = {
        'projects': proj_res.data,
        'funds': fund_res.data,
        'new_projects': new_proj_list,
        'counterparties': sorted(cp_res.data, key=lambda x: len(x['name']), reverse=True),
        'staff_map': {s['email'].lower(): s['staff_id'] for s in staff_res.data if s.get('email')}
    }

    print(f"--- Fetching Raw Submissions ({config['RAW_T5T_DB_ID']}) ---")
    raw_pages = notion_api(f"databases/{config['RAW_T5T_DB_ID']}/query", data={"page_size": 20})
    
    for page in raw_pages.get("results", []):
        pid = page["id"]
        props = page["properties"]
        
        email = None
        for k in ["이메일", "Email", "email"]:
            if k in props and props[k].get("email"):
                email = props[k]["email"]
                break
        
        date_val = None
        for k in ["Date", "날짜", "작성일"]:
            if k in props and props[k].get("date"):
                date_val = props[k]["date"]["start"]
                break
        
        staff_id = masters['staff_map'].get(email.lower()) if email else None
        line = "N/A"
        for k in ["Line", "소속", "라인"]:
            if k in props and props[k].get("select"):
                line = props[k]["select"]["name"]
                break
        
        # 1. 부모 데이터(Submission) 적재 - 컬럼명 보정
        sub_data = {
            'submission_id': pid,
            'writer_staff_id': staff_id,
            'submitted_at': date_val + "T09:00:00Z" if date_val else datetime.now().isoformat(),
            'work_date': date_val,
            'writer_name': email.split("@")[0] if email else "Unknown",
            'writer_email': email,
            'line': line,
            'source_file': 'Notion-Raw-T5T'
        }
        supabase.table('t5t_form_submissions').upsert(sub_data).execute()
        
        print(f"Processing: {email} / {date_val}")
        blocks = notion_api(f"blocks/{pid}/children?page_size=100", method="GET")
        parsed_items = parse_t5t_blocks(blocks.get("results", []))
        
        for item in parsed_items:
            raw_text = f"{item['text']} {item['project']} {item['stakeholder']}"
            matched_project_id = None
            matched_fund_id = None
            match_source = "none"

            for p in masters['projects']:
                if (item['project'] and p['project_name'] in item['project']) or (p['project_name'] in item['text']):
                    matched_project_id = p['project_id']
                    match_source = "sql_project"
                    break
            
            if not matched_project_id:
                # 펀드 매칭 시, 단순 포함(in)이 아니라 숫자가 포함된 경우 숫자가 정확히 일치하는지 확인
                def is_precise_match(pattern, target):
                    if not pattern or not target: return False
                    if pattern not in target: return False
                    # 숫자가 포함된 경우 (예: 451호 vs 1호)
                    p_nums = re.findall(r'(\d+)', pattern)
                    t_nums = re.findall(r'(\d+)', target)
                    if p_nums:
                        # 패턴에 숫자가 있다면, 그 숫자 중 하나라도 타겟의 숫자 목록에 정확히 있어야 함
                        # 또한 타겟에 더 큰 숫자가 포함되어 패턴의 숫자가 그 일부라면 무시해야 함 (1호 in 451호 방지)
                        for p_num in p_nums:
                            if p_num in t_nums: return True
                        return False
                    return True # 숫자가 없는 경우 기존처럼 포함 여부로 판단

                for f in masters['funds']:
                    for key in ['fund_name', 'short_name', 'asset_name']:
                        val = f[key]
                        if not val: continue
                        
                        # "1호", "2호" 같이 너무 짧은 이름은 단독 매칭에서 제외 (과잉 매칭 방지)
                        if len(val.strip()) <= 3 and val.strip().endswith("호"):
                            continue

                        if is_precise_match(val, item['project'] or "") or is_precise_match(val, item['text']):
                            matched_fund_id = f['fund_id']
                            match_source = "sql_fund"
                            break
                    if matched_fund_id: break

            if not matched_project_id and not matched_fund_id:
                for np in masters['new_projects']:
                    if (item['project'] and np in item['project']) or (np in item['text']):
                        match_source = "notion_new"
                        break

            matched_cps = [cp for cp in masters['counterparties'] if cp['name'] in raw_text and len(cp['name']) > 1]
            tokens = [kw for kw in TASK_KEYWORDS if kw in raw_text]
            cp_names = ", ".join([c['name'] for c in matched_cps])
            summary = f"[{cp_names}] {', '.join(tokens)} 관련" if cp_names else f"{', '.join(tokens)} 관련 업무"
            
            item_data = {
                'form_item_id': f"notion-{pid}-{item['no']}",
                'submission_id': pid,
                'item_no': item['no'],
                'writer_staff_id': staff_id,
                'work_date': date_val,
                'line': line,
                'raw_text': raw_text,
                'project_text': item['project'],
                'matched_project_id': matched_project_id,
                'matched_fund_id': matched_fund_id,
                'classification_summary': summary,
                'classification_tokens': tokens,
                'stakeholder_ids': [c['counterparty_id'] for c in matched_cps],
                'task_type': 'Project' if match_source != "none" else 'General',
                'match_status': 'matched' if match_source != "none" else 'raw_unmatched',
                'metadata': {'match_source': match_source, 'notion_page_id': pid}
            }
            supabase.table('t5t_form_items').upsert(item_data).execute()

    print("Sync Complete!")

if __name__ == "__main__":
    run_sync()
