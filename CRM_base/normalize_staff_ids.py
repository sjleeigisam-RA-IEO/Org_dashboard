import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
BACKUP_DIR = BASE_DIR / "_backups"


REF_COLUMNS = [
    ("staff_org_assignments", "staff_id"),
    ("seats", "staff_id"),
    ("iota_seoul_logs", "writer_staff_id"),
    ("t5t_form_submissions", "writer_staff_id"),
    ("t5t_form_items", "writer_staff_id"),
    ("funds", "manager_staff_id"),
    ("projects", "lead_staff_id"),
]


def load_env():
    env_path = PROJECT_DIR / ".env"
    values = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key] = value
    values.update({k: v for k, v in os.environ.items() if k.startswith("SUPABASE_")})
    return values


def fetch_all(client, table, select="*"):
    rows = []
    start = 0
    size = 1000
    while True:
        batch = client.table(table).select(select).range(start, start + size - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < size:
            return rows
        start += size


def build_mapping(staff_rows):
    mapping = []
    ext_counter = 1
    sorted_rows = sorted(
        staff_rows,
        key=lambda row: (
            row.get("employee_no") in ("", None),
            str(row.get("employee_no") or ""),
            row.get("name") or "",
            row["staff_id"],
        ),
    )
    for row in sorted_rows:
        employee_no = str(row.get("employee_no") or "").strip()
        if employee_no:
            new_id = f"staff_{employee_no}"
        else:
            new_id = f"staff_ext_{ext_counter:06d}"
            ext_counter += 1
        mapping.append(
            {
                "old_staff_id": row["staff_id"],
                "new_staff_id": new_id,
                "name": row.get("name"),
                "employee_no": employee_no or None,
            }
        )
    return mapping


def validate_mapping(mapping):
    old_ids = [row["old_staff_id"] for row in mapping]
    new_ids = [row["new_staff_id"] for row in mapping]
    errors = []
    if len(old_ids) != len(set(old_ids)):
        errors.append("Duplicate old_staff_id values.")
    if len(new_ids) != len(set(new_ids)):
        errors.append("Duplicate new_staff_id values.")
    collision = {row["new_staff_id"] for row in mapping if row["old_staff_id"] != row["new_staff_id"]} & set(old_ids)
    if collision:
        errors.append(f"New IDs collide with existing old IDs: {sorted(collision)[:10]}")
    return errors


def reference_snapshot(client):
    snapshot = {}
    for table, column in REF_COLUMNS:
        rows = fetch_all(client, table, "*")
        values = [row.get(column) for row in rows if row.get(column)]
        snapshot[f"{table}.{column}"] = {
            "table_rows": len(rows),
            "non_null_refs": len(values),
            "unique_refs": len(set(values)),
            "unique_values": sorted(set(values)),
            "sample_rows": [row for row in rows if row.get(column)][:5],
        }
    return snapshot


def count_refs_by_old_id(client, old_ids):
    counts = {}
    old_set = set(old_ids)
    for table, column in REF_COLUMNS:
        rows = fetch_all(client, table, column)
        counts[f"{table}.{column}"] = sum(1 for row in rows if row.get(column) in old_set)
    return counts


def write_backup(payload):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    path = BACKUP_DIR / "staff_id_normalization_backup.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return path


def order_mapping_for_apply(mapping, ref_snapshot):
    referenced_ids = set()
    for snap in ref_snapshot.values():
        referenced_ids.update(snap.get("unique_values", []))
    # Referenced IDs first. If the database has restrictive FK constraints,
    # this makes the apply fail before changing unreferenced rows.
    return sorted(
        mapping,
        key=lambda row: (
            row["old_staff_id"] not in referenced_ids,
            row["old_staff_id"] == row["new_staff_id"],
            not row["old_staff_id"].startswith("staff_emp_"),
            row["old_staff_id"],
        ),
    )


def migrate_staff_rows(client, staff_rows_by_id, mapping):
    stats = {
        "staff_rows_inserted": 0,
        "old_staff_rows_deleted": 0,
        "ref_updates": {f"{table}.{column}": 0 for table, column in REF_COLUMNS},
    }
    timestamp = datetime.now(timezone.utc).isoformat()
    for row in mapping:
        old_id = row["old_staff_id"]
        new_id = row["new_staff_id"]
        if old_id == new_id:
            continue
        staff = staff_rows_by_id[old_id]
        original_unique_values = {
            "employee_no": staff.get("employee_no"),
            "email": staff.get("email"),
            "notion_id": staff.get("notion_id"),
        }

        # Free unique columns on the old row so the new normalized row can be inserted
        # while FK references still point to the old row.
        client.table("staff").update(
            {
                "employee_no": None,
                "email": None,
                "notion_id": None,
            }
        ).eq("staff_id", old_id).execute()

        new_staff = dict(staff)
        new_staff["staff_id"] = new_id
        metadata = staff.get("metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {"legacy_metadata": metadata}
        else:
            metadata = dict(metadata)
        new_staff["metadata"] = {
            **metadata,
            "old_staff_id": old_id,
            "staff_id_normalized_at": timestamp,
        }
        try:
            client.table("staff").insert(new_staff).execute()
            stats["staff_rows_inserted"] += 1
        except Exception:
            client.table("staff").update(original_unique_values).eq("staff_id", old_id).execute()
            raise

        for table, column in REF_COLUMNS:
            result = client.table(table).update({column: new_id}).eq(column, old_id).execute().data or []
            stats["ref_updates"][f"{table}.{column}"] += len(result)

        try:
            client.table("staff").delete().eq("staff_id", old_id).execute()
            stats["old_staff_rows_deleted"] += 1
        except Exception:
            # At this point the normalized row exists and known references have moved.
            # Keep the old row with cleared unique columns so it cannot conflict, then fail loudly.
            raise
    return stats


def orphan_report(client):
    staff_ids = {row["staff_id"] for row in fetch_all(client, "staff", "staff_id") if row.get("staff_id")}
    report = {}
    for table, column in REF_COLUMNS:
        rows = fetch_all(client, table, column)
        orphans = sorted({row.get(column) for row in rows if row.get(column) and row.get(column) not in staff_ids})
        report[f"{table}.{column}"] = {"orphan_unique_refs": len(orphans), "sample": orphans[:20]}
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])

    staff_rows = fetch_all(client, "staff", "*")
    staff_rows_by_id = {row["staff_id"]: row for row in staff_rows}
    mapping = build_mapping(staff_rows)
    errors = validate_mapping(mapping)
    refs_before = reference_snapshot(client)
    counts_before = count_refs_by_old_id(client, [row["old_staff_id"] for row in mapping])

    backup_path = write_backup(
        {
            "staff_rows": staff_rows,
            "mapping": mapping,
            "refs_before": refs_before,
            "counts_before": counts_before,
            "validation_errors": errors,
        }
    )

    summary = {
        "staff_total": len(staff_rows),
        "will_change": sum(1 for row in mapping if row["old_staff_id"] != row["new_staff_id"]),
        "employee_id_targets": sum(1 for row in mapping if row["new_staff_id"].startswith("staff_") and not row["new_staff_id"].startswith("staff_ext_")),
        "external_id_targets": sum(1 for row in mapping if row["new_staff_id"].startswith("staff_ext_")),
        "counts_before": counts_before,
        "validation_errors": errors,
        "backup_path": str(backup_path),
        "sample_mapping": mapping[:12],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit("Mapping validation failed.")
    if not args.apply:
        print("DRY_RUN only. Re-run with --apply to update staff IDs.")
        return

    ordered_mapping = order_mapping_for_apply(mapping, refs_before)
    result = migrate_staff_rows(client, staff_rows_by_id, ordered_mapping)
    orphans = orphan_report(client)
    if any(item["orphan_unique_refs"] for item in orphans.values()):
        print(json.dumps({"result": result, "orphans": orphans}, ensure_ascii=False, indent=2))
        raise SystemExit("Orphan references detected after update. Check backup and repair immediately.")

    print("APPLIED")
    print(json.dumps({"result": result, "orphans": orphans}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
