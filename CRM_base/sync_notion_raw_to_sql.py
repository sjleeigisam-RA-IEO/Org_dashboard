import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from argparse import ArgumentParser
from datetime import date
from datetime import datetime

from supabase import create_client

from env_utils import get_required_supabase_config
from apply_t5t_manual_aliases import ALIAS_PATH
from apply_t5t_manual_aliases import find_best_rule
from t5t_classification import GENERAL_WORK_STATUS
from t5t_classification import GENERAL_WORK_TASK_TYPE
from t5t_classification import MISSION_STATUS
from t5t_classification import MISSION_TASK_TYPE
from t5t_classification import is_general_work


ROOT_DIR = os.path.dirname(os.path.dirname(__file__))
CONFIG_PATH = os.path.join(ROOT_DIR, "notion_config.json")

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    config = json.load(f)

for key in ["NOTION_API_KEY", "RAW_T5T_DB_ID", "NEW_PROJECT_DB_ID"]:
    if os.getenv(key):
        config[key] = os.getenv(key)

url, key = get_required_supabase_config()
supabase = create_client(url, key)

NOTION_HEADERS = {
    "Authorization": f"Bearer {config['NOTION_API_KEY']}",
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
}

EMAIL_KEYS = ["Email", "email", "E-mail", "이메일", "메일"]
DATE_KEYS = ["Date", "date", "작성일", "날짜", "Work Date"]
LINE_KEYS = ["Line", "line", "소속", "라인"]
CONTENT_LABELS = ["내용", "업무", "T5T", "content", "task"]
PROJECT_LABELS = ["관련 프로젝트", "프로젝트", "project", "mission"]
STAKEHOLDER_LABELS = ["외부 관계자", "상대방", "관계자", "stakeholder", "counterparty"]
TASK_KEYWORDS = [
    "대출", "이자", "리파이낸싱", "금리", "담보", "약정", "인출", "상환", "자금집행", "PF", "리츠", "배당",
    "설계", "시공", "인허가", "착공", "준공", "분양", "임대", "매각", "매입", "수주", "실사", "답사", "매매",
    "운용", "관리", "보고", "감사", "공시", "평가", "정산", "이관", "설정", "해지", "보험", "개선",
    "계약", "협의", "검토", "승인", "자문", "법무", "공증", "이사회", "주총", "할인",
]


def notion_api(endpoint, method="POST", data=None):
    api_url = f"https://api.notion.com/v1/{endpoint}"
    if method == "POST" and data is None:
        data = {}
    req_body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(api_url, data=req_body, headers=NOTION_HEADERS, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="replace")
        print(f"Notion API Error: {e.code} - {err_msg}")
        raise


def query_database_all(database_id, page_size=100, filter_payload=None):
    results = []
    cursor = None
    while True:
        payload = {"page_size": page_size}
        if filter_payload:
            payload["filter"] = filter_payload
        if cursor:
            payload["start_cursor"] = cursor
        response = notion_api(f"databases/{database_id}/query", data=payload)
        results.extend(response.get("results", []))
        print(f"Fetched {len(results)} rows from Notion database {database_id}", flush=True)
        if not response.get("has_more"):
            return results
        cursor = response.get("next_cursor")


def get_block_children_all(block_id, page_size=100):
    results = []
    cursor = None
    while True:
        params = {"page_size": str(page_size)}
        if cursor:
            params["start_cursor"] = cursor
        endpoint = f"blocks/{block_id}/children?{urllib.parse.urlencode(params)}"
        response = notion_api(endpoint, method="GET")
        results.extend(response.get("results", []))
        if not response.get("has_more"):
            return results
        cursor = response.get("next_cursor")


def plain_text(parts):
    return "".join(part.get("plain_text", "") for part in parts or []).strip()


def block_text(block):
    block_type = block.get("type")
    if not block_type:
        return ""
    payload = block.get(block_type, {})
    return plain_text(payload.get("rich_text", []))


def prop_text(prop):
    prop_type = prop.get("type")
    if prop_type in {"title", "rich_text"}:
        return plain_text(prop.get(prop_type, []))
    if prop_type == "select" and prop.get("select"):
        return prop["select"].get("name", "")
    if prop_type == "multi_select":
        return ", ".join(item.get("name", "") for item in prop.get("multi_select", []))
    if prop_type == "email":
        return prop.get("email") or ""
    if prop_type == "date" and prop.get("date"):
        return prop["date"].get("start") or ""
    return ""


def first_prop(props, keys, prop_type):
    for key in keys:
        value = props.get(key)
        if value and value.get("type") == prop_type:
            return value
    for value in props.values():
        if value.get("type") == prop_type:
            return value
    return None


def get_email(props):
    prop = first_prop(props, EMAIL_KEYS, "email")
    return prop.get("email") if prop else None


def get_date(props):
    prop = first_prop(props, DATE_KEYS, "date")
    if not prop or not prop.get("date"):
        return None
    return prop["date"].get("start")


def parse_date(value):
    if not value:
        return None
    return date.fromisoformat(value[:10])


def get_select_name(props, keys, default=None):
    prop = first_prop(props, keys, "select")
    if prop and prop.get("select"):
        return prop["select"].get("name")
    return default


def page_title(props):
    for prop in props.values():
        if prop.get("type") == "title":
            return prop_text(prop)
    return ""


def split_labeled_text(text):
    for delimiter in [":", "："]:
        if delimiter in text:
            label, value = text.split(delimiter, 1)
            return label.strip().lower(), value.strip()
    return "", text.strip()


def label_matches(label, candidates):
    normalized = label.lower()
    return any(candidate.lower() in normalized for candidate in candidates)


def starts_t5t_item(text):
    return bool(re.search(r"(^|\[|\s)T\s*-?\s*[1-5](\]|\.|\s|$)", text, re.IGNORECASE))


def is_t5t_header_text(text):
    normalized = re.sub(r"\s+", " ", (text or "").strip())
    return bool(
        re.match(
            r"^T5T Contents .+?(?:Director|Sr\. Director|Senior Director)\s+\d{4}\.\d{2}\.\d{2}$",
            normalized,
            re.IGNORECASE,
        )
    )


def parse_t5t_blocks(blocks):
    items = []
    current_item = None

    for block in blocks:
        text = block_text(block)
        if not text:
            continue
        if is_t5t_header_text(text):
            continue

        if starts_t5t_item(text):
            if current_item and current_item.get("text"):
                items.append(current_item)
            current_item = {"no": len(items) + 1, "text": "", "project": "", "stakeholder": ""}
            label, value = split_labeled_text(text)
            if value and not label_matches(label, CONTENT_LABELS + PROJECT_LABELS + STAKEHOLDER_LABELS):
                current_item["text"] = value
            continue

        if current_item is None:
            current_item = {"no": len(items) + 1, "text": "", "project": "", "stakeholder": ""}

        label, value = split_labeled_text(text)
        if label_matches(label, CONTENT_LABELS):
            current_item["text"] = value
        elif label_matches(label, PROJECT_LABELS):
            current_item["project"] = value
        elif label_matches(label, STAKEHOLDER_LABELS):
            current_item["stakeholder"] = value
        else:
            current_item["text"] = f"{current_item['text']} {text}".strip()

    if current_item and current_item.get("text"):
        items.append(current_item)
    return items


def parse_t5t_properties(props):
    items = []
    for no in range(1, 6):
        text = ""
        project = ""
        stakeholder = ""
        for key, prop in props.items():
            normalized = key.replace(" ", "").lower()
            value = prop_text(prop)
            if not value:
                continue
            if f"t5t-{no}" in normalized or f"t5t{no}" in normalized:
                text = value
            elif str(no) in normalized and label_matches(key, PROJECT_LABELS):
                project = value
            elif str(no) in normalized and label_matches(key, STAKEHOLDER_LABELS):
                stakeholder = value
        if text:
            items.append({"no": no, "text": text, "project": project, "stakeholder": stakeholder})
    return items


def is_precise_match(pattern, target):
    if not pattern or not target:
        return False
    if pattern not in target:
        return False

    pattern_nums = re.findall(r"(\d+)", pattern)
    target_nums = re.findall(r"(\d+)", target)
    if pattern_nums:
        return any(num in target_nums for num in pattern_nums)
    return True


def in_date_window(value, date_from=None, date_to=None):
    parsed = parse_date(value)
    if parsed is None:
        return date_from is None and date_to is None
    if date_from and parsed < date_from:
        return False
    if date_to and parsed > date_to:
        return False
    return True


def build_date_filter(date_from=None, date_to=None):
    if not date_from and not date_to:
        return None
    date_filter = {"property": "Date", "date": {}}
    if date_from:
        date_filter["date"]["on_or_after"] = date_from.isoformat()
    if date_to:
        date_filter["date"]["on_or_before"] = date_to.isoformat()
    return date_filter


def run_sync(date_from=None, date_to=None):
    print("--- Fetching Master Data ---")
    proj_res = supabase.table("projects").select("project_id, project_name").execute()
    fund_res = supabase.table("funds").select("fund_id, fund_name, short_name, asset_name").execute()
    cp_res = supabase.table("counterparties").select("counterparty_id, name").execute()
    staff_res = supabase.table("staff").select("staff_id, name, email").execute()
    alias_rules = json.loads(ALIAS_PATH.read_text(encoding="utf-8")) if ALIAS_PATH.exists() else []

    new_proj_list = []
    for page in query_database_all(config["NEW_PROJECT_DB_ID"]):
        title = page_title(page.get("properties", {}))
        if title:
            new_proj_list.append(title)

    masters = {
        "projects": proj_res.data or [],
        "funds": fund_res.data or [],
        "new_projects": new_proj_list,
        "counterparties": sorted(cp_res.data or [], key=lambda x: len(x.get("name") or ""), reverse=True),
        "staff_map": {
            s["email"].lower(): s["staff_id"]
            for s in (staff_res.data or [])
            if s.get("email") and s.get("staff_id")
        },
    }

    print(f"--- Fetching Raw Submissions ({config['RAW_T5T_DB_ID']}) ---")
    raw_pages = query_database_all(config["RAW_T5T_DB_ID"], filter_payload=build_date_filter(date_from, date_to))

    for page in raw_pages:
        page_id = page["id"]
        props = page.get("properties", {})
        email = get_email(props)
        date_val = get_date(props)
        if not in_date_window(date_val, date_from, date_to):
            continue
        staff_id = masters["staff_map"].get(email.lower()) if email else None
        line = get_select_name(props, LINE_KEYS, "N/A")

        sub_data = {
            "submission_id": page_id,
            "writer_staff_id": staff_id,
            "submitted_at": f"{date_val}T09:00:00Z" if date_val else datetime.now().isoformat(),
            "work_date": date_val,
            "writer_name": email.split("@")[0] if email else page_title(props) or "Unknown",
            "writer_email": email,
            "line": line,
            "source_file": "Notion-Raw-T5T",
            "metadata": {"notion_page_id": page_id, "source_url": page.get("url")},
        }
        supabase.table("t5t_form_submissions").upsert(sub_data, on_conflict="submission_id").execute()

        print(f"Processing: {email or 'Unknown'} / {date_val or 'No date'}")
        parsed_items = parse_t5t_blocks(get_block_children_all(page_id))
        if not parsed_items:
            parsed_items = parse_t5t_properties(props)

        for item in parsed_items:
            raw_text = " ".join(part for part in [item["text"], item["project"], item["stakeholder"]] if part)
            if is_t5t_header_text(raw_text):
                continue
            matched_project_id = None
            matched_fund_id = None
            match_source = "none"
            alias_task_type = None
            metadata = {"match_source": match_source, "notion_page_id": page_id, "source_url": page.get("url")}

            alias_row = {
                "project_text": item["project"],
                "raw_text": raw_text,
                "classification_summary": None,
                "metadata": metadata,
            }
            alias_rule, matched_alias = find_best_rule(alias_row, alias_rules)
            if alias_rule:
                target_type = alias_rule["target_type"]
                match_source = f"manual_alias_{target_type}"
                alias_task_type = alias_rule.get("target_name")
                metadata["manual_alias_match"] = {
                    "source": "t5t_manual_aliases",
                    "target_type": target_type,
                    "target_id": alias_rule.get("target_id"),
                    "target_name": alias_rule.get("target_name"),
                    "matched_alias": matched_alias,
                }
                if target_type == "project":
                    matched_project_id = alias_rule["target_id"]
                elif target_type == "fund":
                    matched_fund_id = alias_rule["target_id"]
                elif target_type in {"general_work", "mission"}:
                    match_source = GENERAL_WORK_STATUS if target_type == "general_work" else MISSION_STATUS

            if not matched_project_id and not matched_fund_id and match_source == "none":
                for project in masters["projects"]:
                    project_name = project.get("project_name")
                    if not project_name:
                        continue
                    if (item["project"] and project_name in item["project"]) or project_name in item["text"]:
                        matched_project_id = project["project_id"]
                        match_source = "sql_project"
                        break

            if not matched_project_id and not matched_fund_id and match_source == "none":
                for fund in masters["funds"]:
                    for key in ["fund_name", "short_name", "asset_name"]:
                        value = fund.get(key)
                        if not value:
                            continue
                        if len(value.strip()) <= 3 and value.strip().endswith("호"):
                            continue
                        if is_precise_match(value, item["project"]) or is_precise_match(value, item["text"]):
                            matched_fund_id = fund["fund_id"]
                            match_source = "sql_fund"
                            break
                    if matched_fund_id:
                        break

            if not matched_project_id and not matched_fund_id and match_source == "none":
                for project_name in masters["new_projects"]:
                    if (item["project"] and project_name in item["project"]) or project_name in item["text"]:
                        match_source = "notion_new"
                        break

            if (
                match_source == "none"
                and is_general_work(item["project"], item["text"], None, "raw_unmatched")
            ):
                match_source = GENERAL_WORK_STATUS

            metadata["match_source"] = match_source

            matched_cps = [
                cp for cp in masters["counterparties"]
                if cp.get("name") and len(cp["name"]) > 1 and cp["name"] in raw_text
            ]
            tokens = [keyword for keyword in TASK_KEYWORDS if keyword in raw_text]
            cp_names = ", ".join(cp["name"] for cp in matched_cps)
            token_text = ", ".join(tokens)
            if cp_names and token_text:
                summary = f"[{cp_names}] {token_text} 관련"
            elif cp_names:
                summary = f"[{cp_names}] 관련 업무"
            elif token_text:
                summary = f"{token_text} 관련 업무"
            else:
                summary = raw_text[:80]

            if match_source == GENERAL_WORK_STATUS:
                task_type = alias_task_type or GENERAL_WORK_TASK_TYPE
                match_status = GENERAL_WORK_STATUS
            elif match_source == MISSION_STATUS:
                task_type = MISSION_TASK_TYPE
                match_status = MISSION_STATUS
            elif match_source != "none":
                task_type = "Project"
                match_status = "matched"
            else:
                task_type = "General"
                match_status = "raw_unmatched"

            item_data = {
                "form_item_id": f"notion-{page_id}-{item['no']}",
                "submission_id": page_id,
                "item_no": item["no"],
                "writer_staff_id": staff_id,
                "work_date": date_val,
                "line": line,
                "raw_text": raw_text,
                "project_text": item["project"] or None,
                "stakeholder_text": item["stakeholder"] or None,
                "matched_project_id": matched_project_id,
                "matched_fund_id": matched_fund_id,
                "classification_summary": summary,
                "classification_tokens": tokens,
                "stakeholder_ids": [cp["counterparty_id"] for cp in matched_cps if cp.get("counterparty_id")],
                "task_type": task_type,
                "match_status": match_status,
                "metadata": metadata,
            }
            supabase.table("t5t_form_items").upsert(item_data, on_conflict="form_item_id").execute()

    print("Sync Complete!")


def main():
    parser = ArgumentParser(description="Sync raw T5T Notion pages to Supabase staging tables.")
    parser.add_argument("--date-from", help="Inclusive work_date lower bound, YYYY-MM-DD.")
    parser.add_argument("--date-to", help="Inclusive work_date upper bound, YYYY-MM-DD.")
    args = parser.parse_args()
    run_sync(parse_date(args.date_from), parse_date(args.date_to))


if __name__ == "__main__":
    main()
