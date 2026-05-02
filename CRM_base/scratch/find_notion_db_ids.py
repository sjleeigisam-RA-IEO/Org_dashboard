import urllib.request
import json
import os
from dotenv import dotenv_values

env_path = '.env' if os.path.exists('.env') else '../.env'
cfg = dotenv_values(env_path)
NOTION_API_KEY = cfg.get("NOTION_API_KEY") or "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"

HEADERS = {
    "Authorization": f"Bearer {NOTION_API_KEY}",
    "Notion-Version": "2022-06-28"
}

def check_notion_object(oid):
    # 1. DB 인지 확인
    url = f"https://api.notion.com/v1/databases/{oid}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"ID [{oid}] is a DATABASE: '{data.get('title', [{}])[0].get('plain_text', 'Untitled')}'")
            return "DATABASE"
    except Exception as e:
        pass

    # 2. 페이지인지 확인
    url = f"https://api.notion.com/v1/pages/{oid}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"ID [{oid}] is a PAGE")
            return "PAGE"
    except Exception as e:
        print(f"ID [{oid}] NOT FOUND or NO ACCESS ({e})")
    
    return None

if __name__ == "__main__":
    print("Checking New Project Reviews ID...")
    check_notion_object("2f28ced43c478092ae0eef60639f7064")
    print("\nChecking Raw T5T DB ID...")
    check_notion_object("2568ced43c4780648424f8e76efcb0a0")
    print("\nChecking Found DB ID...")
    check_notion_object("3148ced4-3c47-806b-adb5-d390452a6a8e")
