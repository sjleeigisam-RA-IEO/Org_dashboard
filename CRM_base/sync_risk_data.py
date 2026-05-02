import os
import json
import re
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables from the root .env
dotenv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '.env'))
load_dotenv(dotenv_path)

def extract_risk_index(text):
    match = re.search(r'위험관리계수[:\s]*([\d.]+)', text)
    if match:
        return float(match.group(1))
    return None

def extract_extension_count(text):
    match = re.search(r'(\d+)회', text)
    if match:
        return int(match.group(1))
    return 0

def parse_development_risks(content, mapping):
    results = []
    # 1. Parse Index (Page 1) to get risk indices
    index_page = re.search(r'===== PAGE 1 =====(.*?)(===== PAGE 2 =====|$)', content, re.DOTALL)
    dev_indices = {}
    if index_page:
        index_text = index_page.group(1)
        # Match pattern: "Project Name (위험관리계수: 5.00)"
        items = re.findall(r'- p\.\d+\s+(.*?)\s*\(.*?위험관리계수[:\s]*([\d.]+)\)', index_text)
        for name, idx in items:
            dev_indices[name.strip()] = float(idx)

    # 2. Parse Details
    for i, m in enumerate(mapping):
        name = m['pdf_name']
        start_page = m['start_page']
        
        # Find section for this project: (1) Name ... (2) NextName
        pattern = rf'\({i+1}\)\s*{re.escape(name)}.*?(?=\n\(\d+\)|===== PAGE {start_page + 4} =====|$)'
        match = re.search(pattern, content, re.DOTALL)
        
        if match:
            project_text = match.group(0)
            # Use index from Page 1 if available, otherwise search in text
            risk_index = dev_indices.get(name) or extract_risk_index(project_text)
            ext_count = extract_extension_count(project_text)
            
            # Special case for extension count from Summary Table (Page 2) if 0 in detail
            if ext_count == 0:
                summary_match = re.search(rf'{re.escape(name[:4])}.*?(\d+)회', content[:1000]) # Quick check in summary
                if summary_match:
                    ext_count = int(summary_match.group(1))

            results.append({
                "project_name": name,
                "fund_id_hint": m['notion_title'],
                "risk_index": risk_index,
                "extension_count": ext_count,
                "raw_text": project_text,
                "details": {
                    "category": "Development",
                    "notion_url": m['notion_url'],
                    "notion_title": m['notion_title']
                }
            })
    return results

def parse_asset_management_risks(content):
    results = []
    # Index on Page 1
    items = re.findall(r'- p\.\d+\s+(이지스\s*\d+호.*?)\s*\(위험관리계수[:\s]*([\d.]+)\)', content)
    
    for full_name, risk_index in items:
        num_match = re.search(r'(\d+)호', full_name)
        fund_num = num_match.group(1) if num_match else None
        
        detail_pattern = rf'\(\d+\)\s*{re.escape(full_name)}.*?(?=\n\(\d+\)|===== PAGE|$)'
        detail_match = re.search(detail_pattern, content, re.DOTALL)
        detail_text = detail_match.group(0) if detail_match else ""
        
        results.append({
            "project_name": full_name,
            "fund_id_hint": fund_num,
            "risk_index": float(risk_index),
            "extension_count": extract_extension_count(detail_text),
            "raw_text": detail_text or full_name,
            "details": {"category": "Asset Management"}
        })
    return results

def parse_global_risks(content):
    results = []
    # Index on Page 1
    items = re.findall(r'-\s+(\d+호.*?)\s*\(.*위험관리계수[:\s]*([\d.]+)\)', content)
    
    for full_name, risk_index in items:
        num_match = re.search(r'^(\d+)', full_name)
        fund_num = num_match.group(1) if num_match else None
        
        detail_pattern = rf'\d+\)\s*{re.escape(full_name)}.*?(?=\n\d+\)|===== PAGE|$)'
        detail_match = re.search(detail_pattern, content, re.DOTALL)
        detail_text = detail_match.group(0) if detail_match else ""

        results.append({
            "project_name": full_name,
            "fund_id_hint": fund_num,
            "risk_index": float(risk_index),
            "extension_count": extract_extension_count(detail_text),
            "raw_text": detail_text or full_name,
            "details": {"category": "Global"}
        })
    return results

def sync():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Error: SUPABASE_URL or SUPABASE_KEY not found in .env")
        return
    
    supabase: Client = create_client(url, key)
    
    base_dir = r"d:\Project\00. 2025 RA 기획추진\RA dashboard\risk_data\26.03"
    
    with open(os.path.join(base_dir, "project_mapping.json"), 'r', encoding='utf-8') as f:
        dev_mapping = json.load(f)
        
    all_data = []
    
    # Development
    dev_path = os.path.join(base_dir, "_extracted_text", "리얼에셋부문 개발사업 리스크현황분석(26.3.31).txt")
    if os.path.exists(dev_path):
        with open(dev_path, 'r', encoding='utf-8') as f:
            all_data.extend(parse_development_risks(f.read(), dev_mapping))
            
    # Asset Management
    am_path = os.path.join(base_dir, "_extracted_text", "리얼에셋부문 자산관리 리스크현황분석(26.3.31).txt")
    if os.path.exists(am_path):
        with open(am_path, 'r', encoding='utf-8') as f:
            all_data.extend(parse_asset_management_risks(f.read()))
            
    # Global
    global_path = os.path.join(base_dir, "_extracted_text", "글로벌자산관리그룹운용펀드리스크현황분석(26.3.31).txt")
    if os.path.exists(global_path):
        with open(global_path, 'r', encoding='utf-8') as f:
            all_data.extend(parse_global_risks(f.read()))

    funds_resp = supabase.table("funds").select("fund_id, fund_name").execute()
    fund_list = funds_resp.data
    
    for item in all_data:
        hint = item['fund_id_hint']
        if not hint:
            continue
            
        match_id = None
        for f in fund_list:
            if hint == f['fund_id'] or hint in f['fund_name'] or f['fund_name'] in hint:
                match_id = f['fund_id']
                break
        
        if not match_id and hint.isdigit():
            for f in fund_list:
                if f' {hint}호' in f['fund_name'] or f'({hint}호)' in f['fund_name'] or f.get('fund_id', '').endswith(hint):
                    match_id = f['fund_id']
                    break
        
        item['fund_id'] = match_id
        if 'fund_id_hint' in item:
            del item['fund_id_hint']
        item['base_date'] = "2026-03-31"

    if all_data:
        try:
            # Delete existing to allow re-run
            supabase.table("risk_management_points").delete().eq("base_date", "2026-03-31").execute()
            
            for i in range(0, len(all_data), 50):
                chunk = all_data[i:i+50]
                supabase.table("risk_management_points").insert(chunk).execute()
            print(f"Successfully uploaded {len(all_data)} records.")
        except Exception as e:
            print(f"Upload failed: {e}")

if __name__ == "__main__":
    sync()
