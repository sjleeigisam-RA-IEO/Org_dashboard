from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "01. RA Portal" / "output" / "relationship_index_20260609"


def clean(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return clean(value).lower() in {"true", "t", "1", "yes", "y"}


def stable_id(*parts: Any) -> str:
    text = "|".join(clean(part) for part in parts)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


def party_id(prefix: str, name: str) -> str:
    normalized = clean(name).lower()
    normalized = re.sub(r"[^0-9a-zA-Z가-힣]+", "_", normalized).strip("_")
    if not normalized:
        normalized = stable_id(prefix, name)
    return f"{prefix}_{normalized[:80]}"


def load_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def headers() -> dict[str, str]:
    key = os.environ["SUPABASE_KEY"]
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def rest_rows(table: str, columns: list[str], page_size: int = 1000) -> list[dict[str, Any]]:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        params = {
            "select": ",".join(columns),
            "limit": str(page_size),
            "offset": str(offset),
        }
        query = urllib.parse.urlencode(params, safe="*,.:()")
        req = urllib.request.Request(f"{base}/rest/v1/{table}?{query}", headers=headers())
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                batch = json.loads(response.read().decode("utf-8") or "[]")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"GET {table} failed: HTTP {exc.code} {detail}") from exc
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def rest_rows_safe(table: str, required_columns: list[str], optional_columns: list[str] | None = None) -> list[dict[str, Any]]:
    optional_columns = optional_columns or []
    try:
        return rest_rows(table, required_columns + optional_columns)
    except Exception:
        rows = rest_rows(table, required_columns)
        for row in rows:
            for column in optional_columns:
                row.setdefault(column, None)
        return rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def add_entity(
    entities: dict[str, dict[str, Any]],
    entity_type: str,
    entity_id: str,
    display_title: str,
    display_subtitle: str = "",
    source_table: str = "",
    source_id: str = "",
    confidence: float = 1.0,
    status: str = "confirmed",
    metadata: dict[str, Any] | None = None,
) -> None:
    if not clean(entity_id):
        return
    key = f"{entity_type}:{entity_id}"
    row = {
        "entity_key": key,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "display_title": clean(display_title) or entity_id,
        "display_subtitle": clean(display_subtitle),
        "source_table": source_table,
        "source_id": source_id,
        "confidence": confidence,
        "status": status,
        "metadata_json": json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True),
    }
    previous = entities.get(key)
    if previous is None or row["confidence"] > previous["confidence"]:
        entities[key] = row


def edge_row(
    edge_type: str,
    source_type: str,
    source_id: str,
    target_type: str,
    target_id: str,
    relation_type: str,
    link_method: str,
    source_table: str,
    source_id_value: str,
    confidence: float = 1.0,
    status: str = "confirmed",
    evidence: dict[str, Any] | None = None,
    include_in_search: bool = True,
    include_in_amount_rollup: bool | None = None,
) -> dict[str, Any] | None:
    if not clean(source_id) or not clean(target_id):
        return None
    edge_id = stable_id(edge_type, source_type, source_id, target_type, target_id, relation_type, source_table, source_id_value)
    return {
        "edge_id": edge_id,
        "edge_type": edge_type,
        "source_entity_type": source_type,
        "source_entity_id": source_id,
        "target_entity_type": target_type,
        "target_entity_id": target_id,
        "relation_type": clean(relation_type),
        "link_method": link_method,
        "source_table": source_table,
        "source_id": clean(source_id_value),
        "confidence": confidence,
        "status": status,
        "include_in_search": include_in_search,
        "include_in_amount_rollup": False if include_in_amount_rollup is None else include_in_amount_rollup,
        "evidence_json": json.dumps(evidence or {}, ensure_ascii=False, sort_keys=True),
    }


def token_row(
    entity_type: str,
    entity_id: str,
    display_title: str,
    token_text: str,
    token_type: str,
    rank_weight: int,
    related_asset_id: str = "",
    related_fund_id: str = "",
    related_project_id: str = "",
    source_table: str = "",
    relation_path: str = "",
) -> dict[str, Any] | None:
    if not clean(entity_id) or not clean(token_text):
        return None
    return {
        "entity_key": f"{entity_type}:{entity_id}",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "display_title": clean(display_title) or entity_id,
        "token_text": clean(token_text),
        "token_type": token_type,
        "rank_weight": rank_weight,
        "related_asset_id": clean(related_asset_id),
        "related_fund_id": clean(related_fund_id),
        "related_project_id": clean(related_project_id),
        "source_table": source_table,
        "relation_path": relation_path,
    }


def first_present(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = clean(row.get(key))
        if value:
            return value
    return ""


def build() -> dict[str, Any]:
    load_env()
    funds = rest_rows(
        "v_funds_enriched",
        ["fund_id", "fund_name", "short_name", "status", "sector", "project_mission_name", "asset_name", "fund_type", "division", "primary_region"],
    )
    assets = rest_rows_safe(
        "asset_master",
        [
            "asset_id",
            "asset_code",
            "canonical_name",
            "address_text",
            "pnu",
            "review_status",
            "asset_type",
            "asset_kind",
            "main_usage",
            "portfolio_region",
            "business_stage",
        ],
        [
            "physical_asset_name",
            "non_physical_asset_label",
            "asset_name_cleanup_action",
        ],
    )
    aliases = rest_rows("asset_aliases", ["asset_id", "alias_name", "alias_type", "confidence"])
    asset_fund_links = rest_rows_safe(
        "asset_fund_links",
        ["asset_id", "fund_id", "relation_type", "include_in_asset_aum", "allocation_status", "allocation_ratio", "needs_allocation_review", "source_table", "source_id", "confidence"],
        [],
    )
    projects = rest_rows("projects", ["project_id", "project_name", "project_code", "parent_project_id", "primary_asset_id", "project_type", "status"])
    asset_project_links = rest_rows("asset_project_links", ["asset_id", "project_id", "relation_type", "source_table", "source_id", "confidence"])
    lenders = rest_rows("lender_exposures", ["id", "asset_id", "fund_id", "lender_clean", "lender_raw", "committed_amt", "drawn_amt"])
    beneficiaries = rest_rows("beneficiary_exposures", ["id", "asset_id", "fund_id", "beneficiary_clean", "beneficiary_raw", "committed_amt", "invested_amt"])

    funds_by_id = {clean(row.get("fund_id")): row for row in funds if clean(row.get("fund_id"))}
    assets_by_id = {clean(row.get("asset_id")): row for row in assets if clean(row.get("asset_id"))}
    projects_by_id = {clean(row.get("project_id")): row for row in projects if clean(row.get("project_id"))}

    fund_assets: dict[str, set[str]] = defaultdict(set)
    asset_funds: dict[str, set[str]] = defaultdict(set)
    for row in asset_fund_links:
        fund_id = clean(row.get("fund_id"))
        asset_id = clean(row.get("asset_id"))
        if fund_id and asset_id:
            fund_assets[fund_id].add(asset_id)
            asset_funds[asset_id].add(fund_id)

    entities: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []
    tokens: list[dict[str, Any]] = []
    audit_rows: list[dict[str, Any]] = []

    for fund_id, row in funds_by_id.items():
        title = first_present(row, "short_name", "fund_name", "fund_id")
        subtitle = " | ".join(part for part in [clean(row.get("fund_name")), clean(row.get("status")), clean(row.get("sector"))] if part)
        add_entity(entities, "fund", fund_id, title, subtitle, "v_funds_enriched", fund_id)
        for token_text, token_type, weight in [
            (row.get("fund_id"), "fund_id", 100),
            (row.get("short_name"), "fund_short_name", 95),
            (row.get("fund_name"), "fund_name", 90),
            (row.get("project_mission_name"), "project_mission_name", 65),
            (row.get("asset_name"), "source_aggregate_asset_name", 45),
            (row.get("fund_type"), "fund_type", 35),
            (row.get("division"), "division", 30),
            (row.get("primary_region"), "primary_region", 30),
        ]:
            item = token_row("fund", fund_id, title, token_text, token_type, weight, related_fund_id=fund_id, source_table="v_funds_enriched", relation_path="fund:self")
            if item:
                tokens.append(item)

    for asset_id, row in assets_by_id.items():
        title = first_present(row, "physical_asset_name", "non_physical_asset_label", "asset_code", "asset_id")
        subtitle = " | ".join(part for part in [clean(row.get("asset_code")), clean(row.get("address_text")), clean(row.get("review_status"))] if part)
        add_entity(
            entities,
            "asset",
            asset_id,
            title,
            subtitle,
            "asset_master",
            asset_id,
            metadata={"cleanup_action": row.get("asset_name_cleanup_action"), "source_canonical_name": row.get("canonical_name")},
        )
        for token_text, token_type, weight in [
            (title, "asset_display_title", 100),
            (row.get("asset_code"), "asset_code", 95),
            (row.get("address_text"), "address", 65),
            (row.get("pnu"), "pnu", 85),
            (row.get("main_usage"), "main_usage", 30),
            (row.get("asset_type"), "asset_type", 30),
            (row.get("portfolio_region"), "portfolio_region", 30),
            (row.get("business_stage"), "business_stage", 30),
        ]:
            item = token_row("asset", asset_id, title, token_text, token_type, weight, related_asset_id=asset_id, source_table="asset_master", relation_path="asset:self")
            if item:
                tokens.append(item)

    for row in aliases:
        asset_id = clean(row.get("asset_id"))
        asset = assets_by_id.get(asset_id, {})
        title = first_present(asset, "physical_asset_name", "non_physical_asset_label", "asset_code", "asset_id") or asset_id
        item = token_row(
            "asset",
            asset_id,
            title,
            row.get("alias_name"),
            f"asset_alias:{clean(row.get('alias_type')) or 'alias'}",
            max(35, int(float(row.get("confidence") or 0.7) * 100)),
            related_asset_id=asset_id,
            source_table="asset_aliases",
            relation_path="asset:alias",
        )
        if item:
            tokens.append(item)

    for project_id, row in projects_by_id.items():
        title = first_present(row, "project_name", "project_code", "project_id")
        subtitle = " | ".join(part for part in [clean(row.get("project_code")), clean(row.get("project_type")), clean(row.get("status"))] if part)
        add_entity(entities, "project", project_id, title, subtitle, "projects", project_id)
        for token_text, token_type, weight in [
            (row.get("project_id"), "project_id", 90),
            (row.get("project_name"), "project_name", 100),
            (row.get("project_code"), "project_code", 95),
            (row.get("project_type"), "project_type", 25),
            (row.get("status"), "project_status", 20),
        ]:
            item = token_row("project", project_id, title, token_text, token_type, weight, related_project_id=project_id, source_table="projects", relation_path="project:self")
            if item:
                tokens.append(item)
        parent_id = clean(row.get("parent_project_id"))
        if parent_id:
            edge = edge_row(
                "project_parent_child",
                "project",
                parent_id,
                "project",
                project_id,
                "parent_child",
                "projects.parent_project_id",
                "projects",
                project_id,
                evidence={"parent_project_id": parent_id},
            )
            if edge:
                edges.append(edge)

    for row in asset_fund_links:
        asset_id = clean(row.get("asset_id"))
        fund_id = clean(row.get("fund_id"))
        if asset_id not in assets_by_id or fund_id not in funds_by_id:
            audit_rows.append({"issue_type": "asset_fund_link_orphan", "asset_id": asset_id, "fund_id": fund_id, "source_table": "asset_fund_links"})
            continue
        rel = clean(row.get("relation_type")) or "fund_asset"
        edge = edge_row(
            "fund_asset",
            "fund",
            fund_id,
            "asset",
            asset_id,
            rel,
            "asset_fund_links",
            "asset_fund_links",
            f"{fund_id}:{asset_id}:{rel}",
            float(row.get("confidence") or 1),
            "confirmed",
            {
                "include_in_asset_aum": row.get("include_in_asset_aum"),
                "allocation_status": row.get("allocation_status"),
                "allocation_ratio": row.get("allocation_ratio"),
                "needs_allocation_review": row.get("needs_allocation_review"),
                "source_table": row.get("source_table"),
                "source_id": row.get("source_id"),
            },
            include_in_amount_rollup=truthy(row.get("include_in_asset_aum"))
            and clean(row.get("allocation_status")) not in {"unallocated", "mixed_requires_review"}
            and not truthy(row.get("needs_allocation_review")),
        )
        if edge:
            edges.append(edge)
        fund = funds_by_id[fund_id]
        asset = assets_by_id[asset_id]
        fund_title = first_present(fund, "short_name", "fund_name", "fund_id")
        asset_title = first_present(asset, "physical_asset_name", "non_physical_asset_label", "asset_code", "asset_id")
        for entity_type, entity_id, display_title, token_text, token_type, path in [
            ("asset", asset_id, asset_title, fund.get("fund_name"), "linked_fund_name", "fund_asset:fund_to_asset"),
            ("asset", asset_id, asset_title, fund.get("short_name"), "linked_fund_short_name", "fund_asset:fund_to_asset"),
            ("asset", asset_id, asset_title, fund_id, "linked_fund_id", "fund_asset:fund_to_asset"),
            ("asset", asset_id, asset_title, fund.get("project_mission_name"), "linked_fund_project_mission_name", "fund_asset:fund_to_asset"),
            ("asset", asset_id, asset_title, fund.get("asset_name"), "linked_fund_source_asset_name", "fund_asset:fund_to_asset"),
            ("fund", fund_id, fund_title, asset_title, "linked_asset_title", "fund_asset:asset_to_fund"),
            ("fund", fund_id, fund_title, asset.get("asset_code"), "linked_asset_code", "fund_asset:asset_to_fund"),
            ("fund", fund_id, fund_title, asset.get("address_text"), "linked_asset_address", "fund_asset:asset_to_fund"),
        ]:
            item = token_row(entity_type, entity_id, display_title, token_text, token_type, 75, asset_id, fund_id, "", "asset_fund_links", path)
            if item:
                tokens.append(item)

    for row in asset_project_links:
        asset_id = clean(row.get("asset_id"))
        target = clean(row.get("project_id"))
        if asset_id not in assets_by_id:
            audit_rows.append({"issue_type": "asset_project_link_orphan_asset", "asset_id": asset_id, "target_id": target, "source_table": "asset_project_links"})
            continue
        if target in projects_by_id:
            target_type = "project"
            target_entity_type = "project"
            relation_status = "confirmed"
        elif target in funds_by_id:
            target_type = "fund_as_project"
            target_entity_type = "fund"
            relation_status = "compatibility"
        elif target.startswith("iota-"):
            target_type = "pilot_code"
            target_entity_type = "project"
            relation_status = "review_required"
        else:
            target_type = "unresolved"
            target_entity_type = "project"
            relation_status = "unresolved"
            audit_rows.append({"issue_type": "asset_project_link_unresolved_target", "asset_id": asset_id, "target_id": target, "source_table": "asset_project_links"})
        rel = clean(row.get("relation_type")) or target_type
        edge = edge_row(
            "asset_project",
            target_entity_type,
            target,
            "asset",
            asset_id,
            rel,
            f"asset_project_links:{target_type}",
            "asset_project_links",
            clean(row.get("source_id")) or f"{target}:{asset_id}:{rel}",
            float(row.get("confidence") or 1),
            relation_status,
            {"target_type": target_type, "source_table": row.get("source_table"), "source_id": row.get("source_id")},
        )
        if edge:
            edges.append(edge)
        asset = assets_by_id.get(asset_id, {})
        asset_title = first_present(asset, "physical_asset_name", "non_physical_asset_label", "asset_code", "asset_id")
        if target_entity_type == "project" and target in projects_by_id:
            source = projects_by_id[target]
            source_title = first_present(source, "project_name", "project_code", "project_id")
            related_project_id = target
            related_fund_id = ""
        elif target_entity_type == "fund" and target in funds_by_id:
            source = funds_by_id[target]
            source_title = first_present(source, "short_name", "fund_name", "fund_id")
            related_project_id = ""
            related_fund_id = target
        else:
            source_title = target
            related_project_id = target if target_entity_type == "project" else ""
            related_fund_id = target if target_entity_type == "fund" else ""
        if source_title:
            item = token_row(
                "asset",
                asset_id,
                asset_title,
                source_title,
                f"linked_{target_entity_type}_title",
                70,
                related_asset_id=asset_id,
                related_fund_id=related_fund_id,
                related_project_id=related_project_id,
                source_table="asset_project_links",
                relation_path=f"asset_project:{target_type}:target_to_asset",
            )
            if item:
                tokens.append(item)
        if asset_title and target_type in {"project", "fund_as_project"}:
            item = token_row(
                target_entity_type,
                target,
                source_title,
                asset_title,
                "linked_asset_title",
                68,
                related_asset_id=asset_id,
                related_fund_id=related_fund_id,
                related_project_id=related_project_id,
                source_table="asset_project_links",
                relation_path=f"asset_project:{target_type}:asset_to_target",
            )
            if item:
                tokens.append(item)

    for project_id, row in projects_by_id.items():
        parent_id = clean(row.get("parent_project_id"))
        if not parent_id:
            continue
        # Push parent-project tokens to child-linked assets/funds.
        child_asset_ids = [edge["target_entity_id"] for edge in edges if edge["edge_type"] == "asset_project" and edge["source_entity_type"] == "project" and edge["source_entity_id"] == project_id]
        parent = projects_by_id.get(parent_id, {})
        parent_title = first_present(parent, "project_name", "project_code", "project_id")
        for asset_id in child_asset_ids:
            asset = assets_by_id.get(asset_id, {})
            asset_title = first_present(asset, "physical_asset_name", "non_physical_asset_label", "asset_code", "asset_id")
            item = token_row("asset", asset_id, asset_title, parent_title, "parent_project_name", 78, related_asset_id=asset_id, related_project_id=project_id, source_table="projects", relation_path="parent_project:child_asset")
            if item:
                tokens.append(item)
            for fund_id in asset_funds.get(asset_id, set()):
                fund = funds_by_id.get(fund_id, {})
                fund_title = first_present(fund, "short_name", "fund_name", "fund_id")
                item = token_row("fund", fund_id, fund_title, parent_title, "parent_project_name", 76, related_asset_id=asset_id, related_fund_id=fund_id, related_project_id=project_id, source_table="projects+asset_fund_links", relation_path="parent_project:child_asset:fund")
                if item:
                    tokens.append(item)

    for exposure_type, rows, name_clean_key, name_raw_key in [
        ("lender", lenders, "lender_clean", "lender_raw"),
        ("beneficiary", beneficiaries, "beneficiary_clean", "beneficiary_raw"),
    ]:
        prefix = "lender" if exposure_type == "lender" else "beneficiary"
        for row in rows:
            exposure_id = clean(row.get("id"))
            name = first_present(row, name_clean_key, name_raw_key, "id")
            entity_id = party_id(prefix, name)
            add_entity(
                entities,
                exposure_type,
                entity_id,
                name,
                exposure_type,
                f"{exposure_type}_exposures",
                exposure_id,
                metadata={"party_name": name},
            )
            fund_id = clean(row.get("fund_id"))
            asset_id = clean(row.get("asset_id"))
            table = f"{exposure_type}_exposures"
            item = token_row(exposure_type, entity_id, name, name, f"{exposure_type}_name", 100, asset_id, fund_id, "", table, f"{exposure_type}:self")
            if item:
                tokens.append(item)
            if fund_id:
                edge = edge_row(f"{exposure_type}_fund", exposure_type, entity_id, "fund", fund_id, "exposure_fund", table, table, exposure_id, 1, "confirmed", {"exposure_id": exposure_id})
                if edge:
                    edges.append(edge)
            if asset_id:
                edge = edge_row(
                    f"{exposure_type}_asset",
                    exposure_type,
                    entity_id,
                    "asset",
                    asset_id,
                    "exposure_asset",
                    "direct_asset_id",
                    table,
                    exposure_id,
                    1,
                    "confirmed",
                    {"exposure_id": exposure_id},
                    include_in_amount_rollup=True,
                )
                if edge:
                    edges.append(edge)
            elif fund_id:
                linked_assets = sorted(fund_assets.get(fund_id, set()))
                if not linked_assets:
                    audit_rows.append({"issue_type": f"{exposure_type}_without_asset_derivation", "fund_id": fund_id, "exposure_id": exposure_id, "source_table": table})
                for linked_asset_id in linked_assets:
                    status = "review_required" if len(linked_assets) > 1 else "confirmed"
                    edge = edge_row(
                        f"{exposure_type}_asset",
                        exposure_type,
                        entity_id,
                        "asset",
                        linked_asset_id,
                        "exposure_asset",
                        "derived_via_fund_asset_link",
                        table,
                        exposure_id,
                        0.85 if len(linked_assets) == 1 else 0.65,
                        status,
                        {"exposure_id": exposure_id, "fund_id": fund_id, "linked_asset_count": len(linked_assets)},
                        include_in_amount_rollup=len(linked_assets) == 1,
                    )
                    if edge:
                        edges.append(edge)

    # Deduplicate edge/token rows after all propagation paths are built.
    unique_edges = {row["edge_id"]: row for row in edges}
    unique_tokens = {
        stable_id(row["entity_key"], row["token_text"], row["token_type"], row["related_asset_id"], row["related_fund_id"], row["related_project_id"], row["relation_path"]): row
        for row in tokens
    }
    entities_rows = sorted(entities.values(), key=lambda row: (row["entity_type"], row["entity_id"]))
    edge_rows = sorted(unique_edges.values(), key=lambda row: (row["source_entity_type"], row["source_entity_id"], row["edge_type"], row["target_entity_type"], row["target_entity_id"]))
    token_rows = sorted(unique_tokens.values(), key=lambda row: (row["entity_type"], row["entity_id"], -row["rank_weight"], row["token_type"]))

    summary = {
        "source_counts": {
            "funds": len(funds),
            "assets": len(assets),
            "asset_aliases": len(aliases),
            "asset_fund_links": len(asset_fund_links),
            "projects": len(projects),
            "asset_project_links": len(asset_project_links),
            "lender_exposures": len(lenders),
            "beneficiary_exposures": len(beneficiaries),
        },
        "entity_counts": Counter(row["entity_type"] for row in entities_rows),
        "edge_counts": Counter(row["edge_type"] for row in edge_rows),
        "edge_status_counts": Counter(row["status"] for row in edge_rows),
        "token_counts": Counter(row["entity_type"] for row in token_rows),
        "audit_counts": Counter(row["issue_type"] for row in audit_rows),
    }
    return {
        "entities": entities_rows,
        "edges": edge_rows,
        "tokens": token_rows,
        "audit": audit_rows,
        "summary": summary,
    }


def write_report(path: Path, result: dict[str, Any]) -> None:
    summary = result["summary"]
    lines = [
        "# Relationship Index Candidate Build",
        "",
        "## Source Counts",
        "",
        "| source | rows |",
        "|---|---:|",
    ]
    for key, value in summary["source_counts"].items():
        lines.append(f"| `{key}` | {value} |")
    lines.extend(["", "## Entity Counts", "", "| entity_type | rows |", "|---|---:|"])
    for key, value in sorted(summary["entity_counts"].items()):
        lines.append(f"| `{key}` | {value} |")
    lines.extend(["", "## Edge Counts", "", "| edge_type | rows |", "|---|---:|"])
    for key, value in sorted(summary["edge_counts"].items()):
        lines.append(f"| `{key}` | {value} |")
    lines.extend(["", "## Edge Status Counts", "", "| status | rows |", "|---|---:|"])
    for key, value in sorted(summary["edge_status_counts"].items()):
        lines.append(f"| `{key}` | {value} |")
    lines.extend(["", "## Audit Counts", "", "| issue_type | rows |", "|---|---:|"])
    if summary["audit_counts"]:
        for key, value in sorted(summary["audit_counts"].items()):
            lines.append(f"| `{key}` | {value} |")
    else:
        lines.append("| none | 0 |")
    lines.extend(
        [
            "",
            "## Output Files",
            "",
            "- `relationship_index_entities.csv`",
            "- `relationship_index_edges.csv`",
            "- `relationship_index_tokens.csv`",
            "- `relationship_index_audit.csv`",
            "- `relationship_index_summary.json`",
            "",
            "## Interpretation",
            "",
            "- Entity rows are the deduplicated dashboard search/display targets.",
            "- Edge rows are the relationship graph used to traverse fund/asset/project/party relationships.",
            "- Token rows are searchable text paths that point back to canonical entities.",
            "- Audit rows are not hidden; they are review queues for unresolved relationship interpretation.",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    result = build()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    write_csv(OUT_DIR / "relationship_index_entities.csv", result["entities"])
    write_csv(OUT_DIR / "relationship_index_edges.csv", result["edges"])
    write_csv(OUT_DIR / "relationship_index_tokens.csv", result["tokens"])
    write_csv(OUT_DIR / "relationship_index_audit.csv", result["audit"])
    (OUT_DIR / "relationship_index_summary.json").write_text(
        json.dumps(result["summary"], ensure_ascii=False, indent=2, default=dict),
        encoding="utf-8",
    )
    write_report(OUT_DIR / "relationship_index_report.md", result)
    print(
        json.dumps(
            {
                "output_dir": str(OUT_DIR),
                "entities": len(result["entities"]),
                "edges": len(result["edges"]),
                "tokens": len(result["tokens"]),
                "audit_rows": len(result["audit"]),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
