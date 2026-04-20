import json
import os
import re
import traceback
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

from automation_runtime.notion_runtime import (
    NotionClient,
    NotionConfig,
    bulleted_item_block,
    bulleted_rich_block,
    checkbox_property,
    date_property,
    divider_block,
    heading_block,
    linked_text_item,
    page_to_record,
    paragraph_block,
    paragraph_rich_block,
    relation_property,
    rich_text_property,
    select_property,
    title_property,
    url_property,
)


SEOUL = ZoneInfo("Asia/Seoul")
LINE_ORDER = [
    "A Line",
    "B Line",
    "C1 Line",
    "C2 Line",
    "D Line",
    "D-TF Line",
    "E Line",
    "Global A Line",
    "Global E Line",
    "R Line",
]


@dataclass
class ParsedTask:
    headline: str
    detail: str
    project: str
    counterparties: str
    task_type: str
    source_page_url: str


@dataclass
class WriterEntry:
    writer: str
    line: str
    position: str
    date: str
    page_id: str
    page_url: str
    tasks: List[ParsedTask]


class AutomationRuntime:
    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root
        self.config = NotionConfig.load(workspace_root)
        self.client = NotionClient(self.config)
        self.runtime_dir = workspace_root / "automation_runtime"
        self.log_dir = self.runtime_dir / "logs"
        self.state_dir = self.runtime_dir / "state"
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.state_dir.mkdir(parents=True, exist_ok=True)

    def run_job(self, job: str, run_date: Optional[date] = None) -> Dict[str, Any]:
        run_date = run_date or datetime.now(SEOUL).date()
        try:
            if job in {"t5t_summary_draft", "t5t_summary_update"}:
                variant = "draft" if job == "t5t_summary_draft" else "update"
                result = self.sync_weekly_summary(run_date, variant)
            elif job in {"t5t_activity_first", "t5t_activity_update"}:
                result = self.sync_activity_log(run_date, job)
            else:
                raise ValueError(f"Unsupported job: {job}")
            self._write_run_log(job, result, success=True)
            self._write_state(job, result)
            return result
        except Exception as exc:
            payload = {
                "job": job,
                "run_date": run_date.isoformat(),
                "success": False,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            }
            self._write_run_log(job, payload, success=False)
            raise

    def _write_run_log(self, job: str, payload: Dict[str, Any], success: bool) -> None:
        now = datetime.now(SEOUL).strftime("%Y-%m-%d %H:%M:%S")
        line = {"timestamp": now, "success": success, **payload}
        with (self.log_dir / f"{job}.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(line, ensure_ascii=False) + "\n")

    def _write_state(self, job: str, payload: Dict[str, Any]) -> None:
        with (self.state_dir / f"{job}.json").open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)

    def _get_window(self, run_date: date) -> Tuple[date, date]:
        end_date = run_date - timedelta(days=(run_date.weekday() - 0) % 7)
        start_date = end_date - timedelta(days=6)
        return start_date, end_date

    def _fetch_source_pages(self, start_date: date, end_date: date) -> List[WriterEntry]:
        source_db_id = self._resolve_source_database_id()
        filter_payload = {
            "and": [
                {"property": "Date", "date": {"on_or_after": start_date.isoformat()}},
                {"property": "Date", "date": {"on_or_before": end_date.isoformat()}},
            ]
        }
        pages = self.client.query_database(
            source_db_id,
            filter_payload=filter_payload,
            sorts=[{"property": "Date", "direction": "ascending"}],
        )
        entries: List[WriterEntry] = []
        for page in pages:
            record = page_to_record(page)
            tasks = self._parse_t5t_page(page["id"], record["url"])
            entries.append(
                WriterEntry(
                    writer=(record.get("작성자") or "").strip(),
                    line=(record.get("Line") or "").strip(),
                    position=(record.get("Position") or "").strip(),
                    date=(record.get("Date") or "").strip(),
                    page_id=page["id"],
                    page_url=record["url"],
                    tasks=tasks,
                )
            )
        return [entry for entry in entries if entry.writer]

    def _resolve_source_database_id(self) -> str:
        try:
            self.client.query_database(self.config.source_db_id, page_size=1)
            return self.config.source_db_id
        except Exception:
            pass

        candidates = self.client.search("T5T Data Base", object_type="database")
        for candidate in candidates:
            title = "".join(
                part.get("plain_text", "")
                for part in candidate.get("title", [])
            ).strip()
            if title == "T5T Data Base":
                return candidate["id"]

        raise RuntimeError(
            "원본 'T5T Data Base'가 현재 Notion API 통합에 공유되지 않아 자동화를 완료할 수 없습니다. "
            "통합 'sj_api'에 해당 데이터베이스 공유가 필요합니다."
        )

    def _parse_t5t_page(self, page_id: str, page_url: str) -> List[ParsedTask]:
        lines: List[str] = []
        for block in self.client.retrieve_block_children(page_id):
            block_type = block.get("type")
            payload = block.get(block_type, {})
            rich_text = payload.get("rich_text", [])
            text = "".join(item.get("plain_text", "") for item in rich_text).strip()
            if text:
                lines.extend(part.strip() for part in text.splitlines() if part.strip())

        tasks: List[List[str]] = []
        current: List[str] = []
        for line in lines:
            if "[T" in line:
                if current:
                    tasks.append(current)
                current = [line]
            elif current:
                current.append(line)
        if current:
            tasks.append(current)

        parsed: List[ParsedTask] = []
        for block in tasks:
            parsed.append(self._parse_task_block(block, page_url))
        return parsed

    def _parse_task_block(self, lines: List[str], page_url: str) -> ParsedTask:
        headline = ""
        detail_parts: List[str] = []
        project = ""
        counterparties = ""

        for raw in lines:
            line = raw.replace("\\>", "").replace("\\[", "[").replace("\\]", "]").strip()
            if "[T" in line:
                continue
            if "내용 :" in line:
                value = line.split("내용 :", 1)[1].strip()
                detail_parts.append(value)
                if not headline:
                    headline = value
                continue
            if "관련 프로젝트 :" in line:
                project = line.split("관련 프로젝트 :", 1)[1].strip()
                continue
            if "외부 관계자/상대방 :" in line:
                counterparties = line.split("외부 관계자/상대방 :", 1)[1].strip()
                continue
            detail_parts.append(line)

        detail = " ".join(part for part in detail_parts if part and part != "-").strip()
        inferred_project = self._infer_project_name(project, headline, detail)
        headline_text = self._infer_headline(headline, inferred_project, detail)
        task_type = self._infer_task_type(headline_text, detail, inferred_project)

        return ParsedTask(
            headline=headline_text,
            detail=detail,
            project=inferred_project,
            counterparties=counterparties,
            task_type=task_type,
            source_page_url=page_url,
        )

    def _infer_project_name(self, project: str, headline: str, detail: str) -> str:
        if project and project != "-":
            return self._clean_label(project)
        bracket = re.search(r"\[([^\]]+)\]", headline)
        if bracket:
            return self._clean_label(bracket.group(1))
        prefix = re.split(r"[:：]", headline, maxsplit=1)[0].strip()
        if prefix and len(prefix) <= 40:
            return self._clean_label(prefix)
        words = re.split(r"[.·,/]", detail)
        if words:
            candidate = words[0].strip()
            if 2 <= len(candidate) <= 40:
                return self._clean_label(candidate)
        return "주요 업무"

    def _infer_headline(self, headline: str, project: str, detail: str) -> str:
        cleaned = self._clean_label(headline)
        if cleaned and cleaned not in {"-", "기타"}:
            return cleaned[:80]
        if project and project != "주요 업무":
            return project
        return detail[:80] if detail else "업무"

    def _infer_task_type(self, headline: str, detail: str, project: str) -> str:
        text = f"{headline} {detail} {project}"
        if any(keyword in text for keyword in ["신규", "입찰", "소싱", "탭핑", "검토", "제안"]):
            return "신규검토"
        if any(keyword in text for keyword in ["소송", "리스크", "민원", "법무", "심의", "분쟁"]):
            return "리스크/법무"
        if any(keyword in text for keyword in ["채용", "보고", "브리핑", "조직", "내부", "협약 후속"]):
            return "내부/기타"
        return "프로젝트"

    def _clean_label(self, text: str) -> str:
        result = text.strip()
        result = result.strip("-")
        result = re.sub(r"\s+", " ", result)
        return result

    def _normalize_key(self, text: str) -> str:
        return re.sub(r"[^0-9a-z가-힣]", "", (text or "").lower())

    def _clean_token(self, token: str) -> str:
        token = (token or "").strip().lstrip("#").strip()
        token = re.sub(r"^[^\w가-힣]+|[^\w가-힣&.+/-]+$", "", token)
        if re.fullmatch(r"[가-힣]{3,}", token):
            stripped = re.sub(r"(에서|으로|에게|까지|부터|보다|처럼|만의|와의|과의|으로의|에서의|에게서|의|을|를|이|가|은|는|와|과|도|만)$", "", token)
            if len(stripped) >= 2:
                token = stripped
        return token

    def _tokenize_text(self, text: str) -> List[str]:
        stopwords = {
            "관련", "진행", "검토", "협의", "대응", "보고", "준비", "회의", "후속", "업무", "프로젝트",
            "투자", "자료", "정리", "추진", "계획", "내부", "외부", "필요", "완료", "예정", "업데이트",
            "요청", "확인", "논의", "추가", "주요", "포함",
        }
        keep = {"pf", "ir", "loc", "mou", "spa", "eod", "lp", "rfp"}
        matches = re.findall(r"[A-Za-z][A-Za-z0-9&.+/-]{1,}|[가-힣]{2,}|[0-9]+호", text)
        results: List[str] = []
        seen = set()
        for raw in matches:
            token = self._clean_token(raw)
            if len(token) < 2:
                continue
            lowered = token.lower()
            if lowered in stopwords and lowered not in keep:
                continue
            if re.fullmatch(r"\d+", token):
                continue
            if re.fullmatch(r"[A-Za-z]{2,3}", token) and lowered not in keep:
                continue
            if lowered in seen:
                continue
            seen.add(lowered)
            results.append(token)
        return results

    def _derive_classification_summary(self, task: ParsedTask) -> str:
        base = task.detail or task.headline or ""
        base = re.sub(r"\s+", " ", base).strip()
        if task.project and task.project not in base:
            base = f"{task.project} 관련, {base}" if base else f"{task.project} 관련 업무"
        return base[:280] or "원문 요약 및 업무 로그명 미입력으로 분류 대기."

    def _derive_classification_tokens(self, task: ParsedTask) -> List[str]:
        text = " ".join(
            part for part in [task.project, task.headline, task.detail, task.counterparties]
            if part and part != "-"
        )
        tokens = self._tokenize_text(text)
        if task.project:
            project_token = self._clean_token(task.project)
            if project_token and project_token.lower() not in {token.lower() for token in tokens}:
                tokens = [project_token] + tokens
        return tokens[:12] if tokens else ["미입력", "분류대기"]

    def _classification_token_string(self, tokens: List[str]) -> str:
        return " ".join(f"#{token}" for token in tokens if token)

    def sync_weekly_summary(self, run_date: date, variant: str) -> Dict[str, Any]:
        start_date, end_date = self._get_window(run_date)
        entries = self._fetch_summary_entries(start_date, end_date)
        grouped = self._group_summary_entries(entries)

        title = f"주간 T5T 요약 {end_date.isoformat()} (화~월 기준)"
        page = self._find_summary_page(title)
        content_blocks = self._build_summary_blocks(start_date, end_date, grouped, variant)
        summary_text = self._build_summary_property(grouped)
        properties = {
            "제목": title_property(title),
            "요약": rich_text_property(summary_text),
        }

        page_url: str
        action: str
        if page:
            created = self.client.create_page(self.config.summary_db_id, properties, content_blocks)
            self.client.archive_page(page["id"])
            page_url = created["url"]
            action = "recreated"
        else:
            created = self.client.create_page(self.config.summary_db_id, properties, content_blocks)
            page_url = created["url"]
            action = "created"

        return {
            "job_type": "weekly_summary",
            "variant": variant,
            "window_start": start_date.isoformat(),
            "window_end": end_date.isoformat(),
            "entry_count": len(entries),
            "page_title": title,
            "page_url": page_url,
            "action": action,
        }

    def _fetch_summary_entries(self, start_date: date, end_date: date) -> List[WriterEntry]:
        return self._fetch_source_pages(start_date, end_date)

    def _activity_headline(self, title: str) -> str:
        parts = [part.strip() for part in title.split("|")]
        if len(parts) >= 3:
            return parts[2]
        return title.strip()

    def _activity_project_name(self, title: str, summary: str) -> str:
        headline = self._activity_headline(title)
        prefix = re.split(r"[:：,/·]", headline, maxsplit=1)[0].strip()
        if 2 <= len(prefix) <= 40:
            return self._clean_label(prefix)
        return self._infer_project_name("", headline, summary)

    def _group_summary_entries(
        self, entries: List[WriterEntry]
    ) -> Dict[str, Dict[str, Any]]:
        grouped: Dict[str, Dict[str, Any]] = {}
        for entry in entries:
            for task in entry.tasks:
                project_name = task.project or "주요 업무"
                project_key = self._normalize_key(project_name) or project_name
                bucket = grouped.setdefault(
                    project_key,
                    {
                        "name": project_name,
                        "writers": defaultdict(list),
                        "lines": set(),
                    },
                )
                bucket["name"] = self._prefer_project_name(bucket["name"], project_name)
                bucket["writers"][entry.writer].append((entry, task))
                if entry.line:
                    bucket["lines"].add(entry.line)
        return grouped

    def _find_summary_page(self, title: str) -> Optional[Dict[str, Any]]:
        pages = self.client.query_database(self.config.summary_db_id)
        for page in pages:
            record = page_to_record(page)
            if (record.get("제목") or "") == title:
                return {"id": page["id"], "url": record["url"]}
        return None

    def _build_summary_blocks(
        self,
        start_date: date,
        end_date: date,
        grouped: Dict[str, Dict[str, Any]],
        variant: str,
    ) -> List[Dict[str, Any]]:
        blocks: List[Dict[str, Any]] = [
            heading_block(2, "기준"),
            bulleted_item_block(f"대상 주차: {start_date.isoformat()} ~ {end_date.isoformat()} (화~월)"),
            bulleted_item_block("정리 원칙: 원본 T5T 기준 프로젝트별 묶음, 작성자별 핵심 진행사항 정리"),
            bulleted_item_block(
                "작성 목적: 월요일 주간요약 초안" if variant == "draft" else "작성 목적: 화요일 보완 업데이트"
            ),
        ]

        for project in self._sorted_projects(grouped):
            blocks.append(heading_block(2, project["name"]))
            if len(project["lines"]) > 1:
                blocks.append(
                    paragraph_block(
                        f"관련 라인: {', '.join(sorted(project['lines']))}에서 공통으로 다뤄진 프로젝트입니다."
                    )
                )
            for writer in sorted(project["writers"]):
                blocks.append(self._writer_project_block(writer, project["writers"][writer]))
        return blocks

    def _task_sentence(self, task: ParsedTask) -> str:
        text = task.detail or task.headline
        text = re.sub(r"\s+", " ", text).strip()
        if task.counterparties and task.counterparties != "-":
            text = f"{text} / 관련자: {task.counterparties}"
        return text[:220]

    def _prefer_project_name(self, current: str, candidate: str) -> str:
        current_score = len(current.strip()) if current else 0
        candidate_score = len(candidate.strip()) if candidate else 0
        return candidate if candidate_score > current_score else current

    def _sorted_projects(self, grouped: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        return sorted(
            grouped.values(),
            key=lambda item: (-sum(len(tasks) for tasks in item["writers"].values()), item["name"]),
        )

    def _writer_project_block(self, writer: str, items: List[Tuple[WriterEntry, ParsedTask]]) -> Dict[str, Any]:
        unique_sentences: List[str] = []
        source_url = ""
        for entry, task in items:
            sentence = self._task_sentence(task)
            if sentence and sentence not in unique_sentences:
                unique_sentences.append(sentence)
            if not source_url:
                source_url = task.source_page_url or entry.page_url

        summary = "; ".join(unique_sentences[:3])[:1400]
        rich_items = [
            linked_text_item(f"{writer}: ", bold=True),
            linked_text_item(summary),
        ]
        if source_url:
            rich_items.extend(
                [
                    linked_text_item(" "),
                    linked_text_item("원문", url=source_url),
                ]
            )
        return bulleted_rich_block(rich_items)

    def _build_summary_property(self, grouped: Dict[str, Dict[str, Any]]) -> str:
        parts: List[str] = []
        for project in self._sorted_projects(grouped):
            parts.append(f"{project['name']} 관련 진행사항이 정리되었습니다.")
            if len(parts) == 3:
                break
        return " ".join(parts)[:1900]

    def sync_activity_log(self, run_date: date, job: str) -> Dict[str, Any]:
        start_date, end_date = self._get_window(run_date)
        entries = self._fetch_source_pages(start_date, end_date)
        existing = self._existing_activity_log_entries(end_date)
        project_mission_index = self._load_reference_index(self.config.project_mission_db_id, "Project & Mission 이름")
        project_master_index = self._load_reference_index(self.config.project_master_db_id, "프로젝트명")
        new_project_index = self._load_reference_index(self.config.new_project_db_id, "프로젝트 이름")

        created = 0
        updated = 0
        skipped = 0
        manual_checks = 0

        for entry in entries:
            for task in entry.tasks:
                payload = self._build_activity_payload(
                    entry,
                    task,
                    end_date,
                    project_mission_index,
                    project_master_index,
                    new_project_index,
                )
                signature = payload["signature"]
                page_id = existing.get(signature)
                if page_id:
                    self.client.update_page_properties(page_id, payload["properties"])
                    updated += 1
                else:
                    created_page = self.client.create_page(self.config.activity_log_db_id, payload["properties"])
                    existing[signature] = created_page["id"]
                    created += 1
                if payload["manual_check"]:
                    manual_checks += 1
                else:
                    skipped += 0

        return {
            "job_type": "activity_log",
            "job": job,
            "window_start": start_date.isoformat(),
            "window_end": end_date.isoformat(),
            "source_entry_count": len(entries),
            "created": created,
            "updated": updated,
            "manual_checks": manual_checks,
            "log_database_id": self.config.activity_log_db_id,
        }

    def _existing_activity_log_entries(self, end_date: date) -> Dict[str, str]:
        filter_payload = {"property": "주차종료일", "date": {"equals": end_date.isoformat()}}
        pages = self.client.query_database(self.config.activity_log_db_id, filter_payload=filter_payload)
        mapping: Dict[str, str] = {}
        for page in pages:
            record = page_to_record(page)
            signature = self._activity_signature(
                record.get("원문 URL") or "",
                record.get("업무일자") or "",
                record.get("작성자") or "",
                record.get("업무 로그명") or "",
            )
            mapping[signature] = page["id"]
        return mapping

    def _load_reference_index(self, db_id: str, title_key: str) -> List[Tuple[str, Dict[str, Any]]]:
        pages = self.client.query_database(db_id)
        index: List[Tuple[str, Dict[str, Any]]] = []
        for page in pages:
            record = page_to_record(page)
            title = (record.get(title_key) or "").strip()
            if title:
                index.append((self._normalize_key(title), {"id": page["id"], "title": title, "record": record}))
        index.sort(key=lambda item: len(item[0]), reverse=True)
        return index

    def _build_activity_payload(
        self,
        entry: WriterEntry,
        task: ParsedTask,
        end_date: date,
        project_mission_index: List[Tuple[str, Dict[str, Any]]],
        project_master_index: List[Tuple[str, Dict[str, Any]]],
        new_project_index: List[Tuple[str, Dict[str, Any]]],
    ) -> Dict[str, Any]:
        classification_summary = self._derive_classification_summary(task)
        classification_tokens = self._derive_classification_tokens(task)
        classification_token_string = self._classification_token_string(classification_tokens)
        combined = " ".join(
            part
            for part in [
                task.project,
                task.headline,
                task.detail,
                classification_summary,
                " ".join(classification_tokens),
            ]
            if part
        )
        matched_pm = self._match_reference(combined, project_mission_index)
        matched_new = self._match_reference(combined, new_project_index)
        matched_master = self._match_reference(combined, project_master_index)

        project_mission_ids: List[str] = []
        new_project_ids: List[str] = []
        match_status = "미매칭"
        match_reason = "명시적 매칭 후보를 찾지 못해 미매칭으로 처리"
        manual_check = True

        if matched_pm:
            project_mission_ids = [matched_pm["id"]]
            match_status = "Project & Mission 매칭"
            match_reason = f"'{matched_pm['title']}' 키워드가 원문에 포함되어 자동 매칭"
            manual_check = False
        elif matched_new:
            new_project_ids = [matched_new["id"]]
            match_status = "신규 프로젝트 매칭"
            match_reason = f"'{matched_new['title']}' 키워드가 원문에 포함되어 자동 매칭"
            manual_check = False
        elif matched_master:
            match_reason = f"프로젝트 마스터의 '{matched_master['title']}'와 유사하나 직접 relation 스키마가 없어 미매칭 유지"

        title = f"{entry.date} | {entry.writer} | {task.headline}"[:180]
        summary = self._task_sentence(task)
        signature = self._activity_signature(task.source_page_url, entry.date, entry.writer, title)
        properties = {
            "업무 로그명": title_property(title),
            "작성자": rich_text_property(entry.writer),
            "라인": select_property(entry.line or None),
            "업무유형": select_property(task.task_type),
            "업무일자": date_property(entry.date),
            "주차종료일": date_property(end_date.isoformat()),
            "주차키": rich_text_property(f"{(end_date - timedelta(days=6)).isoformat()}~{end_date.isoformat()}"),
            "원문 요약": rich_text_property(summary),
            "원문 URL": url_property(task.source_page_url),
            "T5T 작성자 페이지": url_property(entry.page_url),
            "Project & Mission": relation_property(project_mission_ids),
            "신규 프로젝트": relation_property(new_project_ids),
            "매칭 상태": select_property(match_status),
            "매칭 근거": rich_text_property(match_reason),
            "수동 확인 필요": checkbox_property(manual_check),
            "비고": rich_text_property(task.counterparties or ""),
        }

        properties["classification_summary"] = rich_text_property(classification_summary)
        properties["classification_tokens"] = rich_text_property(classification_token_string)
        return {"signature": signature, "properties": properties, "manual_check": manual_check}

    def _match_reference(self, text: str, index: List[Tuple[str, Dict[str, Any]]]) -> Optional[Dict[str, Any]]:
        normalized_text = self._normalize_key(text)
        if not normalized_text:
            return None
        for normalized_title, payload in index:
            if len(normalized_title) < 3:
                continue
            if normalized_title in normalized_text or normalized_text in normalized_title:
                return payload
        return None

    def _activity_signature(self, source_url: str, work_date: str, writer: str, title: str) -> str:
        return "|".join(
            [
                self._normalize_key(source_url),
                self._normalize_key(work_date),
                self._normalize_key(writer),
                self._normalize_key(title),
            ]
        )
