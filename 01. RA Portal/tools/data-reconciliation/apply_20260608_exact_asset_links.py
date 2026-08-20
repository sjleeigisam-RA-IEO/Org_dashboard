from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[2]
CANDIDATES = ROOT / "01. RA Portal" / "output" / "reconciliation_20260608" / "fund_asset_pair_candidates.csv"
OUT_DIR = ROOT / "01. RA Portal" / "output" / "reconciliation_20260608_apply"
SOURCE_FILE = "투자 자산 조회_20260608.xlsx"
LOAD_DATE = "2026-06-08"


def clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ").strip()
    if not text or text.lower() in {"nan", "none", "null", "undefined"}:
        return ""
    return re.sub(r"\s+", " ", text)


def norm(value: Any) -> str:
    text = clean(value).lower()
    text = re.sub(r"\s+", "", text)
    return text


def load_env() -> None:
    for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def request_json(
    path: str,
    params: dict[str, str] | None = None,
    method: str = "GET",
    rows: list[dict[str, Any]] | None = None,
    range_header: str | None = None,
) -> list[dict[str, Any]]:
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    query = urllib.parse.urlencode(params or {}, safe="*,.:()")
    target = f"{url}/rest/v1/{path}" + (f"?{query}" if query else "")
    data = None if rows is None else json.dumps(rows, ensure_ascii=False).encode("utf-8")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    if range_header:
        headers["Range"] = range_header
    req = urllib.request.Request(target, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase {method} {path} failed: HTTP {exc.code} {detail}") from exc
    return json.loads(body or "[]")


def fetch_all(table: str, select: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    size = 1000
    while True:
        batch = request_json(table, {"select": select}, range_header=f"{start}-{start + size - 1}")
        rows.extend(batch)
        if len(batch) < size:
            return rows
        start += size


def read_candidates() -> list[dict[str, str]]:
    with CANDIDATES.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def add_match(index: dict[str, list[dict[str, Any]]], name: str, asset_id: str, match_source: str, confidence: float) -> None:
    key = norm(name)
    if not key:
        return
    item = {"asset_id": asset_id, "match_name": clean(name), "match_source": match_source, "confidence": confidence}
    if item not in index.setdefault(key, []):
        index[key].append(item)


def build_asset_index(assets: list[dict[str, Any]], aliases: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = {}
    for asset in assets:
        asset_id = clean(asset.get("asset_id"))
        if not asset_id:
            continue
        add_match(index, asset.get("canonical_name"), asset_id, "asset_master.canonical_name", 0.97)
        add_match(index, asset.get("asset_code"), asset_id, "asset_master.asset_code", 0.99)
    for alias in aliases:
        asset_id = clean(alias.get("asset_id"))
        if not asset_id:
            continue
        add_match(index, alias.get("alias_name"), asset_id, "asset_aliases.alias_name", float(alias.get("confidence") or 0.9))
    return index


def plan_links() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    candidates = read_candidates()
    assets = fetch_all("asset_master", "asset_id,canonical_name,asset_code")
    aliases = fetch_all("asset_aliases", "asset_id,alias_name,alias_type,confidence")
    existing_links = {
        (clean(row.get("asset_id")), clean(row.get("fund_id")), clean(row.get("relation_type")))
        for row in fetch_all("asset_fund_links", "asset_id,fund_id,relation_type")
    }
    asset_index = build_asset_index(assets, aliases)

    inserts: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for row in candidates:
        if row.get("issue_type") != "source_pair_not_in_supabase_exact":
            continue
        fund_id = clean(row.get("fund_id"))
        source_name = clean(row.get("source_asset_name"))
        matches = asset_index.get(norm(source_name), [])
        asset_ids = sorted({match["asset_id"] for match in matches})
        if len(asset_ids) != 1:
            skipped.append({
                "fund_id": fund_id,
                "source_asset_name": source_name,
                "reason": "no_unique_exact_asset_match",
                "match_count": len(asset_ids),
                "candidate_asset_ids": " | ".join(asset_ids[:10]),
            })
            continue
        asset_id = asset_ids[0]
        key = (asset_id, fund_id, "underlying_asset")
        if key in existing_links or key in seen:
            continue
        seen.add(key)
        best = max((match for match in matches if match["asset_id"] == asset_id), key=lambda item: item["confidence"])
        inserts.append({
            "asset_id": asset_id,
            "fund_id": fund_id,
            "relation_type": "underlying_asset",
            "source_table": "fund_asset_source",
            "source_id": f"{SOURCE_FILE}:{fund_id}:{source_name}",
            "confidence": best["confidence"],
            "metadata": {
                "source_file": SOURCE_FILE,
                "source_asset_name": source_name,
                "match_source": best["match_source"],
                "match_name": best["match_name"],
                "load_date": LOAD_DATE,
                "insert_reason": "exact unique source asset name match for search relationship",
            },
        })
    return inserts, skipped


def write_outputs(inserts: list[dict[str, Any]], skipped: list[dict[str, Any]]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "exact_asset_links_upsert_payload.json").write_text(json.dumps(inserts, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "exact_asset_links_skipped.json").write_text(json.dumps(skipped, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Add only exact unique source asset-name links to asset_fund_links.")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    load_env()
    inserts, skipped = plan_links()
    write_outputs(inserts, skipped)
    print(json.dumps({
        "candidate_links": len(inserts),
        "skipped": len(skipped),
        "apply": args.apply,
        "payload_path": str(OUT_DIR / "exact_asset_links_upsert_payload.json"),
        "skipped_path": str(OUT_DIR / "exact_asset_links_skipped.json"),
    }, ensure_ascii=False, indent=2))
    if not args.apply or not inserts:
        return
    applied = request_json("asset_fund_links", {"on_conflict": "asset_id,fund_id,relation_type"}, "POST", inserts)
    funds = sorted({row["fund_id"] for row in inserts})
    verified = request_json(
        "fund_asset_relationships",
        {
            "select": "asset_id,canonical_name,fund_id,fund_name,relation_type,source_table",
            "fund_id": f"in.({','.join(funds)})",
        },
        "GET",
    )
    (OUT_DIR / "exact_asset_links_verify.json").write_text(json.dumps(verified, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "upsert_returned": len(applied),
        "verify_rows_for_affected_funds": len(verified),
        "verify_path": str(OUT_DIR / "exact_asset_links_verify.json"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
