"""Merge duplicate project master rows into project mission rows.

The canonical row is t5t_project_mission. Matching uses normalized
project_name + primary_asset_id. Master metadata is copied into the mission
row before duplicate master project links and master rows are removed.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from supabase import create_client


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "01. RA Portal" / "output" / "project_master_merge"


def load_env() -> dict[str, str]:
    env_path = ROOT / ".env"
    env: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def normalize(value: Any) -> str:
    return re.sub(r"[\s\[\]\(\){}·ㆍ_\-]+", "", str(value or "").lower())


def fetch_all(client: Any, table: str, select: str = "*") -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        response = client.table(table).select(select).range(start, start + 999).execute()
        batch = response.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        start += 1000
    return rows


def chunked(values: list[Any], size: int = 50) -> list[list[Any]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def mission_payload(master: dict[str, Any], mission: dict[str, Any]) -> dict[str, Any]:
    master_meta = master.get("metadata") or {}
    mission_meta = mission.get("metadata") or {}
    merged_meta = dict(mission_meta)
    merged_meta["master_project"] = {
        "project_id": master.get("project_id"),
        "notion_id": master.get("notion_id"),
        "project_code": master.get("project_code"),
        "project_name": master.get("project_name"),
        "status": master.get("status"),
        "priority": master.get("priority"),
        "health": master.get("health"),
        "lead_org_text": master.get("lead_org_text"),
        "lead_staff_id": master.get("lead_staff_id"),
        "parent_project_id": master.get("parent_project_id"),
        "start_date": master.get("start_date"),
        "target_date": master.get("target_date"),
        "next_check_date": master.get("next_check_date"),
        "metadata": master_meta,
        "merged_at": datetime.now(timezone.utc).isoformat(),
    }

    payload: dict[str, Any] = {"metadata": merged_meta}
    for field in [
        "project_code",
        "health",
        "lead_org_text",
        "lead_staff_id",
        "parent_project_id",
        "next_check_date",
    ]:
        if master.get(field) and not mission.get(field):
            payload[field] = master[field]

    for field in ["start_date", "target_date"]:
        if master.get(field) and not mission.get(field):
            payload[field] = master[field]

    return payload


def build_plan(client: Any) -> dict[str, Any]:
    projects = fetch_all(
        client,
        "projects",
        "project_id,notion_id,project_code,project_name,project_type,status,priority,health,"
        "lead_org_text,lead_staff_id,parent_project_id,start_date,target_date,next_check_date,"
        "source_system,metadata,created_at,updated_at,primary_asset_id",
    )
    links = fetch_all(client, "asset_project_links", "*")
    log_project_links = fetch_all(client, "t5t_log_project_links", "*")
    form_items = fetch_all(client, "t5t_form_items", "*")

    masters = [row for row in projects if row.get("source_system") == "t5t_project_master"]
    missions = [row for row in projects if row.get("source_system") == "t5t_project_mission"]
    mission_by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in missions:
        key = (normalize(row.get("project_name")), row.get("primary_asset_id") or "")
        mission_by_key.setdefault(key, []).append(row)

    mappings: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    for master in masters:
        key = (normalize(master.get("project_name")), master.get("primary_asset_id") or "")
        candidates = mission_by_key.get(key, [])
        if len(candidates) == 1:
            mission = candidates[0]
            mappings.append(
                {
                    "master": master,
                    "mission": mission,
                    "payload": mission_payload(master, mission),
                }
            )
        elif not candidates:
            missing.append(master)
        else:
            ambiguous.append({"master": master, "candidates": candidates})

    master_to_mission = {
        item["master"]["project_id"]: item["mission"]["project_id"] for item in mappings
    }
    existing_link_keys = {
        (row.get("asset_id"), row.get("project_id"), row.get("relation_type")) for row in links
    }
    duplicate_master_links = []
    unsafe_link_updates = []
    for row in links:
        mission_id = master_to_mission.get(row.get("project_id"))
        if not mission_id:
            continue
        target_key = (row.get("asset_id"), mission_id, row.get("relation_type"))
        if target_key in existing_link_keys:
            duplicate_master_links.append(row)
        else:
            unsafe_link_updates.append({"link": row, "mission_project_id": mission_id})

    existing_log_link_keys = {
        (row.get("t5t_log_id"), row.get("project_id"), row.get("relation_type"))
        for row in log_project_links
    }
    log_link_updates = []
    duplicate_log_links = []
    for row in log_project_links:
        mission_id = master_to_mission.get(row.get("project_id"))
        if not mission_id:
            continue
        target_key = (row.get("t5t_log_id"), mission_id, row.get("relation_type"))
        if target_key in existing_log_link_keys:
            duplicate_log_links.append(row)
        else:
            log_link_updates.append({"link": row, "mission_project_id": mission_id})

    form_item_updates = []
    for row in form_items:
        mission_id = master_to_mission.get(row.get("matched_project_id"))
        if mission_id:
            form_item_updates.append({"form_item": row, "mission_project_id": mission_id})

    return {
        "projects": projects,
        "asset_project_links": links,
        "t5t_log_project_links": log_project_links,
        "t5t_form_items": form_items,
        "mappings": mappings,
        "missing": missing,
        "ambiguous": ambiguous,
        "duplicate_master_links": duplicate_master_links,
        "unsafe_link_updates": unsafe_link_updates,
        "log_link_updates": log_link_updates,
        "duplicate_log_links": duplicate_log_links,
        "form_item_updates": form_item_updates,
    }


def write_artifacts(plan: dict[str, Any], stamp: str) -> dict[str, Path]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = OUTPUT_DIR / f"project_master_merge_backup_{stamp}.json"
    plan_path = OUTPUT_DIR / f"project_master_merge_plan_{stamp}.csv"
    summary_path = OUTPUT_DIR / f"project_master_merge_summary_{stamp}.json"

    backup = {
        "mappings": [
            {
                "master": item["master"],
                "mission": item["mission"],
                "payload": item["payload"],
            }
            for item in plan["mappings"]
        ],
        "duplicate_master_links": plan["duplicate_master_links"],
        "unsafe_link_updates": plan["unsafe_link_updates"],
        "log_link_updates": plan["log_link_updates"],
        "duplicate_log_links": plan["duplicate_log_links"],
        "form_item_updates": plan["form_item_updates"],
        "missing": plan["missing"],
        "ambiguous": plan["ambiguous"],
    }
    backup_path.write_text(json.dumps(backup, ensure_ascii=False, indent=2), encoding="utf-8")

    with plan_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "project_name",
                "primary_asset_id",
                "master_project_id",
                "master_project_code",
                "mission_project_id",
                "mission_project_code_before",
                "mission_project_code_after",
                "payload_fields",
            ],
        )
        writer.writeheader()
        for item in plan["mappings"]:
            payload = item["payload"]
            writer.writerow(
                {
                    "project_name": item["master"].get("project_name"),
                    "primary_asset_id": item["master"].get("primary_asset_id"),
                    "master_project_id": item["master"].get("project_id"),
                    "master_project_code": item["master"].get("project_code"),
                    "mission_project_id": item["mission"].get("project_id"),
                    "mission_project_code_before": item["mission"].get("project_code"),
                    "mission_project_code_after": payload.get("project_code"),
                    "payload_fields": ",".join(payload.keys()),
                }
            )

    summary = {
        "mappings": len(plan["mappings"]),
        "missing": len(plan["missing"]),
        "ambiguous": len(plan["ambiguous"]),
        "duplicate_master_links_to_delete": len(plan["duplicate_master_links"]),
        "unsafe_link_updates": len(plan["unsafe_link_updates"]),
        "log_project_links_to_update": len(plan["log_link_updates"]),
        "duplicate_log_project_links_to_delete": len(plan["duplicate_log_links"]),
        "form_items_to_update": len(plan["form_item_updates"]),
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"backup": backup_path, "plan": plan_path, "summary": summary_path}


def apply_plan(client: Any, plan: dict[str, Any]) -> dict[str, int]:
    if plan["missing"] or plan["ambiguous"] or plan["unsafe_link_updates"]:
        raise RuntimeError("Plan is not safe to apply: missing, ambiguous, or update-only links exist.")

    updated_missions = 0
    for item in plan["mappings"]:
        project_id = item["mission"]["project_id"]
        payload = item["payload"]
        client.table("projects").update(payload).eq("project_id", project_id).execute()
        updated_missions += 1

    duplicate_project_ids = sorted(
        {row["project_id"] for row in plan["duplicate_master_links"] if row.get("project_id")}
    )
    deleted_links = 0
    for ids in chunked(duplicate_project_ids):
        response = client.table("asset_project_links").delete().in_("project_id", ids).execute()
        deleted_links += len(response.data or [])

    updated_log_links = 0
    for item in plan["log_link_updates"]:
        row = item["link"]
        metadata = dict(row.get("metadata") or {})
        metadata["merged_project_master"] = {
            "project_id": row.get("project_id"),
            "merged_at": datetime.now(timezone.utc).isoformat(),
        }
        client.table("t5t_log_project_links").update(
            {
                "project_id": item["mission_project_id"],
                "metadata": metadata,
            }
        ).eq("link_id", row["link_id"]).execute()
        updated_log_links += 1

    deleted_duplicate_log_links = 0
    duplicate_log_link_ids = sorted(
        {row["link_id"] for row in plan["duplicate_log_links"] if row.get("link_id")}
    )
    for ids in chunked(duplicate_log_link_ids):
        response = client.table("t5t_log_project_links").delete().in_("link_id", ids).execute()
        deleted_duplicate_log_links += len(response.data or [])

    updated_form_items = 0
    for item in plan["form_item_updates"]:
        row = item["form_item"]
        metadata = dict(row.get("metadata") or {})
        metadata["merged_project_master"] = {
            "matched_project_id": row.get("matched_project_id"),
            "merged_at": datetime.now(timezone.utc).isoformat(),
        }
        client.table("t5t_form_items").update(
            {
                "matched_project_id": item["mission_project_id"],
                "metadata": metadata,
            }
        ).eq("form_item_id", row["form_item_id"]).execute()
        updated_form_items += 1

    master_project_ids = sorted({item["master"]["project_id"] for item in plan["mappings"]})
    deleted_master_projects = 0
    for ids in chunked(master_project_ids):
        response = client.table("projects").delete().in_("project_id", ids).execute()
        deleted_master_projects += len(response.data or [])

    return {
        "updated_missions": updated_missions,
        "deleted_duplicate_master_links": deleted_links,
        "updated_log_project_links": updated_log_links,
        "deleted_duplicate_log_project_links": deleted_duplicate_log_links,
        "updated_form_items": updated_form_items,
        "deleted_master_projects": deleted_master_projects,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply the merge plan to Supabase.")
    args = parser.parse_args()

    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])
    plan = build_plan(client)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    paths = write_artifacts(plan, stamp)

    summary = json.loads(paths["summary"].read_text(encoding="utf-8"))
    print(json.dumps({"mode": "apply" if args.apply else "dry-run", **summary}, ensure_ascii=False, indent=2))
    print("backup:", paths["backup"])
    print("plan:", paths["plan"])
    print("summary:", paths["summary"])

    if args.apply:
        result = apply_plan(client, plan)
        print(json.dumps({"applied": result}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
