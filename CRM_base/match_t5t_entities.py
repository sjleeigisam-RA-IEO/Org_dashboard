import json
import re
from argparse import ArgumentParser
from collections import Counter, defaultdict
from difflib import SequenceMatcher

from supabase import create_client

from env_utils import get_required_supabase_config
from t5t_classification import effective_match_status
from t5t_classification import is_general_work


COMMON_TOKENS = {
    "이지스", "프로젝트", "개발", "사업", "복합", "펀드", "리츠", "부동산", "투자", "신탁",
    "사모", "전문", "업무", "검토", "관련", "진행", "협의", "관리", "보고", "미팅",
    "개발사업", "복합개발", "소형", "대형", "업무시설", "오피스", "물류", "센터",
    "the", "and", "fund", "project", "reit", "pfv", "dc", "igIS".lower(),
}
SUFFIX_PATTERNS = [
    r"개발사업", r"복합개발사업", r"복합개발", r"개발프로젝트", r"프로젝트",
    r"재개발", r"개발", r"사업", r"펀드", r"리츠", r"PFV", r"pfv",
]


def fetch_all(client, table, select, order=None, filters=None):
    rows = []
    start = 0
    while True:
        query = client.table(table).select(select)
        if order:
            query = query.order(order)
        if filters:
            for op, col, value in filters:
                if op == "eq":
                    query = query.eq(col, value)
                elif op == "neq":
                    query = query.neq(col, value)
                elif op == "gte":
                    query = query.gte(col, value)
                elif op == "lte":
                    query = query.lte(col, value)
        result = query.range(start, start + 999).execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v not in (None, "")]
    if isinstance(value, str):
        return [value] if value.strip() else []
    return [str(value)]


def compact(value):
    text = (value or "").lower()
    text = re.sub(r"[\s\-_·ㆍ,./()[\]{}'\"|:;]+", "", text)
    text = re.sub(r"(주식회사|유한회사|\(주\)|㈜|이지스자산운용|이지스)", "", text)
    for pattern in SUFFIX_PATTERNS:
        text = re.sub(pattern.lower(), "", text)
    return text


def tokens(value):
    raw = re.findall(r"[0-9A-Za-z]+|[가-힣]{2,}", value or "")
    out = []
    for token in raw:
        normalized = token.lower()
        if normalized in COMMON_TOKENS:
            continue
        if len(normalized) < 2:
            continue
        out.append(normalized)
    return out


def unique_preserve(values):
    seen = set()
    out = []
    for value in values:
        value = (value or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def is_weak_name(value):
    c = compact(value)
    if not c:
        return True
    if re.fullmatch(r"\d+호", c):
        return True
    if len(c) < 4 and not re.search(r"[a-z]{2,}|\d{4,}", c):
        return True
    return False


def names_from_project(row):
    metadata = row.get("metadata") or {}
    values = [
        row.get("project_name"),
        row.get("project_code"),
        metadata.get("Project & Mission 이름"),
        metadata.get("Vehicle(약칭)"),
        metadata.get("펀드명"),
        metadata.get("투자지역"),
        metadata.get("전체주소"),
    ]
    values.extend(as_list(metadata.get("자산명")))
    values.extend(as_list(metadata.get("Vehicle(약칭)(롤업)")))
    values.extend(as_list(metadata.get("펀드코드")))
    return unique_preserve([str(v) for value in values for v in as_list(value)])


def names_from_fund(row):
    metadata = row.get("metadata") or {}
    return unique_preserve([
        row.get("fund_id"),
        row.get("short_name"),
        row.get("fund_name"),
        row.get("asset_name"),
        row.get("project_mission_name"),
        metadata.get("fund_short_name"),
        metadata.get("fund_name"),
        metadata.get("asset_name"),
        metadata.get("ksd_fund_code"),
    ])


def names_from_asset(row):
    metadata = row.get("metadata") or {}
    names = [
        row.get("canonical_name"),
        row.get("asset_code"),
        metadata.get("source_group_key"),
    ]
    return unique_preserve(names)


def build_candidate(kind, row, names):
    name_tokens = Counter()
    compact_names = []
    filtered_names = [name for name in names if not is_weak_name(name)]
    for name in filtered_names:
        name_tokens.update(tokens(name))
        c = compact(name)
        if len(c) >= 2:
            compact_names.append(c)
    return {
        "kind": kind,
        "row": row,
        "names": filtered_names,
        "compact_names": unique_preserve(compact_names),
        "tokens": set(name_tokens),
    }


def score_candidate(item_text, item_project_text, item_tokens, candidate):
    text_compact = compact(item_text)
    project_compact = compact(item_project_text)
    best = 0.0
    reason = None
    matched_name = None

    for name, compact_name in zip(candidate["names"], [compact(n) for n in candidate["names"]]):
        if len(compact_name) < 2:
            continue
        has_number = bool(re.search(r"\d", compact_name))
        min_len = 2 if has_number else 4
        if len(compact_name) >= min_len and project_compact and compact_name in project_compact:
            return 0.99, "project_text_exact_contains", name
        if len(compact_name) >= min_len and compact_name in text_compact:
            score = 0.96 if has_number or len(compact_name) >= 5 else 0.90
            if score > best:
                best, reason, matched_name = score, "text_exact_contains", name

    overlap = candidate["tokens"] & item_tokens
    if candidate["tokens"]:
        overlap_score = len(overlap) / max(len(candidate["tokens"]), 1)
        distinctive_overlap = {token for token in overlap if token not in COMMON_TOKENS and len(token) >= 3}
        if len(overlap) >= 2 and distinctive_overlap and overlap_score >= 0.55:
            score = 0.72 + min(overlap_score, 1.0) * 0.2
            if score > best:
                best, reason, matched_name = score, f"token_overlap:{','.join(sorted(overlap))}", candidate["names"][0]

    for compact_name in candidate["compact_names"]:
        if len(compact_name) < 5:
            continue
        ratio = SequenceMatcher(None, compact_name, project_compact or text_compact[: max(len(compact_name) * 2, 20)]).ratio()
        if ratio >= 0.86 and ratio > best:
            best, reason, matched_name = ratio, "fuzzy_compact_ratio", compact_name

    return best, reason, matched_name


def choose_best(item, candidates, token_index):
    item_text = " ".join(
        part for part in [
            item.get("project_text"),
            item.get("raw_text"),
            item.get("classification_summary"),
        ]
        if part
    )
    item_tokens = set(tokens(item_text))
    candidate_ids = set()
    for token in item_tokens:
        candidate_ids.update(token_index.get(token, []))
    if not candidate_ids:
        return []

    scored = []
    for candidate_id in candidate_ids:
        candidate = candidates[candidate_id]
        score, reason, matched_name = score_candidate(item_text, item.get("project_text") or "", item_tokens, candidate)
        if score >= 0.86:
            scored.append((score, reason, matched_name, candidate))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:5]


def build_update(item, best, asset_to_projects, asset_to_funds):
    score, reason, matched_name, candidate = best
    row = candidate["row"]
    kind = candidate["kind"]
    metadata = item.get("metadata") or {}
    metadata["entity_match"] = {
        "source": "match_t5t_entities",
        "candidate_kind": kind,
        "candidate_name": matched_name,
        "score": round(score, 4),
        "reason": reason,
    }

    update = {
        "form_item_id": item["form_item_id"],
        "match_status": "matched",
        "metadata": metadata,
    }

    if kind == "project":
        update["matched_project_id"] = row.get("project_id")
        update["task_type"] = "Project"
    elif kind == "fund":
        update["matched_fund_id"] = row.get("fund_id")
        update["task_type"] = "Project"
        asset_id = row.get("primary_asset_id")
        if asset_id:
            metadata["entity_match"]["asset_id"] = asset_id
            project_ids = asset_to_projects.get(asset_id) or []
            if len(project_ids) == 1:
                update["matched_project_id"] = project_ids[0]
                metadata["entity_match"]["project_via_asset"] = project_ids[0]
    elif kind == "asset":
        asset_id = row.get("asset_id")
        metadata["entity_match"]["asset_id"] = asset_id
        project_ids = asset_to_projects.get(asset_id) or []
        fund_ids = asset_to_funds.get(asset_id) or []
        metadata["entity_match"]["asset_project_candidates"] = project_ids[:5]
        metadata["entity_match"]["asset_fund_candidates"] = fund_ids[:5]
        if len(project_ids) == 1:
            update["matched_project_id"] = project_ids[0]
            update["task_type"] = "Project"
        elif len(fund_ids) == 1:
            update["matched_fund_id"] = fund_ids[0]
            update["task_type"] = "Project"
        else:
            update["match_status"] = "candidate_match"
            update["task_type"] = "General"
    return update


def main():
    parser = ArgumentParser(description="Match unmatched T5T rows to projects, funds, and assets.")
    parser.add_argument("--date-from")
    parser.add_argument("--date-to")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--sample-size", type=int, default=30)
    args = parser.parse_args()

    url, key = get_required_supabase_config()
    client = create_client(url, key)

    items = fetch_all(
        client,
        "t5t_form_items",
        "form_item_id,work_date,project_text,raw_text,classification_summary,match_status,matched_project_id,matched_fund_id,task_type,metadata",
        order="work_date",
        filters=[f for f in [
            ("gte", "work_date", args.date_from) if args.date_from else None,
            ("lte", "work_date", args.date_to) if args.date_to else None,
        ] if f],
    )
    targets = [
        row for row in items
        if row.get("match_status") not in {"matched", "general_work", "mission"}
        and not row.get("matched_project_id")
        and not row.get("matched_fund_id")
        and not is_general_work(row.get("project_text"), row.get("raw_text"), row.get("classification_summary"), row.get("match_status"))
    ]
    if args.limit:
        targets = targets[:args.limit]

    projects = fetch_all(client, "projects", "project_id,project_name,project_code,project_type,status,source_system,metadata,primary_asset_id")
    funds = fetch_all(client, "funds", "fund_id,short_name,fund_name,asset_name,project_mission_name,status,metadata,primary_asset_id")
    assets = fetch_all(client, "asset_master", "asset_id,canonical_name,asset_code,city,address_text,metadata,representative_fund_id")
    asset_project_links = fetch_all(client, "asset_project_links", "asset_id,project_id,confidence")
    asset_fund_links = fetch_all(client, "asset_fund_links", "asset_id,fund_id,confidence")

    asset_to_projects = defaultdict(list)
    for row in asset_project_links:
        if row.get("asset_id") and row.get("project_id") and row["project_id"] not in asset_to_projects[row["asset_id"]]:
            asset_to_projects[row["asset_id"]].append(row["project_id"])
    asset_to_funds = defaultdict(list)
    for row in asset_fund_links:
        if row.get("asset_id") and row.get("fund_id") and row["fund_id"] not in asset_to_funds[row["asset_id"]]:
            asset_to_funds[row["asset_id"]].append(row["fund_id"])

    candidates = []
    for row in projects:
        names = names_from_project(row)
        if names:
            candidates.append(build_candidate("project", row, names))
    for row in funds:
        names = names_from_fund(row)
        if names:
            candidates.append(build_candidate("fund", row, names))
    for row in assets:
        names = names_from_asset(row)
        if names:
            candidates.append(build_candidate("asset", row, names))

    token_index = defaultdict(list)
    for idx, candidate in enumerate(candidates):
        for token in candidate["tokens"]:
            token_index[token].append(idx)

    updates = []
    candidate_only = []
    samples = []
    candidate_kind_counts = Counter()
    for item in targets:
        best_list = choose_best(item, candidates, token_index)
        if not best_list:
            continue
        best = best_list[0]
        update = build_update(item, best, asset_to_projects, asset_to_funds)
        if update.get("match_status") == "matched":
            updates.append(update)
            candidate_kind_counts[update["metadata"]["entity_match"]["candidate_kind"]] += 1
        else:
            candidate_only.append(update)
        if len(samples) < args.sample_size:
            samples.append({
                "form_item_id": item.get("form_item_id"),
                "work_date": item.get("work_date"),
                "project_text": item.get("project_text"),
                "raw_text": (item.get("raw_text") or "")[:220],
                "update": update,
            })

    result = {
        "mode": "apply" if args.apply else "dry_run",
        "source_items": len(items),
        "targets_after_general_work_exclusion": len(targets),
        "match_updates": len(updates),
        "candidate_only": len(candidate_only),
        "candidate_kind_counts": dict(candidate_kind_counts),
        "result_status_counts": dict(Counter(row.get("match_status") for row in updates)),
        "sample": samples,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if args.apply and updates:
        for row in updates:
            form_item_id = row.pop("form_item_id")
            client.table("t5t_form_items").update(row).eq("form_item_id", form_item_id).execute()
        print(json.dumps({"updated": len(updates)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
