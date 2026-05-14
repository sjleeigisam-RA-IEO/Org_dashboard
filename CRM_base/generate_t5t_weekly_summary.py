import json
import re
from argparse import ArgumentParser
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from supabase import create_client

from env_utils import get_required_supabase_config
from t5t_classification import effective_match_status
from t5t_classification import effective_task_type


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT_DIR / "t5t-dashboard" / "data" / "weekly_summary.json"
HEADER_RE = re.compile(r"^\s*T5T\s+Contents\s+.+?\s+Director\s+\d{4}\.\d{2}\.\d{2}\s*$", re.IGNORECASE)


CATEGORY_RULES = [
    ("인허가/행정", ["인허가", "허가", "심의", "지구단위", "도시계획", "관청", "구청", "시청", "공유재산", "행정"]),
    ("금융 구조", ["PF", "대주", "대출", "리파이낸싱", "차입", "금리", "트랜치", "신용", "보험", "스왑", "상환"]),
    ("투자자 대응", ["투자자", "수익자", "LP", "GIC", "IR", "마케팅", "펀드레이징", "앵커"]),
    ("상품/구조화", ["펀드", "리츠", "구조", "설정", "블라인드", "SMA", "상품", "출자"]),
    ("자산운영", ["임대", "운영", "관리", "CAPEX", "공사", "tenant", "테넌트", "시설", "운용"]),
    ("리스크/법무", ["소송", "법무", "리스크", "민원", "분쟁", "계약서", "해지", "클레임"]),
    ("딜 진행", ["MOU", "LOI", "실사", "매입", "매각", "입찰", "협상", "협의", "검토", "개발", "프로젝트"]),
    ("전략/기획", ["전략", "기획", "계획", "파이프라인", "시장", "리서치", "보고", "TFT", "TF"]),
]


def parse_date(value):
    if not value:
        return None
    return date.fromisoformat(str(value)[:10])


def reporting_week(ref_date):
    # T5T reporting weeks run Tuesday through Monday, ending on the meeting Monday.
    week_end = ref_date + timedelta(days=(7 - ref_date.weekday()) % 7)
    return week_end - timedelta(days=6), week_end


def fetch_all(client, table, select, date_from, date_to):
    rows = []
    start = 0
    while True:
        end = start + 999
        result = (
            client.table(table)
            .select(select)
            .gte("work_date", date_from.isoformat())
            .lte("work_date", date_to.isoformat())
            .order("work_date", desc=False)
            .range(start, end)
            .execute()
        )
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def fetch_lookup(client, table, select, key):
    rows = []
    start = 0
    while True:
        result = client.table(table).select(select).range(start, start + 999).execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        start += 1000
    return {row.get(key): row for row in rows if row.get(key)}


def classify_issue(row):
    text = " ".join(
        str(row.get(key) or "")
        for key in ["project_text", "raw_text", "classification_summary", "stakeholder_text"]
    )
    for category, needles in CATEGORY_RULES:
        if any(needle.lower() in text.lower() for needle in needles):
            return category
    task_type = effective_task_type(row)
    status = effective_match_status(row)
    if task_type in {"General", "Mission"} or status in {"general_work", "mission"}:
        return "전략/기획" if task_type == "Mission" else "기타"
    return "기타"


def clean_text(value, limit=150):
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def display_project(row, projects, funds):
    if row.get("matched_project_id") in projects:
        return projects[row["matched_project_id"]].get("project_name") or row.get("project_text")
    if row.get("matched_fund_id") in funds:
        fund = funds[row["matched_fund_id"]]
        return fund.get("short_name") or fund.get("fund_name") or row.get("project_text")
    project = clean_text(row.get("project_text"), 60)
    if project and project not in {"-", "미분류", "General", "Mission"}:
        return project
    return "미분류"


def build_summary(rows, staff, projects, funds, week_start, week_end):
    normalized = []
    for row in rows:
        if HEADER_RE.match(row.get("raw_text") or ""):
            continue
        item = dict(row)
        item["writer_name"] = (staff.get(row.get("writer_staff_id")) or {}).get("name") or "미확인"
        item["project_name"] = display_project(row, projects, funds)
        item["issue_category"] = classify_issue(row)
        item["summary_text"] = clean_text(row.get("classification_summary") or row.get("raw_text"), 180)
        normalized.append(item)

    category_counts = Counter(row["issue_category"] for row in normalized)
    project_counts = Counter(row["project_name"] for row in normalized if row["project_name"] != "미분류")
    writer_counts = Counter(row["writer_name"] for row in normalized)

    by_project = defaultdict(list)
    by_category = defaultdict(list)
    for row in normalized:
        by_project[row["project_name"]].append(row)
        by_category[row["issue_category"]].append(row)

    def project_bullets():
        bullets = []
        for name, count in project_counts.most_common(8):
            samples = "; ".join(row["summary_text"] for row in by_project[name][:2] if row["summary_text"])
            bullets.append(f"{name}: {count}건. {samples}")
        return bullets or ["프로젝트로 식별된 주요 로그가 없습니다."]

    def category_bullets():
        bullets = []
        for category, count in category_counts.most_common(6):
            top_projects = Counter(row["project_name"] for row in by_category[category]).most_common(3)
            names = ", ".join(name for name, _ in top_projects if name != "미분류") or "미분류 중심"
            bullets.append(f"{category}: {count}건. 주요 대상은 {names}입니다.")
        return bullets or ["집계 가능한 업무 유형이 없습니다."]

    investor_rows = [
        row for row in normalized
        if row["issue_category"] in {"투자자 대응", "금융 구조"} or re.search(r"GIC|LP|투자자|수익자|대주|은행|증권", row.get("raw_text") or "", re.I)
    ]
    investor_bullets = [
        f"{row['project_name']}: {row['summary_text']}" for row in investor_rows[:8]
    ] or ["투자자, 대주, 금융기관 관련으로 별도 부각되는 로그가 없습니다."]

    follow_up_rows = [
        row for row in normalized
        if row["issue_category"] in {"리스크/법무", "인허가/행정", "기타"}
        or effective_match_status(row) == "raw_unmatched"
    ]
    follow_up_bullets = [
        f"{row['project_name']}: {row['summary_text']}" for row in follow_up_rows[:8]
    ] or ["즉시 후속 점검이 필요한 로그가 제한적입니다."]

    sections = [
        {
            "title": "기준",
            "bullets": [
                f"대상 기간은 {week_start.isoformat()}~{week_end.isoformat()}입니다.",
                f"헤더성 문서를 제외하고 총 {len(normalized)}건의 T5T 로그를 기준으로 요약했습니다.",
                "주차 기준은 기존 대시보드와 동일하게 화요일~월요일입니다.",
            ],
        },
        {"title": "핵심 업무 유형", "bullets": category_bullets()},
        {"title": "프로젝트/자산별 주요 진행", "bullets": project_bullets()},
        {"title": "투자자/금융/외부 협의", "bullets": investor_bullets},
        {"title": "후속 점검 필요", "bullets": follow_up_bullets},
    ]

    markdown = "\n\n".join(
        f"## {section['title']}\n" + "\n".join(f"- {bullet}" for bullet in section["bullets"])
        for section in sections
    )

    return {
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_logs": len(normalized),
        "category_counts": dict(category_counts.most_common()),
        "top_projects": [{"name": name, "count": count} for name, count in project_counts.most_common(12)],
        "top_writers": [{"name": name, "count": count} for name, count in writer_counts.most_common(12)],
        "sections": sections,
        "markdown": markdown,
    }


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = ArgumentParser(description="Generate a dashboard-ready weekly T5T summary from SQL rows.")
    parser.add_argument("--as-of", help="Reference date in KST, YYYY-MM-DD. Defaults to today.")
    parser.add_argument("--date-from", help="Override inclusive start date, YYYY-MM-DD.")
    parser.add_argument("--date-to", help="Override inclusive end date, YYYY-MM-DD.")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Output JSON path.")
    args = parser.parse_args()

    if args.date_from and args.date_to:
        week_start, week_end = parse_date(args.date_from), parse_date(args.date_to)
    else:
        ref = parse_date(args.as_of) if args.as_of else datetime.now().date()
        week_start, week_end = reporting_week(ref)

    url, key = get_required_supabase_config()
    client = create_client(url, key)
    rows = fetch_all(
        client,
        "t5t_form_items",
        "form_item_id,submission_id,item_no,writer_staff_id,work_date,line,raw_text,project_text,stakeholder_text,matched_project_id,matched_fund_id,classification_summary,task_type,match_status,metadata",
        week_start,
        week_end,
    )
    staff = fetch_lookup(client, "staff", "staff_id,name,email", "staff_id")
    projects = fetch_lookup(client, "projects", "project_id,project_name", "project_id")
    funds = fetch_lookup(client, "funds", "fund_id,fund_name,short_name,asset_name", "fund_id")

    payload = build_summary(rows, staff, projects, funds, week_start, week_end)
    write_json(Path(args.out), payload)
    print(json.dumps({"status": "ok", "out": str(args.out), "total_logs": payload["total_logs"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
