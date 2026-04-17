"""Notion relation이 가리키는 실제 페이지를 조회해서 매핑 테이블 구축"""
import json, urllib.request, sys, time
sys.stdout.reconfigure(encoding='utf-8')

CONFIG_PATH = "../notion_config.json"
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

API_KEY = config["NOTION_API_KEY"]
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
}

def get_page_title(page_id):
    url = f"https://api.notion.com/v1/pages/{page_id}"
    req = urllib.request.Request(url, headers=HEADERS, method="GET")
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        props = data.get("properties", {})
        # Try common title fields
        for key in ["Project & Mission 이름", "프로젝트명", "title", "Name", "이름"]:
            if key in props:
                p = props[key]
                if p.get("type") == "title":
                    texts = p.get("title", [])
                    return "".join([t["text"]["content"] for t in texts if "text" in t])
        return "Untitled"
    except Exception as e:
        return f"Error:{e}"

# Load T5T data
with open("data/t5t_log.json", "r", encoding="utf-8") as f:
    t5t = json.load(f)

# Collect unique relation IDs
pm_rel_ids = set()
new_proj_ids = set()
for e in t5t:
    for r in (e.get("Project & Mission", []) or []):
        pm_rel_ids.add(r)
    for r in (e.get("신규 프로젝트", []) or []):
        new_proj_ids.add(r)

print(f"Unique PM relation IDs to resolve: {len(pm_rel_ids)}")
print(f"Unique 신규프로젝트 relation IDs to resolve: {len(new_proj_ids)}")

# Resolve all IDs
relation_map = {}
all_ids = pm_rel_ids | new_proj_ids
total = len(all_ids)

for i, rid in enumerate(all_ids):
    title = get_page_title(rid)
    relation_map[rid] = title
    print(f"  [{i+1}/{total}] {rid[:12]}... -> {title}")
    time.sleep(0.35)  # Rate limit: ~3 req/s

# Save mapping
with open("data/relation_map.json", "w", encoding="utf-8") as f:
    json.dump(relation_map, f, ensure_ascii=False, indent=2)

print(f"\nSaved {len(relation_map)} mappings to data/relation_map.json")
