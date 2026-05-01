import argparse
import csv
import hashlib
import io
import json
from datetime import datetime
from pathlib import Path

from dotenv import dotenv_values
from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
DEFAULT_CSV_PATH = ROOT_DIR / "t5t-dashboard" / "IGIS RA T-5-T Forms_Submissions_2026-05-01.csv"
OUT_DIR = BASE_DIR / "supabase_seed"


def clean(value):
    if value is None:
        return None
    text = str(value).replace("\xa0", " ").strip()
    if not text or text.lower() in {"nan", "none", "null", "undefined"}:
        return None
    return text


def parse_datetime(value):
    text = clean(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
    except ValueError:
        return None


def parse_date(value):
    text = clean(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return text[:10] if len(text) >= 10 else None


def make_id(prefix, *parts):
    raw = "|".join(str(clean(part) or "") for part in parts)
    return f"{prefix}_{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]}"


def get_client():
    cfg = dotenv_values(BASE_DIR / ".env")
    return create_client(cfg["SUPABASE_URL"], cfg["SUPABASE_KEY"])


def fetch_staff_lookup():
    client = get_client()
    rows = []
    start = 0
    while True:
        result = client.table("staff").select("staff_id,name,email").range(start, start + 999).execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        start += 1000
    by_email = {clean(row.get("email")).lower(): row["staff_id"] for row in rows if clean(row.get("email"))}
    by_name = {clean(row.get("name")): row["staff_id"] for row in rows if clean(row.get("name"))}
    return by_email, by_name


def read_form_csv(path):
    text = Path(path).read_text(encoding="utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def build_seed(csv_path):
    rows = read_form_csv(csv_path)
    staff_by_email, staff_by_name = fetch_staff_lookup()
    if not rows:
        return [], []

    headers = list(rows[0].keys())
    submitted_at_h = headers[2]
    name_h = headers[3]
    email_h = headers[4]
    position_h = headers[5]
    work_date_h = headers[6]
    line_h = headers[7]
    attachment_h = headers[23]
    t5t_headers = [headers[8], headers[11], headers[14], headers[17], headers[20]]
    project_headers = [headers[9], headers[12], headers[15], headers[18], headers[21]]
    stakeholder_headers = [headers[10], headers[13], headers[16], headers[19], headers[22]]

    submissions = []
    items = []

    for row in rows:
        submission_id = clean(row.get("Submission ID")) or make_id("submission", row.get(submitted_at_h), row.get(email_h))
        email = clean(row.get(email_h))
        name = clean(row.get(name_h))
        staff_id = staff_by_email.get(email.lower()) if email else None
        if not staff_id and name:
            staff_id = staff_by_name.get(name)

        submissions.append({
            "submission_id": submission_id,
            "respondent_id": clean(row.get("Respondent ID")),
            "submitted_at": parse_datetime(row.get(submitted_at_h)),
            "writer_staff_id": staff_id,
            "writer_name": name,
            "writer_email": email,
            "position": clean(row.get(position_h)),
            "work_date": parse_date(row.get(work_date_h)),
            "line": clean(row.get(line_h)),
            "attachment_url": clean(row.get(attachment_h)),
            "source_file": Path(csv_path).name,
            "metadata": {
                "raw_row": row,
                "headers": headers,
            },
        })

        for index in range(5):
            raw_text = clean(row.get(t5t_headers[index]))
            if not raw_text:
                continue
            item_no = index + 1
            form_item_id = f"{submission_id}:{item_no}"
            items.append({
                "form_item_id": form_item_id,
                "submission_id": submission_id,
                "item_no": item_no,
                "writer_staff_id": staff_id,
                "work_date": parse_date(row.get(work_date_h)),
                "line": clean(row.get(line_h)),
                "raw_text": raw_text,
                "project_text": clean(row.get(project_headers[index])),
                "stakeholder_text": clean(row.get(stakeholder_headers[index])),
                "matched_project_id": None,
                "match_status": "raw_unmatched",
                "metadata": {
                    "source_t5t_column": t5t_headers[index],
                    "source_project_column": project_headers[index],
                    "source_stakeholder_column": stakeholder_headers[index],
                },
            })

    return submissions, items


def write_json(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(rows, file, ensure_ascii=False, indent=2)
        file.write("\n")


def main():
    parser = argparse.ArgumentParser(description="Build seed JSON from raw T5T form CSV submissions.")
    parser.add_argument("--csv", default=str(DEFAULT_CSV_PATH))
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    args = parser.parse_args()

    submissions, items = build_seed(Path(args.csv))
    out_dir = Path(args.out_dir)
    write_json(out_dir / "t5t_form_submissions.json", submissions)
    write_json(out_dir / "t5t_form_items.json", items)
    manifest = {
        "source_file": str(Path(args.csv)),
        "counts": {
            "t5t_form_submissions": len(submissions),
            "t5t_form_items": len(items),
        },
        "note": "Raw form export is preserved separately from processed Notion logs.",
    }
    write_json(out_dir / "t5t_raw_manifest.json", manifest)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
