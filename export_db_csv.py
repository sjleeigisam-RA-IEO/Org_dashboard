from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
SOURCE_JSON = BASE_DIR / "org-data.json"
OUTPUT_DIR = BASE_DIR / "db_export"

SECTION_LEADERS = {
    "투자+펀딩": ("윤관식", "부대표"),
    "사업+개발": ("이철승", "부문대표"),
    "관리+운영": ("정조민", "부대표"),
}

NON_COUNTED_TF_MEMBERS = {
    "SS&C TF": {"신호선", "신동열", "신민재", "윤우섭"},
}


@dataclass
class OrgNode:
    org_id: str
    org_name: str
    org_level: str
    section_name: str
    parent_org_id: str
    org_code: str
    display_order: int
    notes: str = ""


def load_data() -> dict:
    return json.loads(SOURCE_JSON.read_text(encoding="utf-8"))


def slugify(value: str) -> str:
    return (
        value.replace(" ", "")
        .replace("+", "-")
        .replace("/", "-")
        .replace("(", "")
        .replace(")", "")
        .replace("&", "and")
    )


def infer_org_code(name: str) -> str:
    if "(LFC)" in name:
        return "LFC"
    if "(DSC)" in name:
        return "DSC"
    if "(SSC)" in name:
        return "SSC"
    if "(RSC)" in name:
        return "RSC"
    if "(EMC)" in name:
        return "EMC"
    if "(IEC)" in name:
        return "IEC"
    return ""


def should_count_member(group_name: str, member: dict) -> bool:
    if "외부영입" in member.get("tags", []):
        return False
    if member["name"] in NON_COUNTED_TF_MEMBERS.get(group_name, set()):
        return False
    if group_name == "SS&C TF" and member["role"] == "그룹장":
        return False
    return True


def build_nodes(data: dict) -> tuple[list[dict], dict[tuple[str, str], str], dict[tuple[str, str, str], str], dict[str, str]]:
    sections_rows: list[dict] = []
    group_ids: dict[tuple[str, str], str] = {}
    part_ids: dict[tuple[str, str, str], str] = {}
    team_ids: dict[str, str] = {}

    for section_index, section in enumerate(data["sections"], start=1):
        section_id = f"section-{section_index:02d}"
        lead_name, lead_title = SECTION_LEADERS.get(section["name"], ("", ""))
        sections_rows.append(
            {
                "section_id": section_id,
                "section_name": section["name"],
                "section_lead_name": lead_name,
                "section_lead_title": lead_title,
                "display_order": section_index,
            }
        )

        for group_index, group in enumerate(section["groups"], start=1):
            group_id = f"{section_id}-group-{group_index:02d}"
            group_ids[(section["name"], group["name"])] = group_id

            for part_index, part in enumerate(group["parts"], start=1):
                part_key = (section["name"], group["name"], part["name"])
                part_id = f"{group_id}-part-{part_index:02d}"
                part_ids[part_key] = part_id

                for team_index, team in enumerate(part["teams"], start=1):
                    team_ids[team["id"]] = f"{part_id}-team-{team_index:02d}"

    return sections_rows, group_ids, part_ids, team_ids


def export_sections(data: dict) -> list[dict]:
    sections_rows, _, _, _ = build_nodes(data)
    return sections_rows


def export_organizations(data: dict) -> list[dict]:
    sections_rows, group_ids, part_ids, team_ids = build_nodes(data)
    rows: list[dict] = []
    section_id_map = {row["section_name"]: row["section_id"] for row in sections_rows}

    for section in data["sections"]:
        section_id = section_id_map[section["name"]]
        for group_index, group in enumerate(section["groups"], start=1):
            group_id = group_ids[(section["name"], group["name"])]
            rows.append(
                {
                    "org_id": group_id,
                    "org_name": group["name"],
                    "org_level": "group" if "그룹" in group["name"] else "center" if "센터" in group["name"] else "tf",
                    "section_name": section["name"],
                    "section_id": section_id,
                    "parent_org_id": section_id,
                    "org_code": infer_org_code(group["name"]),
                    "display_order": group_index,
                    "notes": "TF" if ("TF" in group["name"] or "CFT" in group["name"]) else "",
                }
            )

            for part_index, part in enumerate(group["parts"], start=1):
                part_id = part_ids[(section["name"], group["name"], part["name"])]
                rows.append(
                    {
                        "org_id": part_id,
                        "org_name": part["name"],
                        "org_level": "part",
                        "section_name": section["name"],
                        "section_id": section_id,
                        "parent_org_id": group_id,
                        "org_code": "",
                        "display_order": part_index,
                        "notes": "",
                    }
                )

                for team_index, team in enumerate(part["teams"], start=1):
                    team_id = team_ids[team["id"]]
                    rows.append(
                        {
                            "org_id": team_id,
                            "org_name": team["displayName"],
                            "org_level": "team",
                            "section_name": section["name"],
                            "section_id": section_id,
                            "parent_org_id": part_id,
                            "org_code": "",
                            "display_order": team_index,
                            "notes": team["path"],
                        }
                    )

    return rows


def export_people(data: dict) -> list[dict]:
    seen: dict[str, dict] = {}
    for section in data["sections"]:
        for group in section["groups"]:
            for part in group["parts"]:
                for team in part["teams"]:
                    for member in team["members"]:
                        if member["name"] not in seen:
                            seen[member["name"]] = {
                                "person_id": f"person-{len(seen) + 1:03d}",
                                "person_name": member["name"],
                                "raw_name_example": member["rawName"],
                                "is_external_hire": "Y" if "외부영입" in member.get("tags", []) else "N",
                            }
    return sorted(seen.values(), key=lambda row: row["person_name"])


def export_assignments(data: dict) -> list[dict]:
    sections_rows, group_ids, part_ids, team_ids = build_nodes(data)
    people_rows = export_people(data)
    person_id_map = {row["person_name"]: row["person_id"] for row in people_rows}

    rows: list[dict] = []
    assignment_seq = 1

    for section in data["sections"]:
        for group in section["groups"]:
            group_id = group_ids[(section["name"], group["name"])]
            for part in group["parts"]:
                part_id = part_ids[(section["name"], group["name"], part["name"])]
                for team in part["teams"]:
                    team_id = team_ids[team["id"]]
                    for member in team["members"]:
                        tags = member.get("tags", [])
                        rows.append(
                            {
                                "assignment_id": f"assign-{assignment_seq:04d}",
                                "person_id": person_id_map[member["name"]],
                                "person_name": member["name"],
                                "section_name": section["name"],
                                "group_name": group["name"],
                                "part_name": part["name"],
                                "team_name": team["displayName"],
                                "group_org_id": group_id,
                                "part_org_id": part_id,
                                "team_org_id": team_id,
                                "role_raw": member["role"],
                                "role_display": "시니어매니저"
                                if group["name"] == "개발PFV TF" and member["name"] == "윤용택"
                                else member["role"],
                                "is_counted_in_dashboard": "Y" if should_count_member(group["name"], member) else "N",
                                "is_shared_role": "Y" if "겸직" in tags else "N",
                                "is_acting_role": "Y" if "대행" in tags else "N",
                                "is_external_hire": "Y" if "외부영입" in tags else "N",
                                "raw_name": member["rawName"],
                                "tags": "|".join(tags),
                            }
                        )
                        assignment_seq += 1

    return rows


def export_role_rules() -> list[dict]:
    return [
        {
            "rule_id": "rule-001",
            "scope": "global",
            "target": "외부영입",
            "rule_type": "exclude_from_count",
            "rule_value": "Y",
            "notes": "외부영입은 사람 이름이 아니라 충원 상태로 간주",
        },
        {
            "rule_id": "rule-002",
            "scope": "group",
            "target": "SS&C TF",
            "rule_type": "non_counted_names",
            "rule_value": "신호선|신동열|신민재|윤우섭",
            "notes": "화면 표시는 유지하되 전체 통계와 고유 인원에서는 제외",
        },
        {
            "rule_id": "rule-003",
            "scope": "group",
            "target": "SS&C TF",
            "rule_type": "exclude_role_from_count",
            "rule_value": "그룹장",
            "notes": "오윤석 TF 리더 표시로 인한 그룹장 중복 카운트 방지",
        },
        {
            "rule_id": "rule-004",
            "scope": "group",
            "target": "개발PFV TF",
            "rule_type": "display_role_override",
            "rule_value": "윤용택=시니어매니저",
            "notes": "대시보드 표시 역할 보정",
        },
    ]


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8-sig")
        return
    with path.open("w", newline="", encoding="utf-8-sig") as fp:
        writer = csv.DictWriter(fp, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    data = load_data()
    OUTPUT_DIR.mkdir(exist_ok=True)

    write_csv(OUTPUT_DIR / "sections.csv", export_sections(data))
    write_csv(OUTPUT_DIR / "organizations.csv", export_organizations(data))
    write_csv(OUTPUT_DIR / "people.csv", export_people(data))
    write_csv(OUTPUT_DIR / "assignments.csv", export_assignments(data))
    write_csv(OUTPUT_DIR / "role_rules.csv", export_role_rules())

    print(f"CSV exported to: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
