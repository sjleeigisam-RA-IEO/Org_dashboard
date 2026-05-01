import argparse
import csv
import re
from collections import defaultdict
from pathlib import Path

from dotenv import dotenv_values
from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
OUT_DIR = BASE_DIR / "supabase_seed"


def clean(value):
    if value is None:
        return ""
    return str(value).replace("\xa0", " ").strip()


def norm(value):
    text = clean(value)
    for token in ["(겸)", "(대행)", "(휴직)", " "]:
        text = text.replace(token, "")
    return re.sub(r"\s+", "", text)


def split_dept(value):
    return [part.strip() for part in clean(value).split(",") if part.strip()]


def fetch_all(client, table, columns, page_size=1000):
    rows = []
    start = 0
    while True:
        result = client.table(table).select(columns).range(start, start + page_size - 1).execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        start += page_size
    return rows


def get_client():
    cfg = dotenv_values(BASE_DIR / ".env")
    return create_client(cfg["SUPABASE_URL"], cfg["SUPABASE_KEY"])


def score_org(dept_token, org):
    token = norm(dept_token)
    org_name = norm(org.get("org_name"))
    org_path = norm(org.get("org_path"))
    if not token or not org_name:
        return 0
    if token == org_name:
        return 100
    if token in org_path:
        return 85
    if org_name in token:
        return 75

    # CRM dept often comes as "자산관리2파트4", while orgs has group/part/team split.
    compact_path = org_path.replace(">", "")
    if token in compact_path:
        return 80
    return 0


def build_candidates():
    client = get_client()
    funds = fetch_all(client, "funds", "fund_id,short_name,fund_name,manager,dept,manager_staff_id,dept_org_id")
    staff = fetch_all(client, "staff", "staff_id,employee_no,name,email,notion_id,org_id,status")
    orgs = fetch_all(client, "orgs", "org_id,org_name,org_type,org_path,section,group_name,part_name,team_name")

    staff_by_name = defaultdict(list)
    for row in staff:
        staff_by_name[norm(row.get("name"))].append(row)

    manager_candidates = []
    org_candidates = []

    for fund in funds:
        manager = clean(fund.get("manager"))
        staff_matches = staff_by_name.get(norm(manager), []) if manager else []
        if len(staff_matches) == 1:
            match = staff_matches[0]
            confidence = "exact_name"
            score = 100
        elif len(staff_matches) > 1:
            match = {}
            confidence = "duplicate_name_review"
            score = 50
        else:
            match = {}
            confidence = "unmatched"
            score = 0

        manager_candidates.append({
            "fund_id": fund.get("fund_id"),
            "short_name": fund.get("short_name") or "",
            "fund_name": fund.get("fund_name") or "",
            "manager_text": manager,
            "candidate_staff_id": match.get("staff_id", ""),
            "candidate_employee_no": match.get("employee_no", ""),
            "candidate_name": match.get("name", ""),
            "candidate_email": match.get("email", ""),
            "candidate_notion_id": match.get("notion_id", ""),
            "match_score": score,
            "match_type": confidence,
            "current_manager_staff_id": fund.get("manager_staff_id") or "",
        })

        dept = clean(fund.get("dept"))
        dept_tokens = split_dept(dept)
        scored = []
        for token in dept_tokens or ([dept] if dept else []):
            for org in orgs:
                score = score_org(token, org)
                if score:
                    scored.append((score, token, org))
        scored.sort(key=lambda item: (-item[0], item[2].get("org_type") != "team", item[2].get("org_path") or ""))
        if scored:
            for score, token, org in scored[:5]:
                org_candidates.append({
                    "fund_id": fund.get("fund_id"),
                    "short_name": fund.get("short_name") or "",
                    "fund_name": fund.get("fund_name") or "",
                    "dept_text": dept,
                    "dept_token": token,
                    "candidate_org_id": org.get("org_id") or "",
                    "candidate_org_name": org.get("org_name") or "",
                    "candidate_org_type": org.get("org_type") or "",
                    "candidate_org_path": org.get("org_path") or "",
                    "match_score": score,
                    "match_type": "org_name_or_path",
                    "current_dept_org_id": fund.get("dept_org_id") or "",
                })
        else:
            org_candidates.append({
                "fund_id": fund.get("fund_id"),
                "short_name": fund.get("short_name") or "",
                "fund_name": fund.get("fund_name") or "",
                "dept_text": dept,
                "dept_token": "",
                "candidate_org_id": "",
                "candidate_org_name": "",
                "candidate_org_type": "",
                "candidate_org_path": "",
                "match_score": 0,
                "match_type": "unmatched",
                "current_dept_org_id": fund.get("dept_org_id") or "",
            })

    return manager_candidates, org_candidates


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        return
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def apply_exact_manager_matches(rows):
    client = get_client()
    updates = [
        {"fund_id": row["fund_id"], "manager_staff_id": row["candidate_staff_id"]}
        for row in rows
        if row["match_type"] == "exact_name" and row["candidate_staff_id"]
    ]
    for idx in range(0, len(updates), 500):
        client.table("funds").upsert(updates[idx:idx + 500], on_conflict="fund_id").execute()
    return len(updates)


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Build candidate CSVs for future fund manager/dept mapping. "
            "This does not update funds unless --apply-exact-manager is explicitly passed."
        )
    )
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    parser.add_argument("--apply-exact-manager", action="store_true")
    args = parser.parse_args()

    manager_rows, org_rows = build_candidates()
    out_dir = Path(args.out_dir)
    write_csv(out_dir / "fund_manager_staff_candidates.csv", manager_rows)
    write_csv(out_dir / "fund_dept_org_candidates.csv", org_rows)

    manager_exact = sum(1 for row in manager_rows if row["match_type"] == "exact_name")
    manager_unmatched = sum(1 for row in manager_rows if row["match_type"] == "unmatched" and row["manager_text"])
    org_top_exact = sum(1 for row in org_rows if row["match_score"] >= 100)
    org_unmatched = sum(1 for row in org_rows if row["match_type"] == "unmatched" and row["dept_text"])

    print(f"manager candidates: {len(manager_rows)} rows")
    print(f"manager exact matches: {manager_exact}")
    print(f"manager unmatched rows: {manager_unmatched}")
    print(f"org candidate rows: {len(org_rows)}")
    print(f"org exact/path high-confidence candidates: {org_top_exact}")
    print(f"org unmatched rows: {org_unmatched}")
    print(out_dir / "fund_manager_staff_candidates.csv")
    print(out_dir / "fund_dept_org_candidates.csv")

    if args.apply_exact_manager:
        applied = apply_exact_manager_matches(manager_rows)
        print(f"applied exact manager_staff_id updates: {applied}")


if __name__ == "__main__":
    main()
