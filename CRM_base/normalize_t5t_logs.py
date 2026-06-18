import json
import re
from argparse import ArgumentParser
from collections import defaultdict
from datetime import date, datetime, timedelta

from supabase import create_client

from env_utils import get_required_supabase_config
from t5t_classification import GENERAL_WORK_STATUS
from t5t_classification import MISSION_STATUS
from t5t_classification import effective_match_status
from t5t_classification import effective_task_type


IOTA_TARGET_STAFF_IDS = {
    "staff_10268",
    "staff_ext_000007",
    "staff_ext_000111",
    "staff_ext_000037",
    "staff_ext_000027",
}
IOTA_TARGET_EMAILS = {
    "sykang@igisam.com",
    "ksoonil@igisam.com",
    "jghong@igisam.com",
    "junhopark@igisam.com",
    "hyunsoo.kim@igisam.com",
}
IOTA_TARGET_NAMES = {
    "\uac15\uc21c\uc6a9",
    "\uad8c\uc21c\uc77c",
    "\ud64d\uc7a5\uad70",
    "\ubc15\uc900\ud638",
    "\uae40\ud604\uc218",
}


def parse_date(value):
    if not value:
        return None
    return date.fromisoformat(str(value)[:10])


def week_key(value):
    parsed = parse_date(value)
    if not parsed:
        return None, None
    # T5T reporting weeks run Tuesday through Monday, ending on the meeting Monday.
    week_end = parsed + timedelta(days=(7 - parsed.weekday()) % 7)
    iso = week_end.isocalendar()
    return f"{iso.year}-W{iso.week:02d}", week_end.isoformat()


def chunked(rows, size):
    for idx in range(0, len(rows), size):
        yield rows[idx:idx + size]


def dedupe_by_key(rows, key):
    deduped = {}
    for row in rows:
        value = row.get(key)
        if value:
            deduped[value] = row
    return list(deduped.values())


def is_missing_iota_table_error(error):
    message = str(error).lower()
    return "iota_t5t_logs" in message and (
        "does not exist" in message
        or "could not find the table" in message
        or "pgrst205" in message
    )


def upsert_iota_logs(client, iota_logs, chunk_size):
    if not iota_logs:
        return
    try:
        for batch in chunked(iota_logs, chunk_size):
            client.table("iota_t5t_logs").upsert(batch, on_conflict="iota_log_id").execute()
    except Exception as error:
        if is_missing_iota_table_error(error):
            print("WARNING: iota_t5t_logs table is not available yet; skipped IOTA copy.")
            return
        raise


def fetch_all(client, table, select, order=None, date_from=None, date_to=None):
    rows = []
    start = 0
    while True:
        end = start + 999
        query = client.table(table).select(select)
        if order:
            query = query.order(order)
        if date_from:
            query = query.gte("work_date", date_from.isoformat())
        if date_to:
            query = query.lte("work_date", date_to.isoformat())
        result = query.range(start, end).execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def make_summary(item):
    return item.get("classification_summary") or (item.get("raw_text") or "")[:120]


def make_task_type(item):
    return effective_task_type(item)


def build_counterparty_lookup(counterparties):
    by_id = {}
    for row in counterparties:
        cid = row.get("counterparty_id")
        if cid:
            by_id[cid] = row
    return by_id


def build_asset_lookup(fund_assets):
    by_fund = defaultdict(list)
    for row in fund_assets:
        fund_id = row.get("fund_id")
        if fund_id:
            by_fund[fund_id].append(row)
    return by_fund


def build_staff_lookup(staff_rows):
    by_id = {}
    for row in staff_rows:
        staff_id = row.get("staff_id")
        if staff_id:
            by_id[staff_id] = row
    return by_id


def normalize_email(value):
    return str(value or "").strip().lower()


def is_iota_target_writer(staff_id, staff_lookup):
    staff = staff_lookup.get(staff_id) or {}
    name = str(staff.get("name") or "")
    email = normalize_email(staff.get("email"))
    return (
        staff_id in IOTA_TARGET_STAFF_IDS
        or email in IOTA_TARGET_EMAILS
        or any(target_name in name for target_name in IOTA_TARGET_NAMES)
    )


def iota_body_text(item, log):
    # Match only semantic body fields. Do not include metadata to avoid UUID/ID false positives.
    parts = [
        item.get("raw_text"),
        item.get("project_text"),
        item.get("stakeholder_text"),
        item.get("classification_summary"),
        log.get("log_title"),
        log.get("summary"),
    ]
    return " ".join(str(part) for part in parts if part)


def find_iota_match_terms(text):
    text = text or ""
    terms = []
    if (
        re.search(r"(^|[^A-Za-z])I\s*O\s*T\s*A([^A-Za-z]|$)", text, re.IGNORECASE)
        or "\uc774\uc624\ud0c0" in text
        or "\uc544\uc774\uc624\ud0c0" in text
    ):
        terms.append("IOTA Seoul")
    if re.search(r"(^|[^0-9])427\s*(호)?([^0-9]|$)", text):
        terms.append("427")
    if re.search(r"(^|[^0-9])816\s*(호)?([^0-9]|$)", text):
        terms.append("816")
    if re.search(r"(^|[^0-9])421\s*(호)?([^0-9]|$)", text):
        terms.append("421")
    return terms


def normalize(date_from=None, date_to=None, chunk_size=500):
    url, key = get_required_supabase_config()
    client = create_client(url, key)

    items = fetch_all(
        client,
        "t5t_form_items",
        "form_item_id,submission_id,item_no,writer_staff_id,work_date,line,raw_text,project_text,stakeholder_text,matched_project_id,matched_fund_id,classification_summary,classification_tokens,stakeholder_ids,task_type,match_status,metadata",
        order="work_date",
        date_from=date_from,
        date_to=date_to,
    )
    counterparties = fetch_all(client, "counterparties", "counterparty_id,name,category,metadata")
    fund_assets = fetch_all(client, "fund_assets", "id,fund_id,asset_name,asset_id,metadata")
    staff_rows = fetch_all(client, "staff", "staff_id,name,email,status,metadata")
    counterparties_by_id = build_counterparty_lookup(counterparties)
    assets_by_fund = build_asset_lookup(fund_assets)
    staff_by_id = build_staff_lookup(staff_rows)

    logs = []
    iota_logs = []
    project_links = []
    stakeholders = []

    for item in items:
        log_id = f"form_item_{item['form_item_id']}"
        wk, week_end = week_key(item.get("work_date"))
        tokens = item.get("classification_tokens") or []
        if isinstance(tokens, str):
            try:
                tokens = json.loads(tokens)
            except json.JSONDecodeError:
                tokens = [tokens]

        fund_assets_for_item = assets_by_fund.get(item.get("matched_fund_id"), [])
        metadata = item.get("metadata") or {}
        metadata.update({
            "source_form_item_id": item.get("form_item_id"),
            "source_submission_id": item.get("submission_id"),
            "item_no": item.get("item_no"),
            "project_text": item.get("project_text"),
            "stakeholder_text": item.get("stakeholder_text"),
            "matched_fund_id": item.get("matched_fund_id"),
            "matched_asset_ids": [row.get("asset_id") for row in fund_assets_for_item if row.get("asset_id")],
            "matched_asset_names": [row.get("asset_name") for row in fund_assets_for_item if row.get("asset_name")],
        })

        match_status = effective_match_status(item)
        matching_basis = (
            "project" if item.get("matched_project_id")
            else "fund" if item.get("matched_fund_id")
            else GENERAL_WORK_STATUS if match_status == GENERAL_WORK_STATUS
            else MISSION_STATUS if match_status == MISSION_STATUS
            else None
        )
        log = {
            "t5t_log_id": log_id,
            "notion_id": None,
            "writer_staff_id": item.get("writer_staff_id"),
            "writer_name": None,
            "line": item.get("line"),
            "work_date": item.get("work_date"),
            "week_key": wk,
            "week_end_date": week_end,
            "task_type": make_task_type(item),
            "log_title": item.get("project_text") or item.get("classification_summary") or f"T5T {item.get('item_no')}",
            "summary": make_summary(item),
            "raw_text": item.get("raw_text"),
            "source_url": metadata.get("source_url"),
            "matching_status": match_status,
            "matching_basis": matching_basis,
            "needs_manual_review": match_status not in {"matched", GENERAL_WORK_STATUS, MISSION_STATUS},
            "classification_summary": item.get("classification_summary"),
            "classification_tokens": tokens,
            "input_status": "synced",
            "source_system": "t5t_form_items",
            "metadata": metadata,
            "updated_at": datetime.utcnow().isoformat(),
        }
        logs.append(log)

        writer = staff_by_id.get(item.get("writer_staff_id"), {})
        body_text = iota_body_text(item, log)
        iota_match_terms = find_iota_match_terms(body_text)
        if is_iota_target_writer(item.get("writer_staff_id"), staff_by_id) and iota_match_terms:
            iota_logs.append({
                "iota_log_id": log_id,
                "source_t5t_log_id": log_id,
                "source_form_item_id": item.get("form_item_id"),
                "source_submission_id": item.get("submission_id"),
                "writer_staff_id": item.get("writer_staff_id"),
                "writer_name": writer.get("name"),
                "writer_email": normalize_email(writer.get("email")),
                "line": log.get("line"),
                "work_date": item.get("work_date"),
                "week_key": wk,
                "week_end_date": week_end,
                "task_type": log.get("task_type"),
                "log_title": log["log_title"],
                "summary": log["summary"],
                "raw_text": item.get("raw_text"),
                "body_text": body_text,
                "source_url": metadata.get("source_url"),
                "matching_status": log.get("matching_status"),
                "matching_basis": log.get("matching_basis"),
                "needs_manual_review": log.get("needs_manual_review"),
                "classification_summary": log.get("classification_summary"),
                "classification_tokens": log.get("classification_tokens") or [],
                "match_terms": iota_match_terms,
                "source_system": "t5t_logs_iota_copy",
                "metadata": {
                    "copy_source": "normalize_t5t_logs",
                    "copied_from": "t5t_logs",
                    "source_metadata": metadata,
                },
                "updated_at": log["updated_at"],
            })

        if item.get("matched_project_id"):
            project_links.append({
                "link_id": f"{log_id}_project_{item['matched_project_id']}",
                "t5t_log_id": log_id,
                "project_id": item.get("matched_project_id"),
                "notion_project_id": None,
                "relation_type": "mentioned",
                "match_status": item.get("match_status"),
                "metadata": {"source": "matched_project_id"},
                "updated_at": datetime.utcnow().isoformat(),
            })

        for counterparty_id in item.get("stakeholder_ids") or []:
            counterparty = counterparties_by_id.get(counterparty_id, {})
            name = counterparty.get("name") or counterparty_id
            stakeholders.append({
                "stakeholder_id": f"{log_id}_cp_{counterparty_id}",
                "t5t_log_id": log_id,
                "stakeholder_name": name,
                "company_name": name,
                "role_category": counterparty.get("category"),
                "counterparty_id": counterparty_id,
                "metadata": {"counterparty_id": counterparty_id, "source": "stakeholder_ids"},
            })

    for batch in chunked(logs, chunk_size):
        client.table("t5t_logs").upsert(batch, on_conflict="t5t_log_id").execute()
    upsert_iota_logs(client, iota_logs, chunk_size)
    project_links = dedupe_by_key(project_links, "link_id")
    stakeholders = dedupe_by_key(stakeholders, "stakeholder_id")

    for batch in chunked(project_links, chunk_size):
        client.table("t5t_log_project_links").upsert(batch, on_conflict="link_id").execute()
    for batch in chunked(stakeholders, chunk_size):
        client.table("t5t_log_stakeholders").upsert(batch, on_conflict="stakeholder_id").execute()

    summary = {
        "source_items": len(items),
        "t5t_logs": len(logs),
        "iota_t5t_logs": len(iota_logs),
        "t5t_log_project_links": len(project_links),
        "t5t_log_stakeholders": len(stakeholders),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


def main():
    parser = ArgumentParser(description="Normalize T5T raw form items into analytics tables.")
    parser.add_argument("--date-from", help="Inclusive work_date lower bound, YYYY-MM-DD.")
    parser.add_argument("--date-to", help="Inclusive work_date upper bound, YYYY-MM-DD.")
    parser.add_argument("--chunk-size", type=int, default=500)
    args = parser.parse_args()
    normalize(parse_date(args.date_from), parse_date(args.date_to), args.chunk_size)


if __name__ == "__main__":
    main()
