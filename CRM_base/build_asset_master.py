import argparse
import ast
import csv
import hashlib
import json
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from supabase import create_client


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
OUTPUT_DIR = BASE_DIR / "output"


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


def try_fetch_all(client, table, select="*"):
    try:
        return fetch_all(client, table, select)
    except Exception as exc:
        print(f"Skipping {table}: {exc}")
        return []


def clean_text(value):
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ").strip()
    if text.lower() in {"", "-", "null", "none", "nan", "undefined"}:
        return ""
    return text


def clean_num(value):
    if value in (None, "", "-"):
        return None
    try:
        if isinstance(value, str):
            value = value.replace(",", "").replace("%", "").strip()
        return float(value)
    except (TypeError, ValueError):
        return None


def clean_int(value):
    num = clean_num(value)
    if num is None:
        return None
    return int(round(num))


def clean_date(value):
    text = clean_text(value)
    if not text:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return text
    return None


def normalize_text(value):
    text = clean_text(value).lower()
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"\[[^\]]*\]", " ", text)
    text = re.sub(r"[^0-9a-z가-힣]+", "", text)
    stopwords = [
        "이지스",
        "일반사모",
        "부동산투자신탁",
        "집합투자기구",
        "운용",
        "자산관리",
        "제",
    ]
    for word in stopwords:
        text = text.replace(word, "")
    return text


def first_value(rows, key):
    for row in rows:
        value = clean_text(row.get(key))
        if value:
            return value
    return None


def best_name(names):
    cleaned = [clean_text(name) for name in names if clean_text(name)]
    if not cleaned:
        return "Unnamed Asset"
    counts = Counter(cleaned)
    return sorted(counts, key=lambda name: (-counts[name], -len(name), name))[0]


def asset_source_id(asset):
    return clean_text(asset.get("id")) or f"{clean_text(asset.get('fund_id'))}:{clean_text(asset.get('asset_name'))}"


def source_key_for_asset(asset):
    metadata = asset.get("metadata") or {}
    pnu = clean_text(metadata.get("pnu") or asset.get("pnu"))
    asset_code = clean_text(metadata.get("asset_code") or asset.get("asset_code"))
    address = clean_text(asset.get("address") or metadata.get("address"))
    name = clean_text(asset.get("asset_name"))
    if pnu:
        return "pnu", pnu
    if asset_code:
        return "asset_code", asset_code
    if address:
        return "address", normalize_text(address)
    return "name", normalize_text(name or asset.get("fund_id"))


def make_asset_id(group_key):
    digest = hashlib.sha1(group_key.encode("utf-8")).hexdigest()[:12]
    return f"ast_{digest}"


def row_completeness(asset):
    score = 0
    for key in ("asset_name", "address", "lat", "lng", "site_area", "gfa", "gross_floor_area"):
        if asset.get(key):
            score += 1
    metadata = asset.get("metadata") or {}
    for key in ("pnu", "asset_code"):
        if metadata.get(key):
            score += 2
    return score


def parse_building_ledger(value):
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, str):
                text = parsed
        except json.JSONDecodeError:
            pass
        try:
            parsed = ast.literal_eval(text)
            return parsed if isinstance(parsed, dict) else {}
        except (SyntaxError, ValueError):
            return {}
    return {}


def physical_detail_from_asset(asset):
    metadata = asset.get("metadata") or {}
    ledger = parse_building_ledger(metadata.get("building_ledger"))
    return {
        "pnu": clean_text(metadata.get("pnu") or ledger.get("pnu")) or None,
        "site_area": clean_num(asset.get("site_area")) or clean_num(ledger.get("site_area")),
        "gross_floor_area": clean_num(asset.get("gross_floor_area")) or clean_num(asset.get("gfa")) or clean_num(ledger.get("gfa")),
        "scr": clean_num(asset.get("scr")) or clean_num(ledger.get("scr")),
        "far": clean_num(asset.get("far")) or clean_num(ledger.get("far")),
        "main_usage": clean_text(asset.get("main_usage") or ledger.get("main_usage")) or None,
        "structure": clean_text(asset.get("structure") or ledger.get("structure")) or None,
        "floors_up": clean_int(asset.get("floors_up")) or clean_int(ledger.get("floors_up")),
        "floors_down": clean_int(asset.get("floors_down")) or clean_int(ledger.get("floors_down")),
        "elevators": clean_int(asset.get("elevators")) or clean_int(ledger.get("elevators")),
        "parking": clean_text(asset.get("parking") or ledger.get("parking")) or None,
        "height": clean_num(asset.get("height")) or clean_num(ledger.get("height")),
        "completion_date": clean_date(asset.get("completion_date")) or clean_date(ledger.get("completion_date")),
        "raw_ledger": ledger,
        "building_ledger_source": clean_text(metadata.get("building_ledger_source")) or ("building_ledger" if ledger else None),
    }


def add_unique(target, seen, row, unique_key):
    key = tuple(row.get(col) for col in unique_key)
    if key in seen:
        return
    seen.add(key)
    target.append(row)


def build_asset_model(funds, fund_assets, projects):
    funds_by_id = {clean_text(row.get("fund_id")): row for row in funds if clean_text(row.get("fund_id"))}
    directly_linked_fund_ids = set()
    groups = defaultdict(list)
    for asset in fund_assets:
        key_type, key_value = source_key_for_asset(asset)
        groups[f"{key_type}:{key_value}"].append(asset)

    asset_master = []
    identifiers = []
    aliases = []
    fund_links = []
    project_links = []
    review_rows = []
    building_ledgers = []
    seen_identifiers = set()
    seen_aliases = set()
    seen_fund_links = set()
    seen_project_links = set()

    for group_key in sorted(groups):
        rows = groups[group_key]
        asset_id = make_asset_id(group_key)
        representative = sorted(rows, key=row_completeness, reverse=True)[0]
        metadata = representative.get("metadata") or {}
        fund_ids = sorted({clean_text(row.get("fund_id")) for row in rows if clean_text(row.get("fund_id"))})
        fund_names = [funds_by_id.get(fid, {}).get("fund_name") for fid in fund_ids]
        source_names = [row.get("asset_name") for row in rows] + fund_names
        canonical_name = best_name(source_names)
        address = first_value(rows, "address") or clean_text(metadata.get("address")) or None
        pnu = first_value([row.get("metadata") or {} for row in rows], "pnu")
        asset_code = first_value([row.get("metadata") or {} for row in rows], "asset_code")
        physical = physical_detail_from_asset(representative)

        confidence = 0.45
        reason = "name_only"
        if group_key.startswith("pnu:"):
            confidence = 0.98
            reason = "same_pnu"
        elif group_key.startswith("asset_code:"):
            confidence = 0.94
            reason = "same_asset_code"
        elif group_key.startswith("address:"):
            confidence = 0.88
            reason = "same_address"

        asset_master.append(
            {
                "asset_id": asset_id,
                "canonical_name": canonical_name,
                "asset_type": first_value(rows, "asset_type"),
                "country_code": "KR" if pnu or (address and "서울" in address) else None,
                "city": clean_text(metadata.get("managed_investment_city")) or None,
                "address_text": address,
                "latitude": representative.get("lat"),
                "longitude": representative.get("lng"),
                "pnu": pnu,
                "asset_code": asset_code,
                "site_area": physical["site_area"],
                "gross_floor_area": physical["gross_floor_area"],
                "scr": physical["scr"],
                "far": physical["far"],
                "main_usage": physical["main_usage"],
                "structure": physical["structure"],
                "floors_up": physical["floors_up"],
                "floors_down": physical["floors_down"],
                "elevators": physical["elevators"],
                "parking": physical["parking"],
                "height": physical["height"],
                "completion_date": physical["completion_date"],
                "geocode_source": "geocoding_cache" if representative.get("lat") and representative.get("lng") else None,
                "building_ledger_source": physical["building_ledger_source"],
                "source_confidence": confidence,
                "review_status": "auto_created" if confidence >= 0.88 else "needs_review",
                "representative_source": "fund_assets",
                "representative_fund_id": clean_text(representative.get("fund_id")) or None,
                "metadata": {
                    "source_group_key": group_key,
                    "match_reason": reason,
                    "source_row_count": len(rows),
                    "fund_ids": fund_ids,
                    "built_at": datetime.now(timezone.utc).isoformat(),
                },
            }
        )

        if physical["raw_ledger"]:
            building_ledgers.append(
                {
                    "asset_id": asset_id,
                    "pnu": physical["pnu"],
                    "site_area": physical["site_area"],
                    "gross_floor_area": physical["gross_floor_area"],
                    "scr": physical["scr"],
                    "far": physical["far"],
                    "main_usage": physical["main_usage"],
                    "structure": physical["structure"],
                    "floors_up": physical["floors_up"],
                    "floors_down": physical["floors_down"],
                    "elevators": physical["elevators"],
                    "parking": physical["parking"],
                    "height": physical["height"],
                    "completion_date": physical["completion_date"],
                    "raw_ledger": physical["raw_ledger"],
                    "source_table": "fund_assets",
                    "source_id": asset_source_id(representative),
                    "confidence": 0.95,
                }
            )

        for row in rows:
            source_id = asset_source_id(row)
            row_meta = row.get("metadata") or {}
            for id_type, id_value, primary in [
                ("pnu", clean_text(row_meta.get("pnu") or row.get("pnu")), group_key.startswith("pnu:")),
                ("asset_code", clean_text(row_meta.get("asset_code") or row.get("asset_code")), group_key.startswith("asset_code:")),
                ("fund_asset_source_id", source_id, False),
            ]:
                if id_value:
                    add_unique(
                        identifiers,
                        seen_identifiers,
                        {
                            "asset_id": asset_id,
                            "identifier_type": id_type,
                            "identifier_value": id_value,
                            "source_table": "fund_assets",
                            "source_id": source_id,
                            "is_primary": primary,
                            "confidence": confidence,
                            "metadata": {},
                        },
                        ("asset_id", "identifier_type", "identifier_value"),
                    )

            for alias_name, alias_type in [
                (row.get("asset_name"), "asset_name"),
                (row.get("address"), "address"),
                (row_meta.get("fund_name"), "fund_name"),
                (row_meta.get("fund_short_name"), "fund_short_name"),
            ]:
                alias_name = clean_text(alias_name)
                if alias_name:
                    add_unique(
                        aliases,
                        seen_aliases,
                        {
                            "asset_id": asset_id,
                            "alias_name": alias_name,
                            "alias_type": alias_type,
                            "source_table": "fund_assets",
                            "source_id": source_id,
                            "confidence": confidence,
                            "is_primary": alias_name == canonical_name,
                        },
                        ("asset_id", "alias_name", "alias_type"),
                    )

            fund_id = clean_text(row.get("fund_id"))
            if fund_id:
                directly_linked_fund_ids.add(fund_id)
                add_unique(
                    fund_links,
                    seen_fund_links,
                    {
                        "asset_id": asset_id,
                        "fund_id": fund_id,
                        "relation_type": "underlying_asset",
                        "source_table": "fund_assets",
                        "source_id": source_id,
                        "confidence": confidence,
                        "metadata": {"match_reason": reason},
                    },
                    ("asset_id", "fund_id", "relation_type"),
                )

        for fund_id in fund_ids:
            fund = funds_by_id.get(fund_id) or {}
            for alias_name, alias_type in [
                (fund.get("project_mission_name"), "project_mission_name"),
                (fund.get("asset_name"), "fund_asset_name"),
                (fund.get("short_name"), "fund_short_name"),
            ]:
                alias_name = clean_text(alias_name)
                if alias_name:
                    add_unique(
                        aliases,
                        seen_aliases,
                        {
                            "asset_id": asset_id,
                            "alias_name": alias_name,
                            "alias_type": alias_type,
                            "source_table": "funds",
                            "source_id": fund_id,
                            "confidence": min(confidence, 0.9),
                            "is_primary": alias_name == canonical_name,
                        },
                        ("asset_id", "alias_name", "alias_type"),
                    )

        if confidence < 0.88 or len({normalize_text(row.get("asset_name")) for row in rows if row.get("asset_name")}) > 1:
            review_rows.append(
                {
                    "asset_id": asset_id,
                    "review_reason": "low_confidence_or_name_variation",
                    "current_value": {
                        "canonical_name": canonical_name,
                        "group_key": group_key,
                        "asset_names": sorted({clean_text(row.get("asset_name")) for row in rows if clean_text(row.get("asset_name"))}),
                        "addresses": sorted({clean_text(row.get("address")) for row in rows if clean_text(row.get("address"))}),
                        "fund_ids": fund_ids,
                    },
                    "suggested_action": "verify_merge_or_split",
                    "review_status": "needs_review",
                }
            )

    # Link funds without direct fund_assets by asset/project name similarity conservatively.
    all_aliases_by_asset = defaultdict(list)
    for alias in aliases:
        all_aliases_by_asset[alias["asset_id"]].append(alias["alias_name"])

    def best_asset_match(name):
        norm_name = normalize_text(name)
        if len(norm_name) < 4:
            return None
        best = None
        for asset in asset_master:
            candidates = [asset["canonical_name"]] + all_aliases_by_asset[asset["asset_id"]]
            for candidate in candidates:
                norm_candidate = normalize_text(candidate)
                if not norm_candidate:
                    continue
                score = 0
                if norm_candidate == norm_name:
                    score = 0.95
                elif norm_candidate in norm_name or norm_name in norm_candidate:
                    score = 0.82
                if score and (best is None or score > best["score"]):
                    best = {"asset_id": asset["asset_id"], "score": score, "candidate": candidate}
        return best

    for fund in funds:
        fund_id = clean_text(fund.get("fund_id"))
        if not fund_id or fund_id in directly_linked_fund_ids:
            continue
        names = [
            clean_text(fund.get("asset_name")),
            clean_text(fund.get("project_mission_name")),
            clean_text(fund.get("fund_name")),
            clean_text(fund.get("short_name")),
        ]
        best = None
        for name in [item for item in names if item]:
            match = best_asset_match(name)
            if match and (best is None or match["score"] > best["score"]):
                best = {**match, "name": name}
        if best and best["score"] >= 0.82:
            add_unique(
                fund_links,
                seen_fund_links,
                {
                    "asset_id": best["asset_id"],
                    "fund_id": fund_id,
                    "relation_type": "inferred_underlying_asset",
                    "source_table": "funds",
                    "source_id": fund_id,
                    "confidence": best["score"],
                    "metadata": {"matched_name": best["name"], "matched_candidate": best["candidate"]},
                },
                ("asset_id", "fund_id", "relation_type"),
            )
            for alias_name, alias_type in [
                (fund.get("asset_name"), "inferred_fund_asset_name"),
                (fund.get("project_mission_name"), "inferred_project_mission_name"),
                (fund.get("fund_name"), "inferred_fund_name"),
                (fund.get("short_name"), "inferred_fund_short_name"),
            ]:
                alias_name = clean_text(alias_name)
                if alias_name:
                    add_unique(
                        aliases,
                        seen_aliases,
                        {
                            "asset_id": best["asset_id"],
                            "alias_name": alias_name,
                            "alias_type": alias_type,
                            "source_table": "funds",
                            "source_id": fund_id,
                            "confidence": best["score"],
                            "is_primary": False,
                        },
                        ("asset_id", "alias_name", "alias_type"),
                    )

    all_aliases_by_asset = defaultdict(list)
    for alias in aliases:
        all_aliases_by_asset[alias["asset_id"]].append(alias["alias_name"])

    project_like_rows = list(projects or []) + [row for row in funds if clean_text(row.get("project_mission_name"))]
    for project in project_like_rows:
        project_id = clean_text(project.get("project_id") or project.get("proj_id") or project.get("fund_id"))
        project_name = clean_text(project.get("project_mission_name") or project.get("project_name") or project.get("name"))
        if not project_id or not project_name:
            continue
        norm_project = normalize_text(project_name)
        if len(norm_project) < 4:
            continue
        best = best_asset_match(project_name)
        if best and best["score"] >= 0.82:
            add_unique(
                project_links,
                seen_project_links,
                {
                    "asset_id": best["asset_id"],
                    "project_id": project_id,
                    "relation_type": "related_project",
                    "source_table": "projects" if projects else "funds",
                    "source_id": project_id,
                    "confidence": best["score"],
                    "metadata": {"project_name": project_name},
                },
                ("asset_id", "project_id", "relation_type"),
            )

    return {
        "asset_master": asset_master,
        "asset_identifiers": identifiers,
        "asset_aliases": aliases,
        "asset_fund_links": fund_links,
        "asset_project_links": project_links,
        "asset_review_queue": review_rows,
        "asset_building_ledger": building_ledgers,
    }


def write_csv(path, rows, fieldnames):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key) for key in fieldnames})


def write_outputs(model):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    preview_rows = []
    for row in model["asset_master"]:
        metadata = row.get("metadata") or {}
        preview_rows.append(
            {
                "asset_id": row["asset_id"],
                "canonical_name": row["canonical_name"],
                "review_status": row["review_status"],
                "source_confidence": row["source_confidence"],
                "match_reason": metadata.get("match_reason"),
                "source_row_count": metadata.get("source_row_count"),
                "fund_ids": ", ".join(metadata.get("fund_ids") or []),
                "address_text": row.get("address_text"),
                "pnu": row.get("pnu"),
                "asset_code": row.get("asset_code"),
                "latitude": row.get("latitude"),
                "longitude": row.get("longitude"),
                "site_area": row.get("site_area"),
                "gross_floor_area": row.get("gross_floor_area"),
                "main_usage": row.get("main_usage"),
                "structure": row.get("structure"),
            }
        )
    write_csv(
        OUTPUT_DIR / "asset_master_preview.csv",
        preview_rows,
        [
            "asset_id",
            "canonical_name",
            "review_status",
            "source_confidence",
            "match_reason",
            "source_row_count",
            "fund_ids",
            "address_text",
            "pnu",
            "asset_code",
            "latitude",
            "longitude",
            "site_area",
            "gross_floor_area",
            "main_usage",
            "structure",
        ],
    )

    manual_rows = []
    for row in model["asset_review_queue"]:
        current = row["current_value"]
        manual_rows.append(
            {
                "asset_id": row["asset_id"],
                "review_reason": row["review_reason"],
                "suggested_action": row["suggested_action"],
                "current_canonical_name": current.get("canonical_name"),
                "source_group_key": current.get("group_key"),
                "source_asset_names": " | ".join(current.get("asset_names") or []),
                "source_addresses": " | ".join(current.get("addresses") or []),
                "source_fund_ids": ", ".join(current.get("fund_ids") or []),
                "manual_decision": "",
                "manual_asset_id": "",
                "manual_canonical_name": "",
                "split_group_key": "",
                "merge_target_asset_id": "",
                "verified_by": "",
                "verified_at": "",
                "review_note": "",
            }
        )
    write_csv(
        OUTPUT_DIR / "asset_master_manual_review.csv",
        manual_rows,
        [
            "asset_id",
            "review_reason",
            "suggested_action",
            "current_canonical_name",
            "source_group_key",
            "source_asset_names",
            "source_addresses",
            "source_fund_ids",
            "manual_decision",
            "manual_asset_id",
            "manual_canonical_name",
            "split_group_key",
            "merge_target_asset_id",
            "verified_by",
            "verified_at",
            "review_note",
        ],
    )

    for table_name, rows in model.items():
        (OUTPUT_DIR / f"{table_name}.json").write_text(
            json.dumps(rows, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )


def delete_all(client, table, key_col):
    while True:
        rows = client.table(table).select(key_col).limit(500).execute().data or []
        keys = [row[key_col] for row in rows if row.get(key_col) is not None]
        if not keys:
            return
        client.table(table).delete().in_(key_col, keys).execute()


def insert_rows(client, table, rows, batch_size=500):
    for start in range(0, len(rows), batch_size):
        chunk = rows[start : start + batch_size]
        if chunk:
            client.table(table).insert(chunk).execute()


def apply_model(client, model):
    for table, key_col in [
        ("asset_review_queue", "review_id"),
        ("asset_building_ledger", "asset_id"),
        ("asset_project_links", "asset_id"),
        ("asset_fund_links", "asset_id"),
        ("asset_aliases", "id"),
        ("asset_identifiers", "id"),
        ("asset_master", "asset_id"),
    ]:
        delete_all(client, table, key_col)
    for table in [
        "asset_master",
        "asset_identifiers",
        "asset_aliases",
        "asset_fund_links",
        "asset_project_links",
        "asset_review_queue",
        "asset_building_ledger",
    ]:
        insert_rows(client, table, model[table])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Insert generated asset master data into Supabase tables.")
    args = parser.parse_args()

    env = load_env()
    client = create_client(env["SUPABASE_URL"], env["SUPABASE_KEY"])

    funds = fetch_all(client, "funds", "*")
    fund_assets = fetch_all(client, "fund_assets", "*")
    projects = try_fetch_all(client, "projects", "*")
    model = build_asset_model(funds, fund_assets, projects)
    write_outputs(model)

    summary = {
        "funds": len(funds),
        "fund_assets": len(fund_assets),
        "projects": len(projects),
        "asset_master": len(model["asset_master"]),
        "asset_identifiers": len(model["asset_identifiers"]),
        "asset_aliases": len(model["asset_aliases"]),
        "asset_fund_links": len(model["asset_fund_links"]),
        "asset_project_links": len(model["asset_project_links"]),
        "manual_review_rows": len(model["asset_review_queue"]),
        "asset_building_ledger": len(model["asset_building_ledger"]),
        "output_dir": str(OUTPUT_DIR),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if args.apply:
        apply_model(client, model)
        print("APPLIED")
    else:
        print("DRY_RUN only. Run the migration SQL first, then re-run with --apply.")


if __name__ == "__main__":
    main()
