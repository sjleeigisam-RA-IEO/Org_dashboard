import os, re, sys
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

# Windows console 한글 설정
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

load_dotenv()
sb = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_KEY'))

res = sb.table('funds').select('fund_id, status, metadata').eq('status', '운용').execute()
snapshot_date = pd.Timestamp('2026-03-31')
dept_stats = {}

for r in res.data:
    meta = r.get('metadata', {})
    aum = float(meta.get('benchmark_aum', 0))
    setup = pd.to_datetime(meta.get('setup_date'), errors='coerce')
    term = pd.to_datetime(meta.get('termination_date'), errors='coerce')
    mat = pd.to_datetime(meta.get('maturity_date'), errors='coerce')
    end = term if not pd.isna(term) else (mat if not pd.isna(mat) else pd.Timestamp('2099-12-31'))
    
    if pd.isna(setup) or setup > snapshot_date or end <= snapshot_date: continue

    raw_dept = str(meta.get('department', '미지정')).strip()
    # 정규화: 숫자 제거 및 큰 틀로 통합
    clean_dept = re.sub(r'\d+', '', raw_dept)
    clean_dept = clean_dept.replace('팀', '').replace('부', '').replace('본부', '').replace('파트', '').strip()
    
    if '투자' in clean_dept: clean_dept += '본부'
    elif '운용' in clean_dept: clean_dept += '본부'
    elif '센터' in clean_dept: pass
    else: clean_dept += '팀/본부'

    if clean_dept not in dept_stats:
        dept_stats[clean_dept] = {'aum': 0, 'count': 0, 'sub_depts': set()}
    
    dept_stats[clean_dept]['aum'] += aum
    dept_stats[clean_dept]['count'] += 1
    dept_stats[clean_dept]['sub_depts'].add(raw_dept)

print('| {:<20} | {:<12} | {:<8} | {:<40}'.format('대조직(큰틀)', 'AUM (조원)', '펀드수', '세부 소속팀'))
print('|' + '-'*22 + '|' + '-'*14 + '|' + '-'*10 + '|' + '-'*40)

sorted_stats = sorted(dept_stats.items(), key=lambda x: x[1]['aum'], reverse=True)
for dept, stats in sorted_stats:
    aum_t = round(stats['aum'] / 1e12, 2)
    sub_list = ', '.join(sorted(list(stats['sub_depts'])))
    print('| {:<20} | {:<12} | {:<8} | {:<40}'.format(dept, str(aum_t), str(stats['count']), sub_list))
