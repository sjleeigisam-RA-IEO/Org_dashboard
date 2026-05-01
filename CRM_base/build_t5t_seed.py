import argparse
import hashlib
import json
from pathlib import Path

from dotenv import dotenv_values
from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
T5T_DATA_DIR = ROOT_DIR / "t5t-dashboard" / "data"
OUT_DIR = BASE_DIR / "supabase_seed"


def read_json(path):
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(rows, file, ensure_ascii=False, indent=2)
        file.write("\n")


def clean(value):
    if value is None:
        return None
    if isinstance(value, list):
        return [item for item in value if item not in (None, "")]
    text = str(value).replace("\xa0", " ").strip()
    if not text or text.lower() in {"nan", "none", "null", "undefined"}:
        return None
    return text


def clean_date(value):
    text = clean(value)
    if not text:
        return None
    text = str(text)
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    return None


def make_id(prefix, *parts):
    raw = "|".join(str(clean(part) or "") for part in parts)
    return f"{prefix}_{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]}"


def get_client():
    cfg = dotenv_values(BASE_DIR / ".env")
    return create_client(cfg["SUPABASE_URL"], cfg["SUPABASE_KEY"])


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


def unwrap_rollup(value):
    if isinstance(value, list):
        values = [item for item in value if item not in (None, "")]
        if len(values) == 1:
            return values[0]
        return values
    return value


def staff_lookup():
    client = get_client()
    staff = fetch_all(client, "staff", "staff_id,name,notion_id,email,employee_no")
    by_notion = {row["notion_id"]: row["staff_id"] for row in staff if row.get("notion_id")}
    by_name = {row["name"]: row["staff_id"] for row in staff if row.get("name")}
    return by_notion, by_name


def project_name_from_record(record):
    return clean(
        record.get("Project & Mission 이름")
        or record.get("프로젝트명")
        or record.get("업무 로그명")
        or "Unknown Project"
    )


def build_projects(project_master, project_mission, staff_by_notion):
    projects = {}
    links = {}

    def add_project(record, source_system):
        notion_id = clean(record.get("_id"))
        project_id = f"project_notion_{notion_id}" if notion_id else make_id("project", project_name_from_record(record))
        name = project_name_from_record(record)
        row = {
            "project_id": project_id,
            "notion_id": notion_id,
            "project_code": clean(record.get("프로젝트 코드")),
            "project_name": name,
            "project_type": clean(record.get("유형") or record.get("구분")),
            "status": clean(record.get("상태") or record.get("진행 현황") or record.get("운용상태")),
            "priority": clean(record.get("우선순위") or record.get("보고용 우선순위")),
            "health": clean(record.get("건강도")),
            "lead_org_text": clean(record.get("주관조직") or record.get("Owner_Line")),
            "lead_staff_id": None,
            "start_date": clean_date(record.get("시작일") or unwrap_rollup(record.get("설정일"))),
            "target_date": clean_date(record.get("목표일") or unwrap_rollup(record.get("만기일"))),
            "next_check_date": clean_date(record.get("다음 점검일")),
            "source_system": source_system,
            "metadata": record,
        }
        projects[project_id] = row

        role_fields = {
            "주관자": "lead",
            "참여자": "participant",
            "Director": "director",
            "Sr. Manager": "senior_manager",
            "Manager": "manager",
            "일부 기간 참여 인원": "partial_period_participant",
        }
        for field, role in role_fields.items():
            for notion_staff_id in record.get(field) or []:
                staff_id = staff_by_notion.get(notion_staff_id)
                link_id = make_id("project_staff", project_id, role, notion_staff_id)
                links[link_id] = {
                    "link_id": link_id,
                    "project_id": project_id,
                    "staff_id": staff_id,
                    "notion_staff_id": notion_staff_id,
                    "role": role,
                    "source_system": source_system,
                    "metadata": {"source_field": field},
                }
                if role == "lead" and staff_id and not row["lead_staff_id"]:
                    row["lead_staff_id"] = staff_id

    for record in project_master:
        add_project(record, "t5t_project_master")
    for record in project_mission:
        add_project(record, "t5t_project_mission")

    return projects, links


def build_t5t_logs(t5t_rows, projects, staff_by_name):
    project_by_notion = {
        row["notion_id"]: row["project_id"]
        for row in projects.values()
        if row.get("notion_id")
    }
    logs = {}
    links = {}

    for record in t5t_rows:
        notion_id = clean(record.get("_id"))
        log_id = f"t5t_notion_{notion_id}" if notion_id else make_id("t5t", record.get("업무 로그명"))
        writer_name = clean(record.get("작성자"))
        project_ids = []
        for field, relation_type in [("Project & Mission", "project_mission"), ("신규 프로젝트", "new_project")]:
            for notion_project_id in record.get(field) or []:
                project_id = project_by_notion.get(notion_project_id)
                project_ids.append((project_id, notion_project_id, relation_type))

        logs[log_id] = {
            "t5t_log_id": log_id,
            "notion_id": notion_id,
            "writer_staff_id": staff_by_name.get(writer_name),
            "writer_name": writer_name,
            "line": clean(record.get("라인")),
            "work_date": clean_date(record.get("업무일자")),
            "week_key": clean(record.get("주차키")),
            "week_end_date": clean_date(record.get("주차종료일")),
            "task_type": clean(record.get("업무유형")),
            "log_title": clean(record.get("업무 로그명")),
            "summary": clean(record.get("원문 요약")),
            "raw_text": clean(record.get("원문 요약")),
            "source_url": clean(record.get("원문 URL") or record.get("T5T 작성자 페이지")),
            "matching_status": clean(record.get("매칭 상태")),
            "matching_basis": clean(record.get("매칭 근거")),
            "needs_manual_review": bool(record.get("수동 확인 필요")),
            "classification_summary": clean(record.get("classification_summary")),
            "classification_tokens": clean(record.get("classification_tokens")),
            "input_status": "synced",
            "source_system": "notion_t5t_log",
            "metadata": record,
        }

        for project_id, notion_project_id, relation_type in project_ids:
            link_id = make_id("t5t_project", log_id, notion_project_id, relation_type)
            links[link_id] = {
                "link_id": link_id,
                "t5t_log_id": log_id,
                "project_id": project_id,
                "notion_project_id": notion_project_id,
                "relation_type": relation_type,
                "match_status": "matched" if project_id else "unmatched_project_id",
                "metadata": {},
            }

    return logs, links


def build_seed(out_dir):
    project_master = read_json(T5T_DATA_DIR / "project_master.json")
    project_mission = read_json(T5T_DATA_DIR / "project_mission.json")
    t5t_rows = read_json(T5T_DATA_DIR / "t5t_log.json")
    staff_by_notion, staff_by_name = staff_lookup()

    projects, project_staff_links = build_projects(project_master, project_mission, staff_by_notion)
    t5t_logs, t5t_log_project_links = build_t5t_logs(t5t_rows, projects, staff_by_name)

    datasets = {
        "projects": sorted(projects.values(), key=lambda row: row["project_id"]),
        "project_staff_links": sorted(project_staff_links.values(), key=lambda row: row["link_id"]),
        "t5t_logs": sorted(t5t_logs.values(), key=lambda row: row["t5t_log_id"]),
        "t5t_log_project_links": sorted(t5t_log_project_links.values(), key=lambda row: row["link_id"]),
    }
    for name, rows in datasets.items():
        write_json(out_dir / f"{name}.json", rows)

    manifest = {
        "source": "t5t Notion JSON cache",
        "counts": {name: len(rows) for name, rows in datasets.items()},
        "notes": [
            "This prepares DB tables for a future dashboard input form.",
            "The dashboard UI is not switched by this seed.",
        ],
    }
    write_json(out_dir / "t5t_manifest.json", manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Build project/T5T seed data for Supabase.")
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    args = parser.parse_args()
    manifest = build_seed(Path(args.out_dir))
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
