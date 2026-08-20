import json
from argparse import ArgumentParser
from collections import Counter
from pathlib import Path

from supabase import create_client

from env_utils import get_required_supabase_config


BASE_DIR = Path(__file__).resolve().parent
ALIAS_PATH = BASE_DIR / "t5t_manual_aliases.json"


def fetch_all(client, date_from=None, date_to=None, lines=None, statuses=None):
    rows = []
    start = 0
    while True:
        query = client.table("t5t_form_items").select(
            "form_item_id,work_date,line,project_text,raw_text,classification_summary,match_status,matched_project_id,matched_fund_id,task_type,metadata"
        )
        if statuses:
            query = query.in_("match_status", statuses)
        else:
            query = query.eq("match_status", "raw_unmatched")
        if date_from:
            query = query.gte("work_date", date_from)
        if date_to:
            query = query.lte("work_date", date_to)
        if lines:
            query = query.in_("line", lines)
        result = query.range(start, start + 999).execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        start += 1000


def raw_header(row):
    raw_text = (row.get("raw_text") or "").strip()
    if not raw_text:
        return ""
    first_line = raw_text.splitlines()[0].strip()
    if first_line.startswith("[") and "]" in first_line:
        first_line = first_line[1:first_line.index("]")]
    elif " - " in first_line:
        first_line = first_line.split(" - ", 1)[0].strip()
    return first_line


def match_weight(row, alias):
    alias_text = alias.lower()
    weighted_texts = [
        (3, raw_header(row)),
        (2, row.get("project_text") or ""),
        (1, row.get("raw_text") or ""),
        (1, row.get("classification_summary") or ""),
    ]
    for weight, text in weighted_texts:
        if alias_text in str(text).lower():
            return weight
    return 0


def find_best_rule(row, rules):
    matches = []
    for index, rule in enumerate(rules):
        for alias in rule["aliases"]:
            weight = match_weight(row, alias)
            if weight:
                matches.append((weight, len(alias), index, rule, alias))
    if not matches:
        return None, None

    # Prefer header-level evidence, then the most specific alias.
    # Preserve JSON order as a stable tie-breaker.
    _, _, _, rule, alias = max(matches, key=lambda item: (item[0], item[1], -item[2]))
    return rule, alias


def build_update(row, rule):
    metadata = row.get("metadata") or {}
    metadata["manual_alias_match"] = {
        "source": "t5t_manual_aliases",
        "target_type": rule["target_type"],
        "target_id": rule.get("target_id"),
        "target_name": rule.get("target_name"),
    }
    update = {
        "metadata": metadata,
    }
    if rule["target_type"] == "project":
        update.update({
            "matched_project_id": rule["target_id"],
            "match_status": "matched",
            "task_type": "Project",
        })
    elif rule["target_type"] == "fund":
        update.update({
            "matched_fund_id": rule["target_id"],
            "match_status": "matched",
            "task_type": "Project",
        })
    elif rule["target_type"] == "general_work":
        update.update({
            "match_status": "general_work",
            "task_type": rule.get("target_name") or "General",
        })
    elif rule["target_type"] == "mission":
        update.update({
            "match_status": "mission",
            "task_type": rule.get("target_name") or "Mission",
        })
    else:
        raise ValueError(f"Unsupported target_type: {rule['target_type']}")
    return update


def main():
    parser = ArgumentParser(description="Apply manual aliases to unmatched T5T items.")
    parser.add_argument("--date-from")
    parser.add_argument("--date-to")
    parser.add_argument("--line", action="append", dest="lines")
    parser.add_argument("--status", action="append", dest="statuses")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--sample-size", type=int, default=30)
    args = parser.parse_args()

    rules = json.loads(ALIAS_PATH.read_text(encoding="utf-8"))
    url, key = get_required_supabase_config()
    client = create_client(url, key)
    rows = fetch_all(client, args.date_from, args.date_to, args.lines, args.statuses)

    updates = []
    samples = []
    rule_counts = Counter()
    for row in rows:
        rule, matched_alias = find_best_rule(row, rules)
        if not rule:
            continue
        update = build_update(row, rule)
        update["metadata"]["manual_alias_match"]["matched_alias"] = matched_alias
        updates.append((row["form_item_id"], update))
        rule_counts[rule["target_name"]] += 1
        if len(samples) < args.sample_size:
            samples.append({
                "form_item_id": row["form_item_id"],
                "work_date": row.get("work_date"),
                "line": row.get("line"),
                "project_text": row.get("project_text"),
                "raw_text": (row.get("raw_text") or "")[:220],
                "matched_alias": matched_alias,
                "update": update,
            })

    print(json.dumps({
        "mode": "apply" if args.apply else "dry_run",
        "source_rows": len(rows),
        "updates": len(updates),
        "rule_counts": dict(rule_counts),
        "samples": samples,
    }, ensure_ascii=False, indent=2))

    if args.apply:
        for form_item_id, update in updates:
            client.table("t5t_form_items").update(update).eq("form_item_id", form_item_id).execute()
        print(json.dumps({"updated": len(updates)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
