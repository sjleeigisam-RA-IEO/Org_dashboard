"""
T5T Dashboard - Notion Data Sync Engine
Notion API에서 데이터를 가져와 로컬 JSON 캐시로 저장
"""
import json
import urllib.request
import os
import sys
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

# Config
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "notion_config.json")
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

API_KEY = config["NOTION_API_KEY"]
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

# Database IDs
DB_IDS = {
    "t5t_log": "60881ecb-1653-4bb3-b18d-479cb2603a4d",
    "project_mission": "3258ced4-3c47-8147-b514-f1430fee1f9a",
    "project_master": "ef920219-3626-4e7b-ac48-12b9c14081a7",
    "staff_master": "5d9926ff-981a-49ab-be13-f5594cc23ff0",
    "staff_pm_status": "2988ced4-3c47-803a-919e-f529babec333",
}

SUMMARY_DB_ID = "2158ced4-3c47-8334-badc-812339f5b19e"


def notion_request(endpoint, method="POST", data=None):
    url = f"https://api.notion.com/v1/{endpoint}"
    req_body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=req_body, headers=HEADERS, method=method)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract_property(pval):
    """Notion property 값을 파이썬 값으로 변환"""
    ptype = pval.get("type", "")
    if ptype == "title":
        return "".join([t["text"]["content"] for t in pval.get("title", []) if "text" in t])
    elif ptype == "rich_text":
        return "".join([t["text"]["content"] for t in pval.get("rich_text", []) if "text" in t])
    elif ptype == "select":
        sel = pval.get("select")
        return sel["name"] if sel else None
    elif ptype == "multi_select":
        return [s["name"] for s in pval.get("multi_select", [])]
    elif ptype == "status":
        s = pval.get("status")
        return s["name"] if s else None
    elif ptype == "date":
        d = pval.get("date")
        return d["start"] if d else None
    elif ptype == "url":
        return pval.get("url")
    elif ptype == "checkbox":
        return pval.get("checkbox", False)
    elif ptype == "number":
        return pval.get("number")
    elif ptype == "relation":
        return [r["id"] for r in pval.get("relation", [])]
    elif ptype == "created_time":
        return pval.get("created_time")
    elif ptype == "last_edited_time":
        return pval.get("last_edited_time")
    elif ptype == "unique_id":
        uid = pval.get("unique_id", {})
        return f"{uid.get('prefix', '')}-{uid.get('number', '')}"
    elif ptype == "email":
        return pval.get("email")
    elif ptype == "rollup":
        rollup = pval.get("rollup", {})
        rtype = rollup.get("type", "")
        if rtype == "array":
            arr = rollup.get("array", [])
            results = []
            for item in arr:
                results.append(extract_property(item))
            return results
        elif rtype == "number":
            return rollup.get("number")
        elif rtype == "date":
            d = rollup.get("date")
            return d["start"] if d else None
        return None
    return None


def fetch_all_pages(db_id, page_size=100):
    """DB의 모든 페이지를 페이지네이션으로 수집"""
    all_pages = []
    has_more = True
    start_cursor = None
    
    while has_more:
        payload = {"page_size": page_size}
        if start_cursor:
            payload["start_cursor"] = start_cursor
        
        result = notion_request(f"databases/{db_id}/query", "POST", payload)
        pages = result.get("results", [])
        
        for page in pages:
            props = page.get("properties", {})
            record = {"_id": page["id"]}
            for pname, pval in props.items():
                record[pname] = extract_property(pval)
            all_pages.append(record)
        
        has_more = result.get("has_more", False)
        start_cursor = result.get("next_cursor")
    
    return all_pages


def fetch_latest_summary_blocks():
    """요약본 DB에서 최신 페이지 1개를 찾아 본문(Blocks)을 가져옴"""
    # 1. 최신 페이지 1개 쿼리
    payload = {
        "page_size": 1,
        "sorts": [{"timestamp": "created_time", "direction": "descending"}]
    }
    result = notion_request(f"databases/{SUMMARY_DB_ID}/query", "POST", payload)
    pages = result.get("results", [])
    if not pages:
        return []
    
    page_id = pages[0]["id"]
    
    # 2. 해당 페이지의 자식 블록 가져오기
    blocks = []
    has_more = True
    start_cursor = None
    
    while has_more:
        url = f"blocks/{page_id}/children?page_size=100"
        if start_cursor:
            url += f"&start_cursor={start_cursor}"
        
        res = notion_request(url, "GET")
        blocks.extend(res.get("results", []))
        has_more = res.get("has_more", False)
        start_cursor = res.get("next_cursor")
        
    return blocks


def sync_all():
    """모든 DB 동기화"""
    os.makedirs(DATA_DIR, exist_ok=True)
    
    sync_meta = {"synced_at": datetime.now().isoformat(), "counts": {}}
    
    for name, db_id in DB_IDS.items():
        print(f"Syncing {name}...", end=" ", flush=True)
        try:
            data = fetch_all_pages(db_id)
            filepath = os.path.join(DATA_DIR, f"{name}.json")
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            sync_meta["counts"][name] = len(data)
            print(f"✓ {len(data)} records")
        except Exception as e:
            print(f"✗ Error: {e}")
            sync_meta["counts"][name] = f"ERROR: {str(e)}"
            
    # 요약본 블록 수집 추가
    print("Syncing t5t_summary_blocks...", end=" ", flush=True)
    try:
        blocks = fetch_latest_summary_blocks()
        filepath = os.path.join(DATA_DIR, "summary_blocks.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(blocks, f, ensure_ascii=False, indent=2)
        sync_meta["counts"]["summary_blocks"] = len(blocks)
        print(f"✓ {len(blocks)} blocks")
    except Exception as e:
        print(f"✗ Error: {e}")
        sync_meta["counts"]["summary_blocks"] = f"ERROR: {str(e)}"
    
    # Save sync metadata
    with open(os.path.join(DATA_DIR, "_sync_meta.json"), "w", encoding="utf-8") as f:
        json.dump(sync_meta, f, ensure_ascii=False, indent=2)
    
    print(f"\nSync complete at {sync_meta['synced_at']}")
    return sync_meta


if __name__ == "__main__":
    sync_all()
