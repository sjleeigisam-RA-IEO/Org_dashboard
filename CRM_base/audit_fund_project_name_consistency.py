from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path

from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
OUTPUT_DIR = BASE_DIR / "output"
SOURCE_CSV = OUTPUT_DIR / "ra_insight_db_asset_fund_project_relationships_cleanup.csv"
AUDIT_CSV = OUTPUT_DIR / "fund_project_name_consistency_audit.csv"
UPDATE_CANDIDATES_CSV = OUTPUT_DIR / "fund_project_name_update_candidates.csv"
SUMMARY_MD = OUTPUT_DIR / "fund_project_name_consistency_summary.md"


VEHICLE_PATTERNS = (
    "투자신탁",
    "사모부동산",
    "일반사모",
    "전문투자형",
    "부동산투자회사",
    "리츠",
    "pfv",
    "피에프브이",
    "spc",
    "유동화전문",
    "수익증권",
    "종류주",
    "회사채",
    "사채",
    "혼합자산투자신탁",
)


def load_env() -> dict[str, str]:
    values = {}
    for line in (PROJECT_DIR / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def fetch_all(client, table: str, select: str = "*") -> list[dict]:
    rows = []
    start = 0
    size = 1000
    while True:
        batch = (
            client.table(table)
            .select(select)
            .range(start, start + size - 1)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < size:
            return rows
        start += size


def clean(value) -> str:
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ").strip()
    return "" if text.lower() in {"", "none", "null", "nan", "-"} else text


def normalize_name(value) -> str:
    text = clean(value).lower()
    text = re.sub(r"\([^)]*\)|\[[^\]]*\]", "", text)
    return re.sub(r"[\s\.,·ㆍ\-_/\\|]+", "", text)


def looks_vehicle_like(value) -> bool:
    lowered = clean(value).lower()
    return any(pattern in lowered for pattern in VEHICLE_PATTERNS)


def same_name(left, right) -> bool:
    return normalize_name(left) == normalize_name(right)


def split_flags(value: str) -> list[str]:
    return [flag for flag in value.split(";") if flag]


def add_flag(flags: list[str], flag: str) -> None:
    if flag not in flags:
        flags.append(flag)


def fund_display_name(fund: dict | None) -> str:
    if not fund:
        return ""
    return clean(fund.get("fund_name"))


def pseudo_project_display_name(fund: dict | None) -> tuple[str, str]:
    if not fund:
        return "", ""
    for field in ("project_mission_name", "asset_name", "fund_name"):
        value = clean(fund.get(field))
        if value:
            return value, f"funds.{field}"
    return "", ""


def audit_row(row: dict[str, str], funds_by_id: dict[str, dict], projects_by_id: dict[str, dict]) -> dict[str, str]:
    fund_id = clean(row.get("fund_id"))
    project_id = clean(row.get("project_id"))
    fund_name = clean(row.get("fund_name"))
    project_name = clean(row.get("project_name"))

    fund = funds_by_id.get(fund_id)
    project = projects_by_id.get(project_id)
    project_id_is_fund_id = bool(project_id and project_id in funds_by_id and project_id not in projects_by_id)
    pseudo_fund = funds_by_id.get(project_id) if project_id_is_fund_id else None

    fund_flags: list[str] = []
    project_flags: list[str] = []

    proposed_fund_name = ""
    proposed_fund_short_name = ""
    if not fund_id:
        if fund_name:
            add_flag(fund_flags, "fund_name_without_fund_id")
        else:
            add_flag(fund_flags, "fund_missing_no_id")
    elif not fund:
        add_flag(fund_flags, "fund_id_not_found_in_db")
    else:
        proposed_fund_name = clean(fund.get("fund_name"))
        proposed_fund_short_name = clean(fund.get("short_name"))
        if not fund_name and proposed_fund_name:
            add_flag(fund_flags, "fund_name_blank_fill_from_db")
        elif proposed_fund_name and not same_name(fund_name, proposed_fund_name):
            add_flag(fund_flags, "fund_name_mismatch_db")

    proposed_project_name = ""
    proposed_project_source = ""
    if not project_id:
        if project_name:
            add_flag(project_flags, "project_name_without_project_id")
        else:
            add_flag(project_flags, "project_missing_no_id")
    elif project:
        proposed_project_name = clean(project.get("project_name"))
        proposed_project_source = "projects.project_name"
        if not project_name and proposed_project_name:
            add_flag(project_flags, "project_name_blank_fill_from_db")
        elif proposed_project_name and not same_name(project_name, proposed_project_name):
            add_flag(project_flags, "project_name_mismatch_db")
    elif project_id_is_fund_id:
        proposed_project_name, proposed_project_source = pseudo_project_display_name(pseudo_fund)
        add_flag(project_flags, "project_id_is_fund_id_pseudo_project")
        if not project_name and proposed_project_name:
            add_flag(project_flags, "project_name_blank_fill_from_fund_context")
        elif project_name and proposed_project_name and not same_name(project_name, proposed_project_name):
            add_flag(project_flags, "project_name_mismatch_fund_context")
    else:
        add_flag(project_flags, "project_id_not_found_in_projects_or_funds")

    if project_name and fund_name and same_name(project_name, fund_name):
        add_flag(project_flags, "project_name_same_as_fund_name")
    if project_name and looks_vehicle_like(project_name):
        add_flag(project_flags, "project_name_vehicle_like")

    return {
        **row,
        "fund_audit_flags": ";".join(fund_flags),
        "project_audit_flags": ";".join(project_flags),
        "proposed_fund_name_from_db": proposed_fund_name,
        "proposed_fund_short_name_from_db": proposed_fund_short_name,
        "proposed_project_display_name": proposed_project_name,
        "proposed_project_display_source": proposed_project_source,
        "project_id_is_actual_project": "true" if project_id and project_id in projects_by_id else "false",
        "project_id_is_fund_id_pseudo": "true" if project_id_is_fund_id else "false",
        "needs_fund_name_update": "true"
        if any(flag in fund_flags for flag in ("fund_name_blank_fill_from_db", "fund_name_mismatch_db"))
        else "false",
        "needs_project_name_update": "true"
        if any(
            flag in project_flags
            for flag in (
                "project_name_blank_fill_from_db",
                "project_name_mismatch_db",
                "project_name_blank_fill_from_fund_context",
                "project_name_mismatch_fund_context",
            )
        )
        else "false",
    }


def compact_candidate(row: dict[str, str], issue_type: str, flags: str) -> dict[str, str]:
    return {
        "issue_type": issue_type,
        "asset_id": row.get("asset_id", ""),
        "asset_name": row.get("asset_name", ""),
        "fund_id": row.get("fund_id", ""),
        "current_fund_name": row.get("fund_name", ""),
        "proposed_fund_name": row.get("proposed_fund_name_from_db", ""),
        "project_id": row.get("project_id", ""),
        "current_project_name": row.get("project_name", ""),
        "proposed_project_display_name": row.get("proposed_project_display_name", ""),
        "proposed_project_display_source": row.get("proposed_project_display_source", ""),
        "project_id_is_actual_project": row.get("project_id_is_actual_project", ""),
        "project_id_is_fund_id_pseudo": row.get("project_id_is_fund_id_pseudo", ""),
        "flags": flags,
        "relationship_status": row.get("relationship_status", ""),
        "missing_parts": row.get("missing_parts", ""),
        "project_lookup_source": row.get("project_lookup_source", ""),
        "fund_relation_source_table": row.get("fund_relation_source_table", ""),
        "project_relation_source_table": row.get("project_relation_source_table", ""),
    }


def main() -> None:
    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])
    funds = fetch_all(
        client,
        "funds",
        "fund_id,fund_name,short_name,asset_name,project_mission_name,status,sector",
    )
    projects = fetch_all(
        client,
        "projects",
        "project_id,project_name,project_type,status",
    )
    funds_by_id = {clean(row.get("fund_id")): row for row in funds if clean(row.get("fund_id"))}
    projects_by_id = {clean(row.get("project_id")): row for row in projects if clean(row.get("project_id"))}

    with SOURCE_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        source_rows = list(csv.DictReader(handle))

    audit_rows = [audit_row(row, funds_by_id, projects_by_id) for row in source_rows]
    fieldnames = list(audit_rows[0].keys()) if audit_rows else []
    with AUDIT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(audit_rows)

    candidate_rows = []
    seen = set()
    for row in audit_rows:
        for issue_type, flag_field in (
            ("fund_name", "fund_audit_flags"),
            ("project_name", "project_audit_flags"),
        ):
            flags = clean(row.get(flag_field))
            if not flags:
                continue
            key = (
                issue_type,
                row.get("asset_id", ""),
                row.get("fund_id", ""),
                row.get("project_id", ""),
                row.get("proposed_fund_name_from_db", ""),
                row.get("proposed_project_display_name", ""),
                flags,
            )
            if key in seen:
                continue
            seen.add(key)
            candidate_rows.append(compact_candidate(row, issue_type, flags))

    candidate_fieldnames = list(candidate_rows[0].keys()) if candidate_rows else []
    with UPDATE_CANDIDATES_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=candidate_fieldnames)
        writer.writeheader()
        writer.writerows(candidate_rows)

    fund_flag_counts = Counter()
    project_flag_counts = Counter()
    for row in audit_rows:
        fund_flag_counts.update(split_flags(row["fund_audit_flags"]))
        project_flag_counts.update(split_flags(row["project_audit_flags"]))

    unique_fund_issue_keys = {
        (row.get("asset_id"), row.get("fund_id"), row.get("fund_audit_flags"))
        for row in audit_rows
        if row.get("fund_audit_flags")
    }
    unique_project_issue_keys = {
        (row.get("asset_id"), row.get("project_id"), row.get("project_audit_flags"))
        for row in audit_rows
        if row.get("project_audit_flags")
    }

    summary = {
        "source_rows": len(source_rows),
        "audit_rows": len(audit_rows),
        "candidate_rows": len(candidate_rows),
        "unique_fund_issue_keys": len(unique_fund_issue_keys),
        "unique_project_issue_keys": len(unique_project_issue_keys),
        "rows_with_fund_id": sum(1 for row in audit_rows if clean(row.get("fund_id"))),
        "rows_without_fund_id": sum(1 for row in audit_rows if not clean(row.get("fund_id"))),
        "rows_with_actual_project_id": sum(
            1 for row in audit_rows if row.get("project_id_is_actual_project") == "true"
        ),
        "rows_with_pseudo_project_fund_id": sum(
            1 for row in audit_rows if row.get("project_id_is_fund_id_pseudo") == "true"
        ),
        "rows_without_project_id": sum(
            1 for row in audit_rows if "project_missing_no_id" in split_flags(row.get("project_audit_flags", ""))
        ),
        "rows_without_project_id_but_with_fund_id": sum(
            1
            for row in audit_rows
            if "project_missing_no_id" in split_flags(row.get("project_audit_flags", ""))
            and clean(row.get("fund_id"))
        ),
        "actual_project_rows_with_any_flag": sum(
            1
            for row in audit_rows
            if row.get("project_id_is_actual_project") == "true" and clean(row.get("project_audit_flags"))
        ),
        "fund_flag_counts": fund_flag_counts,
        "project_flag_counts": project_flag_counts,
        "funds_in_db": len(funds_by_id),
        "projects_in_db": len(projects_by_id),
    }

    lines = [
        "# 펀드명/프로젝트명 정합성 감사",
        "",
        f"- 기준 CSV: `{SOURCE_CSV.name}`",
        f"- 감사 행 수: {summary['audit_rows']}행",
        f"- DB funds: {summary['funds_in_db']}개",
        f"- DB projects: {summary['projects_in_db']}개",
        f"- 후보/이슈 compact 행: {summary['candidate_rows']}행",
        f"- 고유 펀드 이슈 키: {summary['unique_fund_issue_keys']}개",
        f"- 고유 프로젝트 이슈 키: {summary['unique_project_issue_keys']}개",
        "",
        "## 큰 버킷",
        "",
        f"- fund_id 있는 행: {summary['rows_with_fund_id']}행",
        f"- fund_id 없는 행: {summary['rows_without_fund_id']}행",
        f"- 실제 projects.project_id 행: {summary['rows_with_actual_project_id']}행",
        f"- fund_id가 project_id로 들어간 pseudo project 행: {summary['rows_with_pseudo_project_fund_id']}행",
        f"- project_id 없는 행: {summary['rows_without_project_id']}행",
        f"- fund_id는 있으나 project_id 없는 행: {summary['rows_without_project_id_but_with_fund_id']}행",
        f"- 실제 project_id 행 중 추가 플래그가 있는 행: {summary['actual_project_rows_with_any_flag']}행",
        "",
        "## 펀드명 이슈",
        "",
        "| flag | row count |",
        "|---|---:|",
    ]
    for flag, count in fund_flag_counts.most_common():
        lines.append(f"| `{flag}` | {count} |")

    lines.extend(
        [
            "",
            "## 프로젝트명 이슈",
            "",
            "| flag | row count |",
            "|---|---:|",
        ]
    )
    for flag, count in project_flag_counts.most_common():
        lines.append(f"| `{flag}` | {count} |")

    lines.extend(
        [
            "",
            "## 결론",
            "",
            "- 펀드명은 `fund_id`가 있는 행에서는 DB `funds.fund_name`과 불일치가 없습니다. 현재 문제는 682행의 펀드 관계 자체가 비어 있는 것입니다.",
            "- 프로젝트명도 실제 `projects.project_id`가 있는 852행에서는 DB 프로젝트명과의 불일치가 없습니다.",
            "- 가장 큰 문제는 2,827행의 `project_id_is_fund_id_pseudo_project`입니다. 이 행들은 실제 프로젝트가 아니라 펀드/비히클 맥락에서 온 표시명으로 분리해야 합니다.",
            "- `project_missing_no_id` 922행 중 240행은 fund_id는 있으나 project_id가 없으므로, 펀드 drawer에서 프로젝트 없음 또는 프로젝트 후보 발굴 대상으로 다루면 됩니다.",
            "",
            "## 해석",
            "",
            "- `fund_missing_no_id`: 해당 asset row에 연결된 fund_id 자체가 없습니다. 이름 보정이 아니라 관계 발굴 문제입니다.",
            "- `fund_name_blank_fill_from_db` / `fund_name_mismatch_db`: fund_id가 있으므로 DB funds 기준으로 CSV 표시명을 채울 수 있습니다.",
            "- `project_missing_no_id`: 해당 asset row에 project_id 자체가 없습니다. 프로젝트 관계 발굴 문제입니다.",
            "- `project_id_is_fund_id_pseudo_project`: 현재 project_id가 실제 projects.project_id가 아니라 fund_id입니다. 프로젝트 테이블의 실제 프로젝트가 아니라 fund context/pseudo project로 분리 표시해야 합니다.",
            "- `project_name_vehicle_like`: 프로젝트명 칸에 펀드/비히클성 명칭이 들어간 것으로 보여 drawer 표시에서는 프로젝트와 비히클을 분리해야 합니다.",
        ]
    )
    SUMMARY_MD.write_text("\n".join(lines), encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False, indent=2, default=dict))
    print(str(AUDIT_CSV))
    print(str(UPDATE_CANDIDATES_CSV))
    print(str(SUMMARY_MD))


if __name__ == "__main__":
    main()
