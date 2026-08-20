import argparse
import csv
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
import requests


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "01. RA Portal" / "output" / "development_projects_34_20260630"
DDL_PATH = ROOT / "01. RA Portal" / "migrations" / "2026-06-30_dev_project_enrichment_evidence.sql"
PROJECT_MISSION_DB_ID = "2a98ced4-3c47-8100-990f-e2d33b2b3d3e"

FIELD_LABELS = {
    "project_status": "프로젝트 상태",
    "vehicle_class": "비히클 분류",
    "holding_type": "보유형태",
    "business_stage": "사업단계",
    "asset_type": "자산유형",
    "asset_nature": "자산성격",
    "address_text": "주소",
    "main_usage": "주용도",
    "site_area_sqm": "대지면적",
    "gross_floor_area_sqm": "연면적",
    "gross_floor_area_pyeong": "연면적(평)",
    "scr_percent": "건폐율",
    "far_percent": "용적률",
    "completion_date": "준공일",
    "setup_date": "설정일",
    "maturity_date": "만기일",
    "benchmark_aum_won": "기준 AUM",
    "invested_aum_won": "투자 AUM",
    "aum_won": "AUM",
    "equity_won": "Equity 총액",
    "loan_won": "Loan 총액",
    "legal_form": "법적 형태",
    "manager_text": "담당자",
    "dept_text": "담당부서",
    "source_asset_name": "자산명",
    "lender_text": "대주정보",
    "beneficiary_text": "수익자정보",
    "irms_risk_factor": "IRMS 위험관리계수",
}

SOURCE_PRIORITY = {
    "sql_asset_building_ledger": 95,
    "sql_asset_master": 90,
    "sql_funds": 86,
    "sql_projects": 82,
    "notion_project_mission_live": 78,
    "notion_new_project_live": 72,
    "notion_project_mission_snapshot": 58,
    "local_spreadsheet": 55,
    "local_csv": 50,
}

GENERIC_TOKENS = {
    "",
    "pfv",
    "fund",
    "project",
    "mission",
    "개발",
    "사업",
    "개발사업",
    "운용",
    "설정후",
}


def read_key_values(path: Path) -> dict:
    values = {}
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key, value = stripped.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def normalize(value) -> str:
    text = str(value or "").lower()
    text = text.replace("&", "앤드")
    return re.sub(r"[^0-9a-z가-힣]+", "", text)


def compact_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        raw = value
    else:
        raw = [value]
    result = []
    seen = set()
    for item in raw:
        if item is None:
            continue
        text = str(item).strip()
        if not text or text in {"0", "#N/A", "nan", "NaN", "None"}:
            continue
        key = normalize(text)
        if key and key not in seen:
            seen.add(key)
            result.append(item)
    return result


def parse_date(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        text = value.isoformat()
    else:
        text = str(value).strip()
    if not text or text.lower() in {"nan", "nat", "none"}:
        return None
    match = re.search(r"\d{4}-\d{2}-\d{2}", text)
    if match:
        return match.group(0)
    for fmt in ("%Y.%m.%d", "%Y/%m/%d", "%Y%m%d"):
        try:
            return datetime.strptime(text[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return None


def parse_number(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and not pd.isna(value):
        return float(value)
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "nat", "#n/a"}:
        return None
    text = text.replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    return float(match.group(0))


def value_to_text(value):
    if value is None:
        return None
    if isinstance(value, list):
        items = [value_to_text(item) for item in value]
        items = [item for item in items if item]
        return " | ".join(items) if items else None
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value).strip()
    if not text or text.lower() in {"nan", "nat", "none"}:
        return None
    return text


def plain_text(parts):
    return "".join(part.get("plain_text", "") for part in parts or []).strip()


def notion_value(prop):
    if prop is None:
        return None
    ptype = prop.get("type")
    if ptype in {"title", "rich_text"}:
        return plain_text(prop.get(ptype, []))
    if ptype == "select":
        return prop.get("select", {}).get("name") if prop.get("select") else None
    if ptype == "multi_select":
        return [item.get("name") for item in prop.get("multi_select", []) if item.get("name")]
    if ptype == "number":
        return prop.get("number")
    if ptype == "checkbox":
        return prop.get("checkbox")
    if ptype == "date":
        date = prop.get("date")
        return date.get("start") if date else None
    if ptype == "relation":
        return [item.get("id") for item in prop.get("relation", []) if item.get("id")]
    if ptype == "formula":
        return notion_value(prop.get("formula"))
    if ptype == "rollup":
        rollup = prop.get("rollup", {})
        rtype = rollup.get("type")
        if rtype == "array":
            values = []
            for item in rollup.get("array", []):
                item_value = notion_value(item)
                if isinstance(item_value, list):
                    values.extend(item_value)
                elif item_value is not None:
                    values.append(item_value)
            return compact_list(values)
        return notion_value(rollup)
    return prop.get(ptype)


def notion_page_to_row(page):
    props = page.get("properties", {})
    row = {
        "_id": page.get("id"),
        "_url": page.get("url"),
        "_last_edited_time": page.get("last_edited_time"),
    }
    for name, prop in props.items():
        row[name] = notion_value(prop)
    return row


def query_notion_database_all(database_id, notion_key, filter_payload=None, page_size=100):
    headers = {
        "Authorization": f"Bearer {notion_key}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
    }
    results = []
    cursor = None
    while True:
        payload = {"page_size": page_size}
        if filter_payload:
            payload["filter"] = filter_payload
        if cursor:
            payload["start_cursor"] = cursor
        response = requests.post(
            f"https://api.notion.com/v1/databases/{database_id}/query",
            headers=headers,
            json=payload,
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()
        results.extend(notion_page_to_row(item) for item in data.get("results", []))
        if not data.get("has_more"):
            return results
        cursor = data.get("next_cursor")


class SupabaseAdmin:
    def __init__(self, env):
        self.ref = urlparse(env["SUPABASE_URL"]).netloc.split(".")[0]
        self.headers = {
            "Authorization": f"Bearer {env['token']}",
            "Content-Type": "application/json",
        }

    def query(self, sql, read_only=True, timeout=240):
        endpoint = "query/read-only" if read_only else "query"
        response = requests.post(
            f"https://api.supabase.com/v1/projects/{self.ref}/database/{endpoint}",
            headers=self.headers,
            json={"query": sql} if read_only else {"query": sql, "read_only": False},
            timeout=timeout,
        )
        response.raise_for_status()
        return response.json()


def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"


def build_project_tokens(row):
    token_values = [
        row.get("project_name"),
        row.get("vehicle_text"),
        *(row.get("asset_names") or []),
        *(row.get("fund_short_names") or []),
        *(row.get("fund_names") or []),
    ]
    tokens = []
    for value in token_values:
        text = str(value or "").strip()
        key = normalize(text)
        if len(key) >= 4 and key not in GENERIC_TOKENS:
            tokens.append((text, key))
    deduped = []
    seen = set()
    for text, key in tokens:
        if key not in seen:
            seen.add(key)
            deduped.append((text, key))
    return deduped


def match_score(project, source_row, title_keys):
    source_text = " ".join(value_to_text(v) or "" for v in source_row.values())
    source_norm = normalize(source_text)
    title_values = [source_row.get(key) for key in title_keys if source_row.get(key)]
    title_norms = [normalize(value) for value in title_values]
    project_norm = normalize(project.get("project_name"))
    vehicle_norm = normalize(project.get("vehicle_text"))

    if project_norm and project_norm in title_norms:
        return 0.99, "title_exact"
    if any(project_norm and (project_norm in title or title in project_norm) for title in title_norms):
        return 0.94, "title_contains"
    if vehicle_norm and len(vehicle_norm) >= 4 and vehicle_norm in source_norm:
        return 0.88, "vehicle_text_contains"

    best = (0.0, "no_match")
    for raw, token in project["tokens"]:
        if token and token in source_norm:
            score = 0.78 if raw in (project.get("asset_names") or []) + (project.get("fund_names") or []) else 0.72
            if score > best[0]:
                best = (score, "token_contains")
    return best


def evidence_hash(payload):
    keys = [
        payload.get("dev_project_id"),
        payload.get("entity_type"),
        payload.get("entity_id"),
        payload.get("field_name"),
        payload.get("value_text"),
        str(payload.get("value_numeric")),
        str(payload.get("value_date")),
        payload.get("source_system"),
        payload.get("source_name"),
        payload.get("source_record_id"),
    ]
    raw = "|".join("" if item is None else str(item) for item in keys)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def make_evidence(project, field_name, value, *, source_system, source_name, match_method,
                  confidence, run_id, entity_type="dev_project", entity_id=None,
                  source_record_id=None, source_path=None, source_updated_at=None,
                  unit=None, notes=None, metadata=None, needs_review=False):
    values = compact_list(value)
    rows = []
    for item in values:
        text_value = value_to_text(item)
        if text_value is None:
            continue
        numeric_value = parse_number(item) if field_name.endswith(("_sqm", "_pyeong", "_percent", "_won")) or field_name in {"irms_risk_factor"} else None
        date_value = parse_date(item) if field_name.endswith("_date") else None
        item_needs_review = needs_review
        item_notes = notes
        if numeric_value == 0 and field_name in {"site_area_sqm", "gross_floor_area_sqm", "gross_floor_area_pyeong", "scr_percent", "far_percent", "benchmark_aum_won", "invested_aum_won", "aum_won"}:
            item_needs_review = True
            item_notes = "; ".join(filter(None, [item_notes, "zero value requires confirmation"]))
        payload = {
            "run_id": run_id,
            "dev_project_id": project["dev_project_id"],
            "list_no": project["list_no"],
            "project_name_snapshot": project["project_name"],
            "entity_type": entity_type,
            "entity_id": entity_id,
            "field_name": field_name,
            "field_label": FIELD_LABELS[field_name],
            "value_text": text_value,
            "value_numeric": numeric_value,
            "value_date": date_value,
            "value_json": item if isinstance(item, (dict, list)) else None,
            "unit": unit,
            "source_system": source_system,
            "source_name": source_name,
            "source_priority": SOURCE_PRIORITY.get(source_system, 50),
            "source_record_id": source_record_id,
            "source_path": source_path,
            "source_updated_at": source_updated_at,
            "match_method": match_method,
            "confidence": confidence,
            "needs_review": item_needs_review,
            "notes": item_notes,
            "metadata": metadata or {},
            "is_active": True,
        }
        payload["evidence_hash"] = evidence_hash(payload)
        rows.append(payload)
    return rows


def add_sql_evidence(projects, admin, run_id):
    rows = []
    project_by_id = {p["dev_project_id"]: p for p in projects}

    fund_sql = """
    select
        dpl.dev_project_id,
        f.fund_id,
        f.short_name,
        f.fund_name,
        f.status,
        f.setup_date,
        f.maturity_date,
        f.dept,
        f.manager,
        f.legal_form,
        f.notion_vehicle_class,
        f.notion_business_stage_class,
        f.notion_holding_type_class,
        f.notion_base_asset_class,
        f.benchmark_aum,
        f.invested_aum
    from public.dev_project_list dpl
    join public.dev_project_fund_links dpfl on dpfl.dev_project_id = dpl.dev_project_id
    join public.funds f on f.fund_id = dpfl.fund_id;
    """
    for row in admin.query(fund_sql):
        project = project_by_id[row["dev_project_id"]]
        meta = {"fund_id": row["fund_id"], "short_name": row.get("short_name"), "fund_name": row.get("fund_name")}
        mapping = [
            ("project_status", row.get("status"), None),
            ("setup_date", row.get("setup_date"), None),
            ("maturity_date", row.get("maturity_date"), None),
            ("dept_text", row.get("dept"), None),
            ("manager_text", row.get("manager"), None),
            ("legal_form", row.get("legal_form"), None),
            ("vehicle_class", row.get("notion_vehicle_class"), None),
            ("business_stage", row.get("notion_business_stage_class"), None),
            ("holding_type", row.get("notion_holding_type_class"), None),
            ("asset_type", row.get("notion_base_asset_class"), None),
            ("benchmark_aum_won", row.get("benchmark_aum"), "KRW"),
            ("invested_aum_won", row.get("invested_aum"), "KRW"),
        ]
        for field, value, unit in mapping:
            rows.extend(make_evidence(project, field, value, source_system="sql_funds", source_name="public.funds",
                                      match_method="linked_fund_id", confidence=0.9, run_id=run_id,
                                      entity_type="fund", entity_id=row["fund_id"], source_record_id=row["fund_id"],
                                      unit=unit, metadata=meta))

    asset_sql = """
    select
        dpl.dev_project_id,
        am.asset_id,
        am.canonical_name,
        am.asset_type,
        am.address_text,
        am.main_usage,
        am.site_area as am_site_area,
        am.gross_floor_area as am_gross_floor_area,
        am.scr as am_scr,
        am.far as am_far,
        am.completion_date as am_completion_date,
        am.updated_at as am_updated_at,
        abl.site_area as ledger_site_area,
        abl.gross_floor_area as ledger_gross_floor_area,
        abl.scr as ledger_scr,
        abl.far as ledger_far,
        abl.main_usage as ledger_main_usage,
        abl.completion_date as ledger_completion_date,
        abl.updated_at as ledger_updated_at,
        abl.source_table as ledger_source_table,
        abl.source_id as ledger_source_id,
        abl.confidence as ledger_confidence
    from public.dev_project_list dpl
    join public.dev_project_asset_links dpal on dpal.dev_project_id = dpl.dev_project_id
    join public.asset_master am on am.asset_id = dpal.asset_id
    left join public.asset_building_ledger abl on abl.asset_id = am.asset_id;
    """
    for row in admin.query(asset_sql):
        project = project_by_id[row["dev_project_id"]]
        meta = {"asset_id": row["asset_id"], "asset_name": row.get("canonical_name")}
        asset_mapping = [
            ("source_asset_name", row.get("canonical_name"), None),
            ("asset_type", row.get("asset_type"), None),
            ("address_text", row.get("address_text"), None),
            ("main_usage", row.get("main_usage"), None),
            ("site_area_sqm", row.get("am_site_area"), "sqm"),
            ("gross_floor_area_sqm", row.get("am_gross_floor_area"), "sqm"),
            ("scr_percent", row.get("am_scr"), "percent"),
            ("far_percent", row.get("am_far"), "percent"),
            ("completion_date", row.get("am_completion_date"), None),
        ]
        for field, value, unit in asset_mapping:
            rows.extend(make_evidence(project, field, value, source_system="sql_asset_master", source_name="public.asset_master",
                                      match_method="linked_asset_id", confidence=0.9, run_id=run_id,
                                      entity_type="asset", entity_id=row["asset_id"], source_record_id=row["asset_id"],
                                      source_updated_at=row.get("am_updated_at"), unit=unit, metadata=meta))
        ledger_mapping = [
            ("main_usage", row.get("ledger_main_usage"), None),
            ("site_area_sqm", row.get("ledger_site_area"), "sqm"),
            ("gross_floor_area_sqm", row.get("ledger_gross_floor_area"), "sqm"),
            ("scr_percent", row.get("ledger_scr"), "percent"),
            ("far_percent", row.get("ledger_far"), "percent"),
            ("completion_date", row.get("ledger_completion_date"), None),
        ]
        for field, value, unit in ledger_mapping:
            rows.extend(make_evidence(project, field, value, source_system="sql_asset_building_ledger",
                                      source_name=row.get("ledger_source_table") or "public.asset_building_ledger",
                                      match_method="linked_asset_id", confidence=float(row.get("ledger_confidence") or 0.92),
                                      run_id=run_id, entity_type="asset", entity_id=row["asset_id"],
                                      source_record_id=row.get("ledger_source_id") or row["asset_id"],
                                      source_updated_at=row.get("ledger_updated_at"), unit=unit, metadata=meta))
    return rows


def add_notion_rows_evidence(projects, source_rows, *, source_system, source_name, run_id, title_keys, field_map, min_score):
    evidence = []
    for source in source_rows:
        best_matches = []
        for project in projects:
            score, method = match_score(project, source, title_keys)
            if score >= min_score:
                best_matches.append((score, method, project))
        if not best_matches:
            continue
        best_matches.sort(key=lambda item: item[0], reverse=True)
        for score, method, project in best_matches[:3]:
            for field, source_key, unit, transform in field_map:
                value = source.get(source_key)
                if transform and value is not None:
                    value = transform(value)
                evidence.extend(make_evidence(
                    project,
                    field,
                    value,
                    source_system=source_system,
                    source_name=source_name,
                    match_method=method,
                    confidence=score,
                    run_id=run_id,
                    source_record_id=source.get("_id") or value_to_text(source.get(title_keys[0])),
                    source_path=source.get("_url"),
                    source_updated_at=source.get("_last_edited_time"),
                    unit=unit,
                    metadata={key: source.get(key) for key in title_keys + ["Vehicle(약칭)", "Vehicle(약칭)(롤업)", "프로젝트 이름"] if key in source},
                    needs_review=score < 0.82,
                ))
    return evidence


def transform_eok_to_won(value):
    values = compact_list(value)
    transformed = []
    for item in values:
        num = parse_number(item)
        if num is not None:
            transformed.append(num * 100000000)
    return transformed


def transform_pyeong_to_sqm(value):
    values = compact_list(value)
    transformed = []
    for item in values:
        num = parse_number(item)
        if num is not None:
            transformed.append(num * 3.305785)
    return transformed


def add_local_tabular_evidence(projects, run_id):
    paths = []
    paths.extend((ROOT / "00. Raw Data").rglob("*.xlsx"))
    paths.extend((ROOT / "01. RA Portal").glob("*.xlsx"))
    paths.extend((ROOT / "01. RA Portal").glob("*.csv"))
    evidence = []
    source_profiles = []

    column_rules = [
        ("address_text", re.compile(r"(주소|소재지)", re.I), None),
        ("site_area_sqm", re.compile(r"대지.*면적|site.*area", re.I), "sqm"),
        ("gross_floor_area_sqm", re.compile(r"연면적(?!.*평)|gross.*floor", re.I), "sqm"),
        ("gross_floor_area_pyeong", re.compile(r"연면적.*평", re.I), "pyeong"),
        ("scr_percent", re.compile(r"건폐율|bcRat|scr", re.I), "percent"),
        ("far_percent", re.compile(r"용적률|vlRat|far", re.I), "percent"),
        ("completion_date", re.compile(r"준공|사용승인|completion|useApr", re.I), None),
        ("main_usage", re.compile(r"주용도|용도|usage", re.I), None),
        ("setup_date", re.compile(r"설정일|setup", re.I), None),
        ("maturity_date", re.compile(r"만기|maturity", re.I), None),
        ("benchmark_aum_won", re.compile(r"기준.*AUM|benchmark", re.I), "KRW"),
        ("invested_aum_won", re.compile(r"투자.*AUM|invested", re.I), "KRW"),
        ("aum_won", re.compile(r"(^|[^a-z])AUM|순자산|총액", re.I), "KRW"),
        ("legal_form", re.compile(r"법적|legal", re.I), None),
        ("project_status", re.compile(r"상태|진행", re.I), None),
        ("manager_text", re.compile(r"담당|manager|PM", re.I), None),
        ("dept_text", re.compile(r"부서|파트|그룹|dept", re.I), None),
        ("source_asset_name", re.compile(r"자산명|asset.*name", re.I), None),
        ("asset_type", re.compile(r"자산.*유형|섹터|sector", re.I), None),
    ]

    for path in sorted(set(paths)):
        try:
            if path.suffix.lower() == ".csv":
                frames = {"csv": pd.read_csv(path, dtype=object, encoding="utf-8-sig")}
            else:
                frames = pd.read_excel(path, sheet_name=None, dtype=object)
        except Exception as exc:
            source_profiles.append({"path": str(path), "status": "read_error", "error": str(exc)})
            continue

        for sheet_name, frame in frames.items():
            if frame is None or frame.empty:
                continue
            frame = frame.dropna(how="all")
            columns = [str(col).strip() for col in frame.columns]
            source_profiles.append({"path": str(path), "sheet": str(sheet_name), "rows": len(frame), "columns": columns[:50]})
            matched_columns = [(field, col, unit) for field, pattern, unit in column_rules for col in columns if pattern.search(col)]
            if not matched_columns:
                continue

            for _, record in frame.iterrows():
                row_dict = {str(k).strip(): v for k, v in record.to_dict().items()}
                row_text = " ".join(value_to_text(v) or "" for v in row_dict.values())
                row_norm = normalize(row_text)
                if not row_norm:
                    continue
                for project in projects:
                    token_hits = [raw for raw, token in project["tokens"] if token in row_norm]
                    if not token_hits:
                        continue
                    confidence = 0.72 if any(normalize(project["project_name"]) in row_norm for _ in [0]) else 0.62
                    for field, col, unit in matched_columns:
                        value = row_dict.get(col)
                        if field == "gross_floor_area_sqm" and "평" in col:
                            continue
                        evidence.extend(make_evidence(
                            project,
                            field,
                            value,
                            source_system="local_csv" if path.suffix.lower() == ".csv" else "local_spreadsheet",
                            source_name=f"{path.name}:{sheet_name}",
                            match_method="row_token_contains",
                            confidence=confidence,
                            run_id=run_id,
                            source_record_id=hashlib.sha1(row_text.encode("utf-8", errors="ignore")).hexdigest(),
                            source_path=str(path),
                            unit=unit,
                            metadata={"matched_tokens": token_hits[:10], "column": col, "sheet": str(sheet_name)},
                            needs_review=confidence < 0.75,
                        ))
    return evidence, source_profiles


def insert_evidence(admin, run_id, rows, source_scope, summary):
    now = datetime.now(timezone.utc).isoformat()
    run_sql = f"""
    insert into public.dev_project_source_runs (
        run_id, run_label, started_at, completed_at, source_scope, row_count, summary
    ) values (
        {sql_literal(run_id)},
        'development project enrichment candidate build',
        {sql_literal(now)}::timestamptz,
        {sql_literal(now)}::timestamptz,
        array[{','.join(sql_literal(x) for x in source_scope)}]::text[],
        {len(rows)},
        {sql_literal(json.dumps(summary, ensure_ascii=False))}::jsonb
    )
    on conflict (run_id) do update set
        completed_at = excluded.completed_at,
        source_scope = excluded.source_scope,
        row_count = excluded.row_count,
        summary = excluded.summary;
    """
    admin.query(run_sql, read_only=False)

    cols = [
        "evidence_hash", "run_id", "dev_project_id", "list_no", "project_name_snapshot",
        "entity_type", "entity_id", "field_name", "field_label", "value_text",
        "value_numeric", "value_date", "value_json", "unit", "source_system",
        "source_name", "source_priority", "source_record_id", "source_path",
        "source_updated_at", "match_method", "confidence", "needs_review",
        "notes", "metadata", "is_active"
    ]
    recordset_cols = """
        evidence_hash text,
        run_id text,
        dev_project_id text,
        list_no integer,
        project_name_snapshot text,
        entity_type text,
        entity_id text,
        field_name text,
        field_label text,
        value_text text,
        value_numeric numeric,
        value_date date,
        value_json jsonb,
        unit text,
        source_system text,
        source_name text,
        source_priority integer,
        source_record_id text,
        source_path text,
        source_updated_at timestamptz,
        match_method text,
        confidence numeric,
        needs_review boolean,
        notes text,
        metadata jsonb,
        is_active boolean
    """
    for start in range(0, len(rows), 300):
        chunk = rows[start:start + 300]
        payload = json.dumps([{col: row.get(col) for col in cols} for row in chunk], ensure_ascii=False, default=str)
        sql = f"""
        insert into public.dev_project_field_evidence ({', '.join(cols)})
        select {', '.join(cols)}
        from jsonb_to_recordset({sql_literal(payload)}::jsonb) as x({recordset_cols})
        on conflict (evidence_hash) do update set
            run_id = excluded.run_id,
            value_text = excluded.value_text,
            value_numeric = excluded.value_numeric,
            value_date = excluded.value_date,
            value_json = excluded.value_json,
            source_updated_at = excluded.source_updated_at,
            confidence = excluded.confidence,
            needs_review = excluded.needs_review,
            notes = excluded.notes,
            metadata = excluded.metadata,
            is_active = excluded.is_active,
            updated_at = now();
        """
        admin.query(sql, read_only=False)


def write_outputs(evidence, source_profiles, run_id):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / f"dev_project_enrichment_candidates_{run_id}.json"
    csv_path = OUT_DIR / f"dev_project_enrichment_candidates_{run_id}.csv"
    profile_path = OUT_DIR / f"dev_project_source_profiles_{run_id}.json"
    json_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    profile_path.write_text(json.dumps(source_profiles, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    csv_cols = [
        "dev_project_id", "list_no", "project_name_snapshot", "field_label", "field_name",
        "value_text", "value_numeric", "value_date", "unit", "source_system", "source_name",
        "match_method", "confidence", "needs_review", "source_path", "notes"
    ]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=csv_cols)
        writer.writeheader()
        for row in evidence:
            writer.writerow({col: row.get(col) for col in csv_cols})
    return json_path, csv_path, profile_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply DDL and upsert evidence rows to Supabase.")
    parser.add_argument("--skip-local-files", action="store_true")
    args = parser.parse_args()

    env = read_key_values(ROOT / ".env")
    notion_config = json.loads((ROOT / "notion_config.json").read_text(encoding="utf-8"))
    admin = SupabaseAdmin(env)
    run_id = datetime.now().strftime("%Y%m%dT%H%M%S")

    if args.apply:
        admin.query(DDL_PATH.read_text(encoding="utf-8"), read_only=False)

    projects_sql = """
    select dpl.dev_project_id, i.*
    from public.dev_project_list dpl
    join public.dev_project_34_dashboard_info i on i.list_no = dpl.list_no
    order by i.sort_setup_date nulls last, i.list_no;
    """
    projects = admin.query(projects_sql)
    for project in projects:
        project["tokens"] = build_project_tokens(project)

    evidence = []
    source_profiles = []
    evidence.extend(add_sql_evidence(projects, admin, run_id))

    pm_filter = {
        "and": [
            {"property": "구분", "select": {"equals": "Project"}},
            {"property": "보고 시 제외(미션, 매각, 미설정, 일상업무)", "checkbox": {"equals": False}},
            {"property": "중복제외", "checkbox": {"equals": False}},
        ]
    }
    project_mission_live = query_notion_database_all(PROJECT_MISSION_DB_ID, notion_config["NOTION_API_KEY"], pm_filter)
    pm_field_map = [
        ("project_status", "진행 현황", None, None),
        ("vehicle_class", "[분류] 비히클_작업중", None, None),
        ("holding_type", "[분류] 보유형태_작업중", None, None),
        ("business_stage", "[분류] 사업단계_작업중", None, None),
        ("asset_type", "[분류] 기초자산_작업중", None, None),
        ("asset_nature", "[분류] 자산성격_작업중", None, None),
        ("address_text", "전체주소", None, None),
        ("gross_floor_area_pyeong", "연면적(평)", "pyeong", None),
        ("gross_floor_area_sqm", "연면적(평)", "sqm", transform_pyeong_to_sqm),
        ("setup_date", "설정일", None, None),
        ("maturity_date", "만기일", None, None),
        ("aum_won", "AUM(원)", "KRW", None),
        ("equity_won", "Equity 총액(원)", "KRW", None),
        ("loan_won", "Loan 총액(원)", "KRW", None),
        ("source_asset_name", "자산명", None, None),
        ("lender_text", "대주정보", None, None),
        ("beneficiary_text", "수익자정보", None, None),
        ("irms_risk_factor", "IRMS 위험관리계수", None, None),
    ]
    evidence.extend(add_notion_rows_evidence(
        projects, project_mission_live, source_system="notion_project_mission_live",
        source_name="Project & Mission", run_id=run_id,
        title_keys=["Project & Mission 이름"], field_map=pm_field_map, min_score=0.70
    ))

    new_filter = {"property": "Drop/Closing", "checkbox": {"equals": False}}
    notion_new_rows = query_notion_database_all(notion_config["NEW_PROJECT_DB_ID"], notion_config["NOTION_API_KEY"], new_filter)
    new_field_map = [
        ("project_status", "진행단계", None, None),
        ("business_stage", "사업형태", None, None),
        ("asset_type", "섹터", None, None),
        ("main_usage", "주용도", None, None),
        ("address_text", "주소", None, None),
        ("gross_floor_area_pyeong", "연면적(평)", "pyeong", None),
        ("gross_floor_area_sqm", "연면적(평)", "sqm", transform_pyeong_to_sqm),
        ("aum_won", "AUM(억원)", "KRW", transform_eok_to_won),
        ("manager_text", "담당(PM)", None, None),
    ]
    evidence.extend(add_notion_rows_evidence(
        projects, notion_new_rows, source_system="notion_new_project_live",
        source_name="신규", run_id=run_id,
        title_keys=["프로젝트 이름"], field_map=new_field_map, min_score=0.70
    ))

    snapshot_path = ROOT / "02. T5T Board" / "data" / "project_mission.json"
    if snapshot_path.exists():
        snapshot_rows = json.loads(snapshot_path.read_text(encoding="utf-8"))
        evidence.extend(add_notion_rows_evidence(
            projects, snapshot_rows, source_system="notion_project_mission_snapshot",
            source_name="02. T5T Board/data/project_mission.json", run_id=run_id,
            title_keys=["Project & Mission 이름"], field_map=pm_field_map, min_score=0.70
        ))
        source_profiles.append({"path": str(snapshot_path), "rows": len(snapshot_rows), "source": "notion_snapshot"})

    if not args.skip_local_files:
        local_evidence, local_profiles = add_local_tabular_evidence(projects, run_id)
        evidence.extend(local_evidence)
        source_profiles.extend(local_profiles)

    deduped = {}
    for row in evidence:
        deduped[row["evidence_hash"]] = row
    evidence = list(deduped.values())

    by_source = {}
    by_field = {}
    by_project = {}
    for row in evidence:
        by_source[row["source_system"]] = by_source.get(row["source_system"], 0) + 1
        by_field[row["field_name"]] = by_field.get(row["field_name"], 0) + 1
        by_project[row["project_name_snapshot"]] = by_project.get(row["project_name_snapshot"], 0) + 1

    summary = {
        "project_count": len(projects),
        "evidence_count": len(evidence),
        "source_counts": by_source,
        "field_counts": by_field,
        "top_project_counts": sorted(by_project.items(), key=lambda item: item[1], reverse=True)[:20],
        "notion_project_mission_live_rows": len(project_mission_live),
        "notion_new_project_live_rows": len(notion_new_rows),
    }
    json_path, csv_path, profile_path = write_outputs(evidence, source_profiles, run_id)

    if args.apply:
        insert_evidence(admin, run_id, evidence, sorted(by_source), summary)
        readback = admin.query(f"""
        select json_build_object(
          'run_id', {sql_literal(run_id)},
          'evidence_rows_for_run', (select count(*) from public.dev_project_field_evidence where run_id = {sql_literal(run_id)}),
          'total_evidence_rows', (select count(*) from public.dev_project_field_evidence),
          'covered_projects', (select count(distinct dev_project_id) from public.dev_project_field_evidence where run_id = {sql_literal(run_id)}),
          'covered_fields', (select count(distinct field_name) from public.dev_project_field_evidence where run_id = {sql_literal(run_id)}),
          'source_counts', (
            select json_object_agg(source_system, cnt)
            from (
              select source_system, count(*) cnt
              from public.dev_project_field_evidence
              where run_id = {sql_literal(run_id)}
              group by source_system
            ) s
          )
        ) as readback;
        """)
        summary["readback"] = readback

    print(json.dumps({
        "run_id": run_id,
        "apply": args.apply,
        "summary": summary,
        "candidates_json": str(json_path),
        "candidates_csv": str(csv_path),
        "source_profiles_json": str(profile_path),
    }, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
