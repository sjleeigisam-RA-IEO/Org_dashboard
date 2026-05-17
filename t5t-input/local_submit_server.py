import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from supabase import create_client


ROOT_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT_DIR / "notion_config.json"
ENV_PATH = ROOT_DIR / ".env"
NOTION_VERSION = "2022-06-28"


def read_env_file(path):
    values = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"').strip("'")
    return values


def load_config():
    env = read_env_file(ENV_PATH)
    if CONFIG_PATH.exists():
        env.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    env.update({k: v for k, v in os.environ.items() if k.startswith(("SUPABASE_", "NOTION_", "RAW_T5T"))})
    return env


CFG = load_config()
SUPABASE_URL = CFG.get("SUPABASE_URL")
SUPABASE_KEY = CFG.get("SUPABASE_SERVICE_ROLE_KEY") or CFG.get("SUPABASE_KEY")
NOTION_API_KEY = CFG.get("NOTION_API_KEY")
RAW_T5T_DB_ID = CFG.get("RAW_T5T_DB_ID")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be configured.")
if not NOTION_API_KEY or not RAW_T5T_DB_ID:
    raise RuntimeError("NOTION_API_KEY and RAW_T5T_DB_ID must be configured.")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def cors_headers(handler):
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")


def notion_request(endpoint, method="POST", data=None):
    body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else None
    request = urllib.request.Request(
        f"https://api.notion.com/v1/{endpoint}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {NOTION_API_KEY}",
            "Content-Type": "application/json",
            "Notion-Version": NOTION_VERSION,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Notion API error {error.code}: {detail}") from error


def text_block(text, block_type="paragraph", bold=False):
    return {
        "object": "block",
        "type": block_type,
        block_type: {
            "rich_text": [
                {
                    "type": "text",
                    "text": {"content": str(text or "")[:2000]},
                    "annotations": {"bold": bold},
                }
            ]
        },
    }


def validate_payload(payload):
    if not payload.get("writer_name"):
        raise ValueError("작성자 이름이 확인되지 않았습니다.")
    if not payload.get("writer_email"):
        raise ValueError("작성자 이메일이 필요합니다.")
    if not payload.get("work_date"):
        raise ValueError("작성일이 필요합니다.")
    items = payload.get("items") or []
    if not items:
        raise ValueError("업무 항목이 1개 이상 필요합니다.")
    for index, item in enumerate(items, start=1):
        if not (item.get("raw_text") or "").strip():
            raise ValueError(f"{index}번 업무 내용이 비어 있습니다.")
        if not item.get("relation_labels") and not item.get("relation_texts") and not item.get("task_type"):
            raise ValueError(f"{index}번 업무의 프로젝트/펀드/자산 또는 분류가 필요합니다.")


def relation_label(item):
    labels = item.get("relation_labels") or []
    if labels:
        return " / ".join(labels)
    parts = []
    for key, label in [
        ("project_ids", "프로젝트"),
        ("review_project_ids", "검토프로젝트"),
        ("fund_ids", "펀드"),
        ("asset_ids", "자산"),
    ]:
        values = item.get(key) or []
        if values:
            parts.append(f"{label}: {', '.join(values)}")
    if item.get("relation_texts"):
        parts.append(f"직접입력: {', '.join(item['relation_texts'])}")
    return " / ".join(parts)


def counterparty_label(item):
    labels = item.get("counterparty_labels") or []
    if labels:
        return " / ".join(labels)
    parts = []
    if item.get("counterparty_ids"):
        parts.append(f"DB: {', '.join(item['counterparty_ids'])}")
    if item.get("counterparty_candidates"):
        parts.append(f"직접입력: {', '.join(item['counterparty_candidates'])}")
    return " / ".join(parts)


def notion_children(payload):
    children = []
    for item in payload.get("items", []):
        no = item.get("item_no")
        children.append(text_block(f"T5T - {no}", "heading_3"))
        children.append(text_block(f"업무: {item.get('raw_text', '')}"))
        relation = relation_label(item)
        if relation:
            children.append(text_block(f"프로젝트: {relation}"))
        counterparty = counterparty_label(item)
        if counterparty:
            children.append(text_block(f"관계자: {counterparty}"))
        if item.get("task_type"):
            children.append(text_block(f"분류: {item['task_type']}"))
    return children


def create_notion_page(payload):
    validate_payload(payload)
    properties = {
        "작성자": {
            "title": [{"type": "text", "text": {"content": payload.get("writer_name") or "Unknown"}}]
        },
        "이메일": {"email": payload.get("writer_email")},
        "Date": {"date": {"start": payload.get("work_date")}},
    }
    return notion_request(
        "pages",
        data={
            "parent": {"database_id": RAW_T5T_DB_ID},
            "properties": properties,
            "children": notion_children(payload),
        },
    )


def save_to_notion_only(payload):
    notion_page = create_notion_page(payload)
    return {
        "notion_page_id": notion_page.get("id"),
        "notion_url": notion_page.get("url"),
    }


def submission_id(payload):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    writer = payload.get("writer_staff_id") or (payload.get("writer_email") or "unknown").split("@")[0]
    return f"t5t-input-{writer}-{payload.get('work_date')}-{stamp}"


def save_to_supabase(payload, notion_page):
    sid = submission_id(payload)
    now_iso = datetime.now(timezone.utc).isoformat()
    source_url = notion_page.get("url")
    notion_page_id = notion_page.get("id")

    supabase.table("t5t_form_submissions").upsert(
        {
            "submission_id": sid,
            "submitted_at": now_iso,
            "writer_staff_id": payload.get("writer_staff_id"),
            "writer_name": payload.get("writer_name"),
            "writer_email": payload.get("writer_email"),
            "work_date": payload.get("work_date"),
            "line": payload.get("line"),
            "source_file": "T5T-input-local",
            "metadata": {
                "source_system": payload.get("source_system"),
                "notion_page_id": notion_page_id,
                "source_url": source_url,
                "week_key": payload.get("week_key"),
                "week_label": payload.get("week_label"),
                "org_id": payload.get("org_id"),
                "org_name": payload.get("org_name"),
            },
        },
        on_conflict="submission_id",
    ).execute()

    for item in payload.get("items", []):
        item_no = item.get("item_no")
        relation_text = ", ".join(item.get("relation_labels") or item.get("relation_texts") or [])
        stakeholder_text = ", ".join(item.get("counterparty_labels") or item.get("counterparty_candidates") or [])
        form_item_id = f"{sid}-{item_no}"
        project_ids = item.get("project_ids") or []
        review_project_ids = item.get("review_project_ids") or []
        fund_ids = item.get("fund_ids") or []
        asset_ids = item.get("asset_ids") or []
        counterparty_ids = item.get("counterparty_ids") or []
        match_status = item.get("task_type") or "input_linked"
        supabase.table("t5t_form_items").upsert(
            {
                "form_item_id": form_item_id,
                "submission_id": sid,
                "item_no": item_no,
                "writer_staff_id": payload.get("writer_staff_id"),
                "work_date": payload.get("work_date"),
                "line": payload.get("line"),
                "raw_text": item.get("raw_text") or "",
                "project_text": relation_text,
                "stakeholder_text": stakeholder_text,
                "matched_project_id": project_ids[0] if project_ids else None,
                "matched_review_project_id": review_project_ids[0] if review_project_ids else None,
                "matched_fund_id": fund_ids[0] if fund_ids else None,
                "stakeholder_ids": counterparty_ids,
                "task_type": item.get("task_type"),
                "match_status": match_status,
                "classification_summary": item.get("summary"),
                "metadata": {
                    "notion_page_id": notion_page_id,
                    "source_url": source_url,
                    "review_project_ids": review_project_ids,
                    "fund_ids": fund_ids,
                    "asset_ids": asset_ids,
                    "relation_texts": item.get("relation_texts") or [],
                    "relation_labels": item.get("relation_labels") or [],
                    "counterparty_candidates": item.get("counterparty_candidates") or [],
                    "counterparty_labels": item.get("counterparty_labels") or [],
                    "submitted_from": "t5t-input",
                },
            },
            on_conflict="form_item_id",
        ).execute()

    return sid


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        cors_headers(self)
        self.end_headers()

    def do_POST(self):
        if self.path not in {"/submit_t5t", "/submit_notion"}:
            self.send_json({"ok": False, "error": "Not found"}, status=404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            validate_payload(payload)
            if self.path == "/submit_notion":
                notion_result = save_to_notion_only(payload)
                self.send_json({"ok": True, **notion_result})
                return
            notion_page = create_notion_page(payload)
            sid = save_to_supabase(payload, notion_page)
            self.send_json(
                {
                    "ok": True,
                    "submission_id": sid,
                    "notion_page_id": notion_page.get("id"),
                    "notion_url": notion_page.get("url"),
                }
            )
        except ValueError as error:
            self.send_json({"ok": False, "error": str(error)}, status=400)
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, status=500)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        cors_headers(self)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {fmt % args}")


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 8787), Handler)
    print("T5T local submit server running at http://127.0.0.1:8787/submit_t5t")
    server.serve_forever()


if __name__ == "__main__":
    main()
