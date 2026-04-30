import sys
import json
import urllib.request
import urllib.parse
import argparse
import os

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "notion_config.json")

def load_config():
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: {CONFIG_FILE} not found.")
        sys.exit(1)

def request_notion(endpoint, method="GET", data=None, api_key=None):
    url = f"https://api.notion.com/v1/{endpoint}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28"
    }
    
    req_body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=req_body, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"HTTPError: {e.read().decode('utf-8')}")
        sys.exit(1)

def upload_content(api_key, page_id, title, content):
    # Split content if it's too long, but for simplicity we take first 2000 chars as a single block here.
    # A full tool could split into multiple text blocks.
    data = {
        "parent": { "page_id": page_id },
        "properties": {
            "title": { "title": [ { "text": { "content": title } } ] }
        },
        "children": [
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [ { "type": "text", "text": { "content": content[:2000] } } ]
                }
            }
        ]
    }
    res = request_notion("pages", "POST", data, api_key)
    print(f"Success! Page created with ID: {res['id']}")

def search_notion(api_key, query=None):
    data = {}
    if query:
        data["query"] = query
    res = request_notion("search", "POST", data, api_key)
    results = res.get("results", [])
    print(f"Found {len(results)} accessible pages/databases.")
    for r in results:
        obj_type = r.get("object")
        r_id = r.get("id")
        title = "Untitled"
        
        # Try retrieving title properties based on object type
        if "properties" in r:
            prop = r["properties"]
            if "title" in prop and isinstance(prop["title"], dict) and "title" in prop["title"]: # standard page
                 try: title = prop["title"]["title"][0]["text"]["content"]
                 except: pass
            elif "Name" in prop and "title" in prop["Name"]: # databases usually use 'Name'
                 try: title = prop["Name"]["title"][0]["text"]["content"]
                 except: pass
                 
        print(f"[{obj_type}] {title} (ID: {r_id})")

def read_page(api_key, page_id):
    res = request_notion(f"blocks/{page_id}/children", "GET", None, api_key)
    blocks = res.get("results", [])
    print(f"--- Content of Page ID {page_id} ---")
    for b in blocks:
        b_type = b.get("type")
        if b_type in b:
            rich_texts = b[b_type].get("rich_text", [])
            text = "".join([rt["text"]["content"] for rt in rich_texts if "text" in rt])
            if text.strip():
                print(f"[{b_type}] {text}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Notion Agent Tool - CLI for interacting with Notion")
    parser.add_argument("--action", choices=["upload", "search", "read"], required=True)
    parser.add_argument("--page_id", help="Target page ID for upload or read")
    parser.add_argument("--title", help="Title for the uploaded page")
    parser.add_argument("--content", help="Content to upload")
    parser.add_argument("--query", help="Search query")
    
    args = parser.parse_args()
    config = load_config()
    api_key = config.get("NOTION_API_KEY")
    
    if args.action == "upload":
        p_id = args.page_id or config.get("DEFAULT_TARGET_PAGE_ID")
        upload_content(api_key, p_id, args.title or "새 문서", args.content or "")
    elif args.action == "search":
        search_notion(api_key, args.query)
    elif args.action == "read":
        read_page(api_key, args.page_id)
