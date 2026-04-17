import json, sys
sys.stdout.reconfigure(encoding='utf-8')

with open('data/t5t_log.json','r',encoding='utf-8') as f:
    t5t = json.load(f)
with open('data/project_mission.json','r',encoding='utf-8') as f:
    pm = json.load(f)

# Check ID formats
print('=== T5T relation IDs (first 5 with PM links) ===')
count = 0
for e in t5t:
    rels = e.get('Project & Mission', [])
    if rels:
        print(f'  T5T rel: {rels[0]}')
        count += 1
        if count >= 5: break

print()
print('=== PM _id samples (first 5) ===')
for p in pm[:5]:
    print(f'  PM id: {p["_id"]}  name: {p.get("Project & Mission 이름","?")}')

# Check match
pm_ids = set(p['_id'] for p in pm)
t5t_rel_ids = set()
for e in t5t:
    for r in (e.get('Project & Mission',[]) or []):
        t5t_rel_ids.add(r)

matched = t5t_rel_ids & pm_ids
print(f'\nT5T unique PM refs: {len(t5t_rel_ids)}')
print(f'PM total entries: {len(pm_ids)}')
print(f'Matched: {len(matched)}')
print(f'Unmatched refs: {len(t5t_rel_ids - pm_ids)}')

unmatched = list(t5t_rel_ids - pm_ids)[:5]
for uid in unmatched:
    print(f'  Unmatched ID: {uid}')

# Also check 신규 프로젝트 relations
with open('data/project_master.json','r',encoding='utf-8') as f:
    pmaster = json.load(f)

pm_master_ids = set(p['_id'] for p in pmaster)
new_proj_ids = set()
for e in t5t:
    for r in (e.get('신규 프로젝트',[]) or []):
        new_proj_ids.add(r)

print(f'\nT5T 신규프로젝트 refs: {len(new_proj_ids)}')
print(f'프로젝트마스터 entries: {len(pm_master_ids)}')
matched2 = new_proj_ids & pm_master_ids
print(f'Matched: {len(matched2)}')
