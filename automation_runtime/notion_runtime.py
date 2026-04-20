import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


NOTION_VERSION = "2022-06-28"


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@dataclass
class NotionConfig:
    api_key: str
    workspace_root: Path
    source_db_id: str
    summary_db_id: str
    activity_log_db_id: str
    project_mission_db_id: str
    project_master_db_id: str
    new_project_db_id: str

    @classmethod
    def load(cls, workspace_root: Path) -> "NotionConfig":
        config = load_json(workspace_root / "notion_config.json")
        return cls(
            api_key=config["NOTION_API_KEY"],
            workspace_root=workspace_root,
            source_db_id="2568ced4-3c47-8064-8424-f8e76efcb0a0",
            summary_db_id="2158ced4-3c47-8334-badc-812339f5b19e",
            activity_log_db_id="60881ecb-1653-4bb3-b18d-479cb2603a4d",
            project_mission_db_id="3258ced4-3c47-8147-b514-f1430fee1f9a",
            project_master_db_id="ef920219-3626-4e7b-ac48-12b9c14081a7",
            new_project_db_id="3148ced4-3c47-806b-adb5-d390452a6a8e",
        )


class NotionClient:
    def __init__(self, config: NotionConfig) -> None:
        self.config = config

    def _request(
        self,
        endpoint: str,
        method: str = "GET",
        data: Optional[Dict[str, Any]] = None,
        retries: int = 3,
    ) -> Dict[str, Any]:
        url = f"https://api.notion.com/v1/{endpoint}"
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
            "Notion-Version": NOTION_VERSION,
        }
        payload = json.dumps(data).encode("utf-8") if data is not None else None
        request = urllib.request.Request(url, data=payload, headers=headers, method=method)

        last_error: Optional[Exception] = None
        for attempt in range(retries):
            try:
                with urllib.request.urlopen(request) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                if exc.code == 429 and attempt < retries - 1:
                    retry_after = exc.headers.get("Retry-After")
                    time.sleep(float(retry_after or 1))
                    continue
                raise RuntimeError(f"Notion API error {exc.code}: {body}") from exc
            except Exception as exc:  # pragma: no cover - defensive
                last_error = exc
                if attempt < retries - 1:
                    time.sleep(1)
                    continue
                raise RuntimeError(f"Notion request failed for {endpoint}: {exc}") from exc
        raise RuntimeError(f"Notion request failed for {endpoint}: {last_error}")

    def query_database(
        self,
        database_id: str,
        filter_payload: Optional[Dict[str, Any]] = None,
        sorts: Optional[List[Dict[str, Any]]] = None,
        page_size: int = 100,
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        start_cursor: Optional[str] = None

        while True:
            payload: Dict[str, Any] = {"page_size": page_size}
            if filter_payload:
                payload["filter"] = filter_payload
            if sorts:
                payload["sorts"] = sorts
            if start_cursor:
                payload["start_cursor"] = start_cursor

            response = self._request(f"databases/{database_id}/query", "POST", payload)
            results.extend(response.get("results", []))
            if not response.get("has_more"):
                break
            start_cursor = response.get("next_cursor")

        return results

    def search(self, query: str, object_type: Optional[str] = None) -> List[Dict[str, Any]]:
        payload: Dict[str, Any] = {"query": query}
        if object_type:
            payload["filter"] = {"value": object_type, "property": "object"}
        response = self._request("search", "POST", payload)
        return response.get("results", [])

    def retrieve_block_children(self, block_id: str) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        start_cursor: Optional[str] = None
        while True:
            query = {"page_size": 100}
            if start_cursor:
                query["start_cursor"] = start_cursor
            qs = urllib.parse.urlencode(query)
            response = self._request(f"blocks/{block_id}/children?{qs}", "GET")
            results.extend(response.get("results", []))
            if not response.get("has_more"):
                break
            start_cursor = response.get("next_cursor")
        return results

    def append_block_children(self, block_id: str, children: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self._request(f"blocks/{block_id}/children", "PATCH", {"children": children})

    def archive_block(self, block_id: str) -> Dict[str, Any]:
        return self._request(f"blocks/{block_id}", "PATCH", {"archived": True})

    def create_page(
        self,
        database_id: str,
        properties: Dict[str, Any],
        children: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        initial_children = children[:100] if children else None
        payload: Dict[str, Any] = {
            "parent": {"database_id": database_id},
            "properties": properties,
        }
        if initial_children:
            payload["children"] = initial_children
        page = self._request("pages", "POST", payload)
        if children and len(children) > 100:
            self._append_children_in_chunks(page["id"], children[100:])
        return page

    def update_page_properties(self, page_id: str, properties: Dict[str, Any]) -> Dict[str, Any]:
        return self._request(f"pages/{page_id}", "PATCH", {"properties": properties})

    def archive_page(self, page_id: str) -> Dict[str, Any]:
        return self._request(f"pages/{page_id}", "PATCH", {"archived": True})

    def replace_page_children(self, page_id: str, children: List[Dict[str, Any]]) -> None:
        for block in self.retrieve_block_children(page_id):
            self.archive_block(block["id"])

        self._append_children_in_chunks(page_id, children)

    def _append_children_in_chunks(self, page_id: str, children: List[Dict[str, Any]]) -> None:
        chunk_size = 100
        for index in range(0, len(children), chunk_size):
            self.append_block_children(page_id, children[index : index + chunk_size])


def plain_text_from_rich_text(items: Iterable[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for item in items:
        item_type = item.get("type")
        if item_type == "text":
            parts.append(item.get("text", {}).get("content", ""))
        elif item_type == "mention":
            mention = item.get("mention", {})
            mention_type = mention.get("type")
            if mention_type == "page":
                parts.append(mention.get("page", {}).get("id", ""))
            else:
                parts.append(item.get("plain_text", ""))
        else:
            parts.append(item.get("plain_text", ""))
    return "".join(parts).strip()


def extract_property_value(prop: Dict[str, Any]) -> Any:
    ptype = prop.get("type")
    if ptype == "title":
        return plain_text_from_rich_text(prop.get("title", []))
    if ptype == "rich_text":
        return plain_text_from_rich_text(prop.get("rich_text", []))
    if ptype == "select":
        select = prop.get("select")
        return select.get("name") if select else None
    if ptype == "multi_select":
        return [item.get("name") for item in prop.get("multi_select", [])]
    if ptype == "status":
        status = prop.get("status")
        return status.get("name") if status else None
    if ptype == "date":
        date = prop.get("date")
        return date.get("start") if date else None
    if ptype == "url":
        return prop.get("url")
    if ptype == "checkbox":
        return prop.get("checkbox", False)
    if ptype == "number":
        return prop.get("number")
    if ptype == "relation":
        return [item.get("id") for item in prop.get("relation", [])]
    if ptype == "created_time":
        return prop.get("created_time")
    if ptype == "last_edited_time":
        return prop.get("last_edited_time")
    if ptype == "email":
        return prop.get("email")
    if ptype == "unique_id":
        unique_id = prop.get("unique_id", {})
        return f"{unique_id.get('prefix', '')}-{unique_id.get('number', '')}".strip("-")
    return None


def page_to_record(page: Dict[str, Any]) -> Dict[str, Any]:
    props = page.get("properties", {})
    record = {"id": page["id"], "url": page.get("url")}
    for key, value in props.items():
        record[key] = extract_property_value(value)
    return record


def title_property(content: str) -> Dict[str, Any]:
    return {"title": [{"type": "text", "text": {"content": content[:2000]}}]}


def rich_text_property(content: str) -> Dict[str, Any]:
    return {"rich_text": [{"type": "text", "text": {"content": content[:2000]}}]}


def select_property(name: Optional[str]) -> Dict[str, Any]:
    return {"select": {"name": name}} if name else {"select": None}


def checkbox_property(value: bool) -> Dict[str, Any]:
    return {"checkbox": bool(value)}


def date_property(value: Optional[str]) -> Dict[str, Any]:
    return {"date": {"start": value}} if value else {"date": None}


def url_property(value: Optional[str]) -> Dict[str, Any]:
    return {"url": value}


def relation_property(ids: Iterable[str]) -> Dict[str, Any]:
    return {"relation": [{"id": value} for value in ids]}


def text_rich_items(content: str) -> List[Dict[str, Any]]:
    return [{"type": "text", "text": {"content": content[:2000]}}]


def linked_text_item(content: str, url: Optional[str] = None, bold: bool = False) -> Dict[str, Any]:
    item: Dict[str, Any] = {
        "type": "text",
        "text": {"content": content[:2000]},
        "annotations": {
            "bold": bold,
            "italic": False,
            "strikethrough": False,
            "underline": False,
            "code": False,
            "color": "default",
        },
    }
    if url:
        item["text"]["link"] = {"url": url}
    return item


def paragraph_block(content: str) -> Dict[str, Any]:
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": text_rich_items(content)}}


def bulleted_item_block(content: str) -> Dict[str, Any]:
    return {
        "object": "block",
        "type": "bulleted_list_item",
        "bulleted_list_item": {"rich_text": text_rich_items(content)},
    }


def paragraph_rich_block(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": items[:100]}}


def bulleted_rich_block(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "object": "block",
        "type": "bulleted_list_item",
        "bulleted_list_item": {"rich_text": items[:100]},
    }


def heading_block(level: int, content: str) -> Dict[str, Any]:
    key = f"heading_{level}"
    return {"object": "block", "type": key, key: {"rich_text": text_rich_items(content)}}


def divider_block() -> Dict[str, Any]:
    return {"object": "block", "type": "divider", "divider": {}}
