import urllib.request
import json
import os
import sys
from dotenv import dotenv_values

# 인코딩 설정
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

env_path = '.env' if os.path.exists('.env') else '../.env'
cfg = dotenv_values(env_path)
NOTION_API_KEY = cfg.get("NOTION_API_KEY") or "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"
RAW_DB_ID = "2568ced43c4780648424f8e76efcb0a0"

HEADERS = {
    "Authorization": f"Bearer {NOTION_API_KEY}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

def check_notion_db():
    # 1. 샘플 페이지 1건 쿼리
    url_query = f"https://api.notion.com/v1/databases/{RAW_DB_ID}/query"
    payload = json.dumps({"page_size": 1}).encode("utf-8")
    req_query = urllib.request.Request(url_query, data=payload, headers=HEADERS, method="POST")
    
    with urllib.request.urlopen(req_query) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        if not data.get("results"):
            print("No results found.")
            return
            
        page = data["results"][0]
        page_id = page["id"]
        props = page["properties"]
        
        print(f"--- Page ID: {page_id} ---")
        for pname, pval in props.items():
            # 값 추출 로직 간소화
            val = "N/A"
            ptype = pval.get("type")
            if ptype == "title": val = pval["title"][0]["plain_text"] if pval["title"] else ""
            elif ptype == "email": val = pval["email"]
            elif ptype == "date": val = pval["date"]["start"] if pval["date"] else ""
            elif ptype == "select": val = pval["select"]["name"] if pval["select"] else ""
            elif ptype == "rich_text": val = pval["rich_text"][0]["plain_text"] if pval["rich_text"] else ""
            
            print(f"Prop [{pname}]: {val}")

        # 2. 본문(Blocks) 조회 - 데이터가 본문에 있을 가능성 확인
        print("\n--- Page Blocks (Body Content) ---")
        url_blocks = f"https://api.notion.com/v1/blocks/{page_id}/children?page_size=50"
        req_blocks = urllib.request.Request(url_blocks, headers=HEADERS)
        with urllib.request.urlopen(req_blocks) as resp_b:
            blocks = json.loads(resp_b.read().decode("utf-8")).get("results", [])
            for block in blocks:
                btype = block.get("type")
                content = "N/A"
                if btype == "paragraph":
                    texts = block["paragraph"].get("rich_text", [])
                    content = "".join([t["plain_text"] for t in texts])
                elif btype == "bulleted_list_item":
                    texts = block["bulleted_list_item"].get("rich_text", [])
                    content = "".join([t["plain_text"] for t in texts])
                
                if content != "N/A" and content.strip():
                    print(f"[{btype}]: {content}")

if __name__ == "__main__":
    check_notion_db()
