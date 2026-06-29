import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from t5t_text_format import normalize_t5t_list_breaks


ROOT_DIR = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT_DIR / "CRM_base" / "output" / "t5t_text_format"
PROJECT_REF = "qvegpozwrcmspdvjokiz"
SQL_ENDPOINT = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"


def read_env():
    values = {}
    env_path = ROOT_DIR / ".env"
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    values.update({key: value for key, value in os.environ.items() if key.startswith("SUPABASE_")})
    return values


def sql_query(query):
    token = read_env().get("token") or os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("Supabase access token is required in .env as `token = ...` or SUPABASE_ACCESS_TOKEN.")
    payload = json.dumps({"query": query}).encode("utf-8")
    request = Request(
        SQL_ENDPOINT,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 Codex T5T text formatter",
        },
    )
    try:
        with urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"SQL API failed {error.code}: {body}") from error


def sql_literal(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def load_candidates(date_from=None, date_to=None):
    filters = [
        "("
        "raw_text ~ '[^\\n][[:space:]]+[-–—][[:space:]]+[^\\n]'"
        " or raw_text ~ '[^\\n][[:space:]]+[0-9]{1,2}[\\.)][[:space:]]+[^\\n]'"
        " or raw_text ~ '[^\\n][[:space:]]+[①-⑳][[:space:]]*[^\\n]'"
        " or raw_text ~ '[^\\n][[:space:]]+[•ㆍ·][[:space:]]*[^\\n]'"
        " or classification_summary ~ '[^\\n][[:space:]]+[-–—][[:space:]]+[^\\n]'"
        " or classification_summary ~ '[^\\n][[:space:]]+[0-9]{1,2}[\\.)][[:space:]]+[^\\n]'"
        ")"
    ]
    if date_from:
        filters.append(f"work_date >= {sql_literal(date_from)}::date")
    if date_to:
        filters.append(f"work_date <= {sql_literal(date_to)}::date")
    where = " and ".join(filters)
    query = f"""
select form_item_id, work_date, raw_text, classification_summary, metadata
from public.t5t_form_items
where {where}
order by work_date nulls last, form_item_id;
"""
    result = sql_query(query)
    if isinstance(result, dict):
        return result.get("value") or []
    return result or []


def build_updates(rows):
    updates = []
    for row in rows:
        next_raw = normalize_t5t_list_breaks(row.get("raw_text"))
        next_summary = normalize_t5t_list_breaks(row.get("classification_summary"))
        if next_raw != row.get("raw_text") or next_summary != row.get("classification_summary"):
            updates.append({
                "form_item_id": row["form_item_id"],
                "work_date": row.get("work_date"),
                "raw_text_before": row.get("raw_text"),
                "raw_text_after": next_raw,
                "classification_summary_before": row.get("classification_summary"),
                "classification_summary_after": next_summary,
            })
    return updates


def apply_batch(batch):
    payload = [
        {
            "form_item_id": row["form_item_id"],
            "raw_text": row["raw_text_after"],
            "classification_summary": row["classification_summary_after"],
        }
        for row in batch
    ]
    json_payload = json.dumps(payload, ensure_ascii=False)
    query = f"""
with updates as (
  select *
  from jsonb_to_recordset($t5t_json${json_payload}$t5t_json$::jsonb)
    as x(form_item_id text, raw_text text, classification_summary text)
)
update public.t5t_form_items as t
set raw_text = updates.raw_text,
    classification_summary = updates.classification_summary,
    metadata = coalesce(t.metadata, '{{}}'::jsonb) || jsonb_build_object(
      'text_format_normalized_at', now(),
      'text_format_normalizer', 't5t_list_breaks_v1'
    ),
    updated_at = now()
from updates
where t.form_item_id = updates.form_item_id;
"""
    sql_query(query)


def main():
    parser = argparse.ArgumentParser(description="Normalize inline bullet/list breaks in t5t_form_items.")
    parser.add_argument("--apply", action="store_true", help="Write changes to Supabase. Default is dry-run.")
    parser.add_argument("--date-from")
    parser.add_argument("--date-to")
    parser.add_argument("--batch-size", type=int, default=100)
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = load_candidates(args.date_from, args.date_to)
    updates = build_updates(rows)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = OUT_DIR / f"t5t_text_format_{stamp}.json"
    backup_path.write_text(json.dumps({
        "applied": args.apply,
        "candidate_rows": len(rows),
        "changed_rows": len(updates),
        "generated_at": stamp,
        "updates": updates,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.apply:
        for index in range(0, len(updates), args.batch_size):
            apply_batch(updates[index:index + args.batch_size])

    print(json.dumps({
        "applied": args.apply,
        "candidate_rows": len(rows),
        "changed_rows": len(updates),
        "backup_path": str(backup_path),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
