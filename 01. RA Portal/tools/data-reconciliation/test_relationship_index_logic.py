from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "01. RA Portal" / "output" / "relationship_index_20260609"


def read_csv(name: str) -> list[dict[str, str]]:
    path = OUT_DIR / name
    if not path.exists():
        raise AssertionError(f"missing output file: {path}")
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def fail(message: str) -> dict[str, Any]:
    return {"status": "fail", "message": message}


def pass_(message: str, **extra: Any) -> dict[str, Any]:
    return {"status": "pass", "message": message, **extra}


def warn(message: str, **extra: Any) -> dict[str, Any]:
    return {"status": "warn", "message": message, **extra}


def search_tokens(tokens: list[dict[str, str]], query: str) -> list[dict[str, str]]:
    needle = query.casefold()
    return [row for row in tokens if needle in (row.get("token_text") or "").casefold()]


def entity_types(rows: list[dict[str, str]]) -> set[str]:
    return {row.get("entity_type", "") for row in rows}


def test_uniqueness(entities: list[dict[str, str]], edges: list[dict[str, str]], tokens: list[dict[str, str]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    entity_keys = [row["entity_key"] for row in entities]
    canonical_entity_keys = [(row["entity_type"], row["entity_id"]) for row in entities]
    edge_ids = [row["edge_id"] for row in edges]
    token_keys = [
        (
            row["entity_key"],
            row["token_text"],
            row["token_type"],
            row["related_asset_id"],
            row["related_fund_id"],
            row["related_project_id"],
            row["relation_path"],
        )
        for row in tokens
    ]
    for label, values in [
        ("entity_key", entity_keys),
        ("entity_type/entity_id", canonical_entity_keys),
        ("edge_id", edge_ids),
        ("token path identity", token_keys),
    ]:
        duplicates = len(values) - len(set(values))
        if duplicates:
            results.append(fail(f"{label} has duplicates: {duplicates}"))
        else:
            results.append(pass_(f"{label} is unique", rows=len(values)))
    return results


def test_edge_integrity(entities: list[dict[str, str]], edges: list[dict[str, str]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    entity_set = {(row["entity_type"], row["entity_id"]) for row in entities}
    missing_source = [
        row for row in edges if (row["source_entity_type"], row["source_entity_id"]) not in entity_set
    ]
    missing_target = [
        row for row in edges if (row["target_entity_type"], row["target_entity_id"]) not in entity_set
    ]
    if missing_source:
        results.append(fail("edges with missing source entity", rows=len(missing_source)))
    else:
        results.append(pass_("all edge sources resolve", rows=len(edges)))
    if missing_target:
        results.append(fail("edges with missing target entity", rows=len(missing_target)))
    else:
        results.append(pass_("all edge targets resolve", rows=len(edges)))

    status_counts = Counter(row["status"] for row in edges)
    if status_counts.get("unresolved", 0):
        results.append(fail("unresolved edges remain", counts=dict(status_counts)))
    else:
        results.append(pass_("no unresolved edges", counts=dict(status_counts)))

    compat_bad = [
        row
        for row in edges
        if row["status"] == "compatibility"
        and not (row["edge_type"] == "asset_project" and row["source_entity_type"] == "fund")
    ]
    if compat_bad:
        results.append(fail("compatibility edges outside fund_as_project interpretation", rows=len(compat_bad)))
    else:
        results.append(pass_("compatibility edges are limited to fund_as_project interpretation", rows=status_counts.get("compatibility", 0)))
    return results


def test_amount_rollup(edges: list[dict[str, str]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    rollup_counts = Counter(row["include_in_amount_rollup"] for row in edges)
    disabled_searchable = [
        row
        for row in edges
        if row["include_in_search"] == "True" and row["include_in_amount_rollup"] == "False"
    ]
    if disabled_searchable:
        results.append(
            pass_(
                "searchable but amount-rollup-disabled edges are explicitly separated",
                rows=len(disabled_searchable),
                counts=dict(rollup_counts),
            )
        )
    else:
        results.append(fail("expected some searchable edges to be amount-rollup-disabled"))

    bad_exposure_rollup = [
        row
        for row in edges
        if row["edge_type"] in {"lender_asset", "beneficiary_asset"}
        and row["status"] == "review_required"
        and row["include_in_amount_rollup"] == "True"
    ]
    if bad_exposure_rollup:
        results.append(fail("review-required exposure edges are amount-bearing", rows=len(bad_exposure_rollup)))
    else:
        results.append(pass_("review-required exposure edges are not amount-bearing"))
    return results


def test_query_coverage(tokens: list[dict[str, str]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    scenarios = {
        "이오타서울": {"project", "asset", "fund"},
        "국민연금": {"beneficiary"},
        "홈플러스": {"asset", "fund", "project"},
        "1120": {"fund"},
    }
    for query, expected_types in scenarios.items():
        hits = search_tokens(tokens, query)
        found_types = entity_types(hits)
        missing = expected_types - found_types
        if missing:
            results.append(fail(f"query '{query}' missing entity types {sorted(missing)}", found_types=sorted(found_types), hits=len(hits)))
        else:
            results.append(pass_(f"query '{query}' covers expected entity types", found_types=sorted(found_types), hits=len(hits)))

    noon_hits = search_tokens(tokens, "눈스퀘어")
    noon_types = entity_types(noon_hits)
    if {"fund", "project", "asset"} <= noon_types:
        results.append(pass_("query '눈스퀘어' covers fund/project/asset", found_types=sorted(noon_types), hits=len(noon_hits)))
    else:
        results.append(
            warn(
                "query '눈스퀘어' does not yet converge to all expected entity types",
                expected=["asset", "fund", "project"],
                found_types=sorted(noon_types),
                hits=len(noon_hits),
            )
        )
    return results


def test_iota_path(tokens: list[dict[str, str]]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    hits = search_tokens(tokens, "이오타서울")
    by_type: dict[str, set[str]] = defaultdict(set)
    for row in hits:
        by_type[row["entity_type"]].add(row["entity_id"])
    expected_assets = {"ast_cd9937cc8678", "ast_aefd81e93778"}
    expected_funds = {"112706", "112707", "120016", "112614", "120113", "112057", "112472", "112473"}
    checks = [
        ("project", {"iota-seoul"}, by_type.get("project", set())),
        ("asset", expected_assets, by_type.get("asset", set())),
        ("fund", expected_funds, by_type.get("fund", set())),
    ]
    for label, expected, found in checks:
        missing = expected - found
        if missing:
            results.append(fail(f"IOTA missing {label} path targets", missing=sorted(missing), found=sorted(found)))
        else:
            results.append(pass_(f"IOTA includes expected {label} path targets", found=sorted(found)))
    return results


def write_report(results: list[dict[str, Any]]) -> None:
    counts = Counter(row["status"] for row in results)
    payload = {"counts": dict(counts), "results": results}
    (OUT_DIR / "relationship_index_test_results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    lines = [
        "# Relationship Index Logic Test Results",
        "",
        "## Summary",
        "",
        "| status | count |",
        "|---|---:|",
    ]
    for status in ["pass", "warn", "fail"]:
        lines.append(f"| {status} | {counts.get(status, 0)} |")
    lines.extend(["", "## Checks", "", "| status | check | detail |", "|---|---|---|"])
    for row in results:
        detail = {key: value for key, value in row.items() if key not in {"status", "message"}}
        lines.append(f"| {row['status']} | {row['message']} | `{json.dumps(detail, ensure_ascii=False)}` |")
    (OUT_DIR / "relationship_index_test_results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    entities = read_csv("relationship_index_entities.csv")
    edges = read_csv("relationship_index_edges.csv")
    tokens = read_csv("relationship_index_tokens.csv")

    results: list[dict[str, Any]] = []
    results.extend(test_uniqueness(entities, edges, tokens))
    results.extend(test_edge_integrity(entities, edges))
    results.extend(test_amount_rollup(edges))
    results.extend(test_query_coverage(tokens))
    results.extend(test_iota_path(tokens))
    write_report(results)

    counts = Counter(row["status"] for row in results)
    print(json.dumps({"output_dir": str(OUT_DIR), "counts": dict(counts)}, ensure_ascii=False, indent=2))
    if counts.get("fail", 0):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
