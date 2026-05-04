import argparse
import json
import os
from pathlib import Path

import pandas as pd
from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
DEFAULT_EXCEL = PROJECT_DIR / "org_dashboard" / "구성원리스트_2604.xlsx"


def load_env():
    env_path = PROJECT_DIR / ".env"
    values = {}
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                values[key] = value
    values.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    return values


def clean_text(value):
    if value is None or pd.isna(value):
        return ""
    return str(value).replace("\xa0", " ").strip()


def next_external_staff_id(staff_rows):
    max_number = 0
    for row in staff_rows:
        staff_id = clean_text(row.get("staff_id"))
        if not staff_id.startswith("staff_ext_"):
            continue
        suffix = staff_id.removeprefix("staff_ext_")
        if suffix.isdigit():
            max_number = max(max_number, int(suffix))
    return f"staff_ext_{max_number + 1:06d}"


def read_excel_staff(path):
    df = pd.read_excel(path, sheet_name="구성원list", header=1, dtype=object)
    records = []
    for _, row in df.iterrows():
        name = clean_text(row.get("성명"))
        email = clean_text(row.get("회사 이메일")).lower()
        if not name:
            continue
        records.append(
            {
                "name": name,
                "email": email,
                "title": clean_text(row.get("호칭(26년)")),
                "position": clean_text(row.get("직위(26년)")),
                "role_title": clean_text(row.get("직책(26년)")),
                "division": clean_text(row.get("부문")),
                "group": clean_text(row.get("그룹/파트/실/센터")),
                "team": clean_text(row.get("팀")),
                "dual_org": clean_text(row.get("겸직부서")),
                "join_date_raw": clean_text(row.get("입사일")),
                "leave_date_raw": clean_text(row.get("퇴사일\n(계약만료일)")),
                "gender_raw": clean_text(row.get("성별")),
                "cohort": clean_text(row.get("입사구분")),
                "career_level_2026": clean_text(row.get("경력Lv(26년)")),
            }
        )
    return records


def fetch_all_staff(client):
    rows = []
    start = 0
    size = 1000
    while True:
        batch = (
            client.table("staff")
            .select("staff_id,employee_no,name,email,status,metadata")
            .range(start, start + size - 1)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < size:
            return rows
        start += size


def build_plan(excel_rows, staff_rows):
    by_name = {}
    for row in staff_rows:
        by_name.setdefault(clean_text(row.get("name")), []).append(row)

    updates = []
    inserts = []
    skipped_duplicate = []
    skipped_no_email = []
    unchanged = []

    next_ext_number = int(next_external_staff_id(staff_rows).removeprefix("staff_ext_"))

    for excel_row in excel_rows:
        name = excel_row["name"]
        email = excel_row["email"]
        if not email:
            skipped_no_email.append(excel_row)
            continue

        hits = by_name.get(name, [])
        if len(hits) > 1:
            skipped_duplicate.append({"excel": excel_row, "hits": hits})
            continue
        if len(hits) == 1:
            staff = hits[0]
            old_email = clean_text(staff.get("email")).lower()
            if old_email == email:
                unchanged.append({"excel": excel_row, "staff": staff})
                continue
            updates.append({"excel": excel_row, "staff": staff, "old_email": old_email, "new_email": email})
            continue

        metadata = {
            "source_excel": "구성원리스트_2604.xlsx",
            "source_system": "org_excel_2604",
            "division": excel_row["division"],
            "group": excel_row["group"],
            "team": excel_row["team"],
            "dual_org": excel_row["dual_org"],
            "role_title_2026": excel_row["role_title"],
            "join_date_raw": excel_row["join_date_raw"],
            "leave_date_raw": excel_row["leave_date_raw"],
            "gender_raw": excel_row["gender_raw"],
            "career_level_2026": excel_row["career_level_2026"],
            "needs_manual_review": True,
        }
        inserts.append(
            {
                "staff_id": f"staff_ext_{next_ext_number:06d}",
                "name": name,
                "email": email,
                "title": excel_row["title"] or None,
                "position": excel_row["position"] or None,
                "status": "unknown",
                "cohort": excel_row["cohort"] or None,
                "source_system": "org_excel_2604",
                "metadata": {k: v for k, v in metadata.items() if v not in ("", None)},
            }
        )
        next_ext_number += 1

    return {
        "updates": updates,
        "inserts": inserts,
        "skipped_duplicate": skipped_duplicate,
        "skipped_no_email": skipped_no_email,
        "unchanged": unchanged,
    }


def apply_plan(client, plan):
    for item in plan["updates"]:
        client.table("staff").update(
            {
                "email": item["new_email"],
                "source_system": "org_excel_2604",
            }
        ).eq("staff_id", item["staff"]["staff_id"]).execute()

    for row in plan["inserts"]:
        client.table("staff").insert(row).execute()


def summarize(plan):
    return {
        "email_update_needed": len(plan["updates"]),
        "new_staff_needed": len(plan["inserts"]),
        "unchanged": len(plan["unchanged"]),
        "skipped_duplicate": len(plan["skipped_duplicate"]),
        "skipped_no_email": len(plan["skipped_no_email"]),
        "sample_updates": [
            {
                "name": item["excel"]["name"],
                "staff_id": item["staff"]["staff_id"],
                "old_email": item["old_email"],
                "new_email": item["new_email"],
            }
            for item in plan["updates"][:10]
        ],
        "new_staff": [
            {
                "name": row["name"],
                "staff_id": row["staff_id"],
                "email": row["email"],
                "division": row["metadata"].get("division"),
                "team": row["metadata"].get("team"),
            }
            for row in plan["inserts"]
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--excel", default=str(DEFAULT_EXCEL))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])
    excel_rows = read_excel_staff(Path(args.excel))
    staff_rows = fetch_all_staff(client)
    plan = build_plan(excel_rows, staff_rows)

    print(json.dumps(summarize(plan), ensure_ascii=False, indent=2))
    if args.apply:
        apply_plan(client, plan)
        refreshed = fetch_all_staff(client)
        refreshed_plan = build_plan(excel_rows, refreshed)
        print("APPLIED")
        print(json.dumps(summarize(refreshed_plan), ensure_ascii=False, indent=2))
    else:
        print("DRY_RUN only. Re-run with --apply to update Supabase.")


if __name__ == "__main__":
    main()
