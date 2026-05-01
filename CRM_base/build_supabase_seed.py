import argparse
import hashlib
import json
import re
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
ORG_DIR = ROOT_DIR / "org_dashboard"
T5T_DIR = ROOT_DIR / "t5t-dashboard" / "data"
PORTFOLIO_DATA_DIR = BASE_DIR / "portfolio-analysis" / "data"
DEFAULT_OUT_DIR = BASE_DIR / "supabase_seed"
SHEET_CONFIG_PATH = ORG_DIR / "sheet-linked.config.js"

SYSTEM_SEAT_NAMES = {
    "공용pc",
    "공용 pc",
    "모션데스크",
    "모션 데스크",
    "motion desk",
}


def read_json(path):
    with path.open("r", encoding="utf-8-sig") as file:
        return json.load(file)


def read_sheet_config(path=SHEET_CONFIG_PATH):
    text = path.read_text(encoding="utf-8")

    def find_string(key):
        match = re.search(rf'{key}\s*:\s*"([^"]*)"', text)
        return match.group(1) if match else None

    def find_array(key):
        match = re.search(rf"{key}\s*:\s*\[([^\]]*)\]", text)
        if not match:
            return []
        return re.findall(r'"([^"]+)"', match.group(1))

    return {
        "webAppUrl": find_string("webAppUrl"),
        "accessKey": find_string("accessKey"),
        "seatSheets": find_array("seatSheets"),
        "seatSheet": find_string("seatSheet"),
    }


def fetch_google_sheet_payload(web_app_url=None, access_key=None, seat_sheets=None, timeout=30):
    config = read_sheet_config()
    web_app_url = web_app_url or config.get("webAppUrl")
    access_key = access_key or config.get("accessKey")
    seat_sheets = seat_sheets or config.get("seatSheets") or [config.get("seatSheet")]
    seat_sheets = [sheet for sheet in seat_sheets if sheet]
    if not web_app_url:
        raise RuntimeError("Google Apps Script webAppUrl is missing.")

    params = {}
    if access_key:
        params["key"] = access_key
    if seat_sheets:
        params["seat_sheets"] = ",".join(seat_sheets)
    url = web_app_url + ("&" if "?" in web_app_url else "?") + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8-sig"))
    if payload.get("ok") is False:
        raise RuntimeError(f"Google Sheet payload error: {payload.get('error')}")
    if not isinstance(payload.get("sections"), list):
        raise RuntimeError("Google Sheet payload does not contain sections.")
    return payload


def write_json(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(rows, file, ensure_ascii=False, indent=2)
        file.write("\n")


def clean_text(value):
    if value is None:
        return None
    text = str(value).replace("\xa0", " ").strip()
    if not text or text.lower() in {"nan", "none", "null", "undefined"}:
        return None
    return text


def clean_date(value):
    text = clean_text(value)
    if not text:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return text
    if re.match(r"^\d{8}$", text):
        return f"{text[:4]}-{text[4:6]}-{text[6:]}"
    return None


def clean_int(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(round(value))
    text = clean_text(value)
    if not text:
        return None
    text = text.replace(",", "").replace("%", "")
    try:
        return int(round(float(text)))
    except ValueError:
        return None


def make_id(prefix, *parts):
    raw = "|".join(clean_text(part) or "" for part in parts)
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{digest}"


def is_system_or_empty_name(name):
    text = clean_text(name)
    if not text:
        return True
    return text.lower().replace(" ", "") in {item.replace(" ", "") for item in SYSTEM_SEAT_NAMES}


def truthy_yn(value):
    return str(value or "").strip().upper() in {"Y", "YES", "TRUE", "1"}


def building_from_floor(floor_code):
    floor = clean_text(floor_code) or ""
    if floor.upper().startswith("CCMM"):
        return "CCMM"
    return "세우"


def add_org(orgs, org_id, org_name, org_type, parent_org_id=None, section=None,
            group_name=None, part_name=None, team_name=None, org_path=None,
            source_id=None, metadata=None):
    if org_id in orgs:
        existing = orgs[org_id]
        existing["metadata"].update(metadata or {})
        return
    orgs[org_id] = {
        "org_id": org_id,
        "org_name": org_name,
        "org_type": org_type,
        "parent_org_id": parent_org_id,
        "section": section,
        "group_name": group_name,
        "part_name": part_name,
        "team_name": team_name,
        "org_path": org_path,
        "source_system": "org_dashboard",
        "source_id": source_id,
        "is_active": True,
        "metadata": metadata or {},
    }


def build_orgs_and_org_staff(org_data):
    orgs = {}
    org_staff = {}
    team_path_by_id = {}

    for section_idx, section in enumerate(org_data.get("sections", []), start=1):
        section_name = clean_text(section.get("name"))
        section_id = f"org_section_{section_idx:02d}"
        add_org(
            orgs,
            section_id,
            section_name,
            "section",
            section=section_name,
            org_path=section_name,
            metadata={
                "assignment_count": section.get("assignmentCount"),
                "unique_people_count": section.get("uniquePeopleCount"),
            },
        )

        for group_idx, group in enumerate(section.get("groups", []), start=1):
            group_name = clean_text(group.get("name"))
            group_id = f"{section_id}_group_{group_idx:02d}"
            group_path = " > ".join(part for part in [section_name, group_name] if part)
            add_org(
                orgs,
                group_id,
                group_name,
                "group",
                parent_org_id=section_id,
                section=section_name,
                group_name=group_name,
                org_path=group_path,
                metadata={
                    "assignment_count": group.get("assignmentCount"),
                    "unique_people_count": group.get("uniquePeopleCount"),
                },
            )

            for part_idx, part in enumerate(group.get("parts", []), start=1):
                part_name = clean_text(part.get("name"))
                part_id = f"{group_id}_part_{part_idx:02d}"
                part_path = " > ".join(p for p in [section_name, group_name, part_name] if p)
                add_org(
                    orgs,
                    part_id,
                    part_name,
                    "part",
                    parent_org_id=group_id,
                    section=section_name,
                    group_name=group_name,
                    part_name=part_name,
                    org_path=part_path,
                    metadata={
                        "assignment_count": part.get("assignmentCount"),
                        "unique_people_count": part.get("uniquePeopleCount"),
                    },
                )

                for team_idx, team in enumerate(part.get("teams", []), start=1):
                    team_name = clean_text(team.get("team") or team.get("displayName"))
                    team_id = f"{part_id}_team_{team_idx:02d}"
                    team_path = clean_text(team.get("path")) or " > ".join(
                        p for p in [section_name, group_name, part_name, team_name] if p
                    )
                    team_path_by_id[team.get("id")] = team_id
                    add_org(
                        orgs,
                        team_id,
                        team_name,
                        "team",
                        parent_org_id=part_id,
                        section=section_name,
                        group_name=group_name,
                        part_name=part_name,
                        team_name=team_name,
                        org_path=team_path,
                        source_id=team.get("id"),
                        metadata={
                            "display_name": team.get("displayName"),
                            "assignment_count": team.get("assignmentCount"),
                            "unique_people_count": team.get("uniquePeopleCount"),
                            "legacy_team_id": team.get("id"),
                        },
                    )

                    for member in team.get("members", []):
                        name = clean_text(member.get("name"))
                        if not name:
                            continue
                        staff_id = make_id("staff_name", name)
                        assignment_id = make_id(
                            "org_assignment",
                            staff_id,
                            team_id,
                            member.get("role"),
                            member.get("rawName"),
                        )
                        org_staff[assignment_id] = {
                            "assignment_id": assignment_id,
                            "staff_id": staff_id,
                            "org_id": team_id,
                            "role": clean_text(member.get("role")),
                            "raw_name": clean_text(member.get("rawName")),
                            "is_primary": False,
                            "is_dual_role": "겸직" in (member.get("tags") or []),
                            "source_system": "org_dashboard",
                            "metadata": {
                                "tags": member.get("tags") or [],
                                "section": section_name,
                                "group": group_name,
                                "part": part_name,
                                "team": team_name,
                                "org_path": team_path,
                            },
                        }

    return orgs, org_staff, team_path_by_id


def build_staff(staff_master, org_assignments, seat_people):
    staff = {}

    def upsert_staff(row, priority):
        staff_id = row["staff_id"]
        current = staff.get(staff_id)
        if not current:
            row["_priority"] = priority
            staff[staff_id] = row
            return
        if priority >= current.get("_priority", 0):
            merged_metadata = current.get("metadata", {})
            merged_metadata.update(row.get("metadata", {}))
            row["metadata"] = merged_metadata
            row["_priority"] = priority
            staff[staff_id] = row

    for person in staff_master:
        employee_no = clean_text(person.get("사번"))
        name = clean_text(person.get("이름"))
        if not name:
            continue
        staff_id = f"staff_emp_{employee_no}" if employee_no else make_id("staff_name", name)
        status_raw = clean_text(person.get("재직상태"))
        status = "active" if status_raw in {None, "재직"} else status_raw
        upsert_staff(
            {
                "staff_id": staff_id,
                "employee_no": employee_no,
                "name": name,
                "eng_name": None,
                "email": clean_text(person.get("회사메일")),
                "title": clean_text(person.get("직위")),
                "level": clean_text(person.get("직급")),
                "position": clean_text(person.get("직책")),
                "org_id": None,
                "line_code": clean_text(person.get("라인코드")),
                "line_label": clean_text(person.get("라인라벨")),
                "status": status,
                "join_date": clean_date(person.get("입사일")),
                "leave_date": clean_date(person.get("퇴사일")),
                "is_dual_role": bool(clean_text(person.get("겸직부서"))),
                "cohort": clean_text(person.get("공채기수")),
                "notion_id": clean_text(person.get("_id")),
                "source_system": "t5t_staff_master",
                "metadata": {
                    "raw": person,
                    "org_full_name": clean_text(person.get("조직전체명")),
                    "standard_org_code": clean_text(person.get("표준조직코드")),
                    "department": clean_text(person.get("부서(조직 선택)")),
                    "detail_org": clean_text(person.get("세부조직")),
                },
            },
            priority=30,
        )

    name_to_staff_id = {row["name"]: row["staff_id"] for row in staff.values()}

    for assignment in org_assignments.values():
        name = clean_text(assignment.get("metadata", {}).get("raw_name")) or clean_text(assignment.get("raw_name"))
        name = clean_text(re.sub(r"\((겸|대행)\)", "", name or ""))
        staff_id = name_to_staff_id.get(name) or assignment["staff_id"]
        assignment["staff_id"] = staff_id
        name_to_staff_id.setdefault(name, staff_id)
        upsert_staff(
            {
                "staff_id": staff_id,
                "employee_no": None,
                "name": name,
                "eng_name": None,
                "email": None,
                "title": clean_text(assignment.get("role")),
                "level": None,
                "position": clean_text(assignment.get("role")),
                "org_id": assignment.get("org_id"),
                "line_code": None,
                "line_label": None,
                "status": "active",
                "join_date": None,
                "leave_date": None,
                "is_dual_role": assignment.get("is_dual_role", False),
                "cohort": None,
                "notion_id": None,
                "source_system": "org_dashboard",
                "metadata": {
                    "org_assignment": assignment.get("metadata", {}),
                },
            },
            priority=10,
        )

    for name in sorted(seat_people):
        if is_system_or_empty_name(name):
            continue
        staff_id = name_to_staff_id.get(name) or make_id("staff_name", name)
        upsert_staff(
            {
                "staff_id": staff_id,
                "employee_no": None,
                "name": name,
                "eng_name": None,
                "email": None,
                "title": None,
                "level": None,
                "position": None,
                "org_id": None,
                "line_code": None,
                "line_label": None,
                "status": "active",
                "join_date": None,
                "leave_date": None,
                "is_dual_role": False,
                "cohort": None,
                "notion_id": None,
                "source_system": "seat_layout",
                "metadata": {"source_note": "Created from seat assignment only."},
            },
            priority=5,
        )

    for row in staff.values():
        row.pop("_priority", None)
    return staff, {row["name"]: row["staff_id"] for row in staff.values()}


def build_seats_and_shapes(layout_data, name_to_staff_id):
    seats = {}
    shapes = {}
    seat_people = set()

    for floor in layout_data.get("floors", []):
        floor_code = clean_text(floor.get("floorCode"))
        building = building_from_floor(floor_code)
        seat_defs = {seat.get("seatCode"): seat for seat in floor.get("seatDefs", [])}

        for shape in floor.get("shapes", []):
            shape_id = clean_text(shape.get("shapeId")) or make_id("shape", floor_code, shape.get("source"))
            shapes[shape_id] = {
                "shape_id": shape_id,
                "floor": floor_code,
                "building": building,
                "shape_type": clean_text(shape.get("shapeType")),
                "label": clean_text(shape.get("label")),
                "x": shape.get("x"),
                "y": shape.get("y"),
                "w": shape.get("w"),
                "h": shape.get("h"),
                "source_cell": clean_text(shape.get("source")),
                "metadata": shape,
            }

        scenarios = floor.get("scenarios") or {}
        for scenario_name, scenario in scenarios.items():
            assignments = scenario.get("assignments") or {}
            for seat_code, assignment in assignments.items():
                seat_def = seat_defs.get(seat_code, {})
                person_name = clean_text(assignment.get("personName"))
                if person_name:
                    seat_people.add(person_name)
                staff_id = None if is_system_or_empty_name(person_name) else name_to_staff_id.get(person_name)
                seat_type = "empty"
                if person_name:
                    seat_type = "system" if is_system_or_empty_name(person_name) else "normal"
                seat_id = f"{scenario_name}:{seat_code}"
                seats[seat_id] = {
                    "seat_id": seat_id,
                    "scenario": scenario_name,
                    "seat_code": clean_text(seat_code),
                    "building": building,
                    "floor": floor_code,
                    "seat_label": clean_text(seat_def.get("seatLabel")),
                    "seat_type": seat_type,
                    "x": seat_def.get("x"),
                    "y": seat_def.get("y"),
                    "w": seat_def.get("w"),
                    "h": seat_def.get("h"),
                    "source_cell": clean_text(seat_def.get("sourceCell")),
                    "sheet_name": clean_text(assignment.get("sheetName")),
                    "staff_id": staff_id,
                    "person_name": person_name,
                    "org_id": None,
                    "source_team_org_id": clean_text(assignment.get("teamOrgIdSeat") or assignment.get("team_org_id_seat")),
                    "origin_floor_code": clean_text(assignment.get("originFloorCode") or assignment.get("origin_floor_code")),
                    "origin_seat_code": clean_text(assignment.get("originSeatCode") or assignment.get("origin_seat_code")),
                    "is_moving": truthy_yn(assignment.get("isMoved") or assignment.get("is_moved")),
                    "is_external_division": truthy_yn(
                        assignment.get("isExternalDivision") or assignment.get("is_external_division")
                    ),
                    "note": clean_text(assignment.get("note")),
                    "metadata": {
                        "assignment": assignment,
                        "seat_def": seat_def,
                        "floor_display_name": floor.get("displayName"),
                    },
                }

    return seats, shapes, seat_people


def build_seats_from_google_rows(payload, name_to_staff_id, layout_data=None):
    seats = {}
    shapes = {}
    seat_people = set()
    seat_defs = {}

    if layout_data:
        for floor in layout_data.get("floors", []):
            floor_code = clean_text(floor.get("floorCode"))
            building = building_from_floor(floor_code)
            for seat in floor.get("seatDefs", []):
                seat_code = clean_text(seat.get("seatCode"))
                if not seat_code:
                    continue
                seat_defs[seat_code] = seat
            for shape in floor.get("shapes", []):
                shape_id = clean_text(shape.get("shapeId")) or make_id("shape", floor_code, shape.get("source"))
                shapes[shape_id] = {
                    "shape_id": shape_id,
                    "floor": floor_code,
                    "building": building,
                    "shape_type": clean_text(shape.get("shapeType")),
                    "label": clean_text(shape.get("label")),
                    "x": shape.get("x"),
                    "y": shape.get("y"),
                    "w": shape.get("w"),
                    "h": shape.get("h"),
                    "source_cell": clean_text(shape.get("source")),
                    "metadata": {
                        **shape,
                        "source_note": "Static geometry fallback from local seat-layout-data.json.",
                    },
                }

    seat_layout = payload.get("seatLayout") or {}
    rows = seat_layout.get("rows") or []
    for row in rows:
        seat_code = clean_text(row.get("seat_code"))
        if not seat_code:
            continue
        floor_code = clean_text(row.get("floor_code"))
        seat_def = seat_defs.get(seat_code, {})
        person_name = clean_text(row.get("person_name"))
        if person_name:
            seat_people.add(person_name)
        staff_id = None if is_system_or_empty_name(person_name) else name_to_staff_id.get(person_name)
        seat_type = "empty"
        if person_name:
            seat_type = "system" if is_system_or_empty_name(person_name) else "normal"
        seat_id = f"current:{seat_code}"
        seats[seat_id] = {
            "seat_id": seat_id,
            "scenario": "current",
            "seat_code": seat_code,
            "building": building_from_floor(floor_code),
            "floor": floor_code,
            "seat_label": clean_text(row.get("seat_label")) or clean_text(seat_def.get("seatLabel")),
            "seat_type": seat_type,
            "x": seat_def.get("x"),
            "y": seat_def.get("y"),
            "w": seat_def.get("w"),
            "h": seat_def.get("h"),
            "source_cell": clean_text(seat_def.get("sourceCell")),
            "sheet_name": clean_text(row.get("sheet_name") or seat_layout.get("sheetName")),
            "staff_id": staff_id,
            "person_name": person_name,
            "org_id": None,
            "source_team_org_id": clean_text(row.get("team_org_id_seat")),
            "origin_floor_code": clean_text(row.get("origin_floor_code")),
            "origin_seat_code": clean_text(row.get("origin_seat_code")),
            "is_moving": truthy_yn(row.get("is_moved")),
            "is_external_division": truthy_yn(row.get("is_external_division")),
            "note": clean_text(row.get("note")),
            "metadata": {
                "source": "google_sheet_webapp",
                "row": row,
                "seat_def": seat_def,
                "updated_at": seat_layout.get("updatedAt"),
            },
        }

    return seats, shapes, seat_people


def build_aum_snapshots(aum_history, current_snapshot):
    snapshots = {}
    for row in aum_history:
        year = clean_int(row.get("year"))
        region = clean_text(row.get("region"))
        sector = clean_text(row.get("sector"))
        snapshot_id = make_id("aum_annual", year, region, sector)
        snapshots[snapshot_id] = {
            "snapshot_id": snapshot_id,
            "fund_id": None,
            "snapshot_date": f"{year}-12-31" if year else None,
            "snapshot_year": year,
            "region": region,
            "sector": sector,
            "aum": clean_int(row.get("aum")),
            "loan": clean_int(row.get("loan")),
            "equity": clean_int(row.get("equity")),
            "deposit": None,
            "is_liquidated": False,
            "source_system": "portfolio_aum_history",
            "metadata": row,
        }

    for row in current_snapshot.get("records", []):
        fund_id = clean_text(row.get("fund_id"))
        if not fund_id or clean_text(row.get("short_name")) == "합계":
            continue
        snapshot_date = clean_date(row.get("aum_input_date"))
        snapshot_id = make_id("aum_current", fund_id, snapshot_date)
        snapshots[snapshot_id] = {
            "snapshot_id": snapshot_id,
            "fund_id": fund_id,
            "snapshot_date": snapshot_date,
            "snapshot_year": int(snapshot_date[:4]) if snapshot_date else None,
            "region": None,
            "sector": clean_text(row.get("sector")),
            "aum": clean_int(row.get("aum_won")),
            "loan": clean_int(row.get("loan_won")),
            "equity": clean_int(row.get("equity_won")),
            "deposit": clean_int(row.get("deposit_won")),
            "is_liquidated": clean_text(row.get("status")) == "청산",
            "source_system": "current_aum_snapshot",
            "metadata": row,
        }
    return snapshots


def build_fund_lifecycle(current_snapshot):
    lifecycle = {}
    for row in current_snapshot.get("records", []):
        fund_id = clean_text(row.get("fund_id"))
        if not fund_id or clean_text(row.get("short_name")) == "합계":
            continue
        status = clean_text(row.get("status"))
        lifecycle[fund_id] = {
            "fund_id": fund_id,
            "op_status": status,
            "setup_date": clean_date(row.get("setup_date")),
            "maturity_date": clean_date(row.get("maturity_date")),
            "liquidation_date": clean_date(row.get("aum_input_date")) if status == "청산" else None,
            "is_aum_target": status != "청산",
            "aum_base": clean_int(row.get("aum_won")),
            "aum_base_date": clean_date(row.get("aum_input_date")),
            "short_name": clean_text(row.get("short_name")),
            "fund_name": clean_text(row.get("fund_name")),
            "sector": clean_text(row.get("sector")),
            "asset_name": clean_text(row.get("asset_name")),
            "source_system": "current_aum_snapshot",
            "metadata": row,
        }
    return lifecycle


def build_seed(out_dir, source="google-sheets", web_app_url=None, access_key=None, seat_sheets=None):
    layout_data = read_json(ORG_DIR / "seat-layout-data.json")
    if source == "google-sheets":
        org_data = fetch_google_sheet_payload(web_app_url, access_key, seat_sheets)
    else:
        org_data = read_json(ORG_DIR / "org-data.json")
    staff_master = read_json(T5T_DIR / "staff_master.json")
    aum_history = read_json(PORTFOLIO_DATA_DIR / "aum_history.json")
    current_snapshot = read_json(PORTFOLIO_DATA_DIR / "current_aum_snapshot.json")

    orgs, org_assignments, _ = build_orgs_and_org_staff(org_data)
    if source == "google-sheets":
        raw_seats, shapes, seat_people = build_seats_from_google_rows(org_data, {}, layout_data)
    else:
        raw_seats, shapes, seat_people = build_seats_and_shapes(layout_data, {})
    staff, name_to_staff_id = build_staff(staff_master, org_assignments, seat_people)
    if source == "google-sheets":
        seats, shapes, _ = build_seats_from_google_rows(org_data, name_to_staff_id, layout_data)
    else:
        seats, shapes, _ = build_seats_and_shapes(layout_data, name_to_staff_id)
    aum_snapshots = build_aum_snapshots(aum_history, current_snapshot)
    fund_lifecycle = build_fund_lifecycle(current_snapshot)

    datasets = {
        "orgs": sorted(orgs.values(), key=lambda row: row["org_id"]),
        "staff": sorted(staff.values(), key=lambda row: row["staff_id"]),
        "staff_org_assignments": sorted(org_assignments.values(), key=lambda row: row["assignment_id"]),
        "seats": sorted(seats.values(), key=lambda row: row["seat_id"]),
        "seat_layout_shapes": sorted(shapes.values(), key=lambda row: row["shape_id"]),
        "aum_snapshots": sorted(aum_snapshots.values(), key=lambda row: row["snapshot_id"]),
        "fund_lifecycle": sorted(fund_lifecycle.values(), key=lambda row: row["fund_id"]),
    }

    for name, rows in datasets.items():
        write_json(out_dir / f"{name}.json", rows)

    manifest = {
        "generated_at": date.today().isoformat(),
        "seed_source": source,
        "source_files": {
            "orgs": "Google Apps Script WebApp" if source == "google-sheets" else str(ORG_DIR / "org-data.json"),
            "seats": "Google Apps Script WebApp seatLayout.rows; local seat-layout-data.json for static geometry",
            "staff": str(T5T_DIR / "staff_master.json"),
            "aum_snapshots": str(PORTFOLIO_DATA_DIR / "aum_history.json"),
            "fund_lifecycle": str(PORTFOLIO_DATA_DIR / "current_aum_snapshot.json"),
        },
        "counts": {name: len(rows) for name, rows in datasets.items()},
        "note": "Dashboards are not switched to these tables yet. This is a migration seed layer.",
    }
    write_json(out_dir / "manifest.json", manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Build Supabase seed JSON for dashboard DB migration.")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Output directory for seed JSON files.")
    parser.add_argument(
        "--source",
        choices=["google-sheets", "json"],
        default="google-sheets",
        help="Use Google Apps Script payload as the org/seat source, or local JSON fallback.",
    )
    parser.add_argument("--web-app-url", help="Override Google Apps Script WebApp URL.")
    parser.add_argument("--access-key", help="Override Google Apps Script access key.")
    parser.add_argument(
        "--seat-sheet",
        action="append",
        help="Seat sheet name to request from Google Apps Script. Can repeat.",
    )
    args = parser.parse_args()
    manifest = build_seed(
        Path(args.out_dir),
        source=args.source,
        web_app_url=args.web_app_url,
        access_key=args.access_key,
        seat_sheets=args.seat_sheet,
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
