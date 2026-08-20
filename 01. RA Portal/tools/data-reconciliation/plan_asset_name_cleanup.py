from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "01. RA Portal" / "output" / "asset_name_cleanup_20260609"

REAL_ESTATE_TYPES = {
    "오피스",
    "오피스복합",
    "주거",
    "주거복합",
    "물류",
    "물류센터",
    "리테일",
    "리테일복합",
    "호텔",
    "호텔복합",
    "데이터센터",
    "특별자산",
    "복합(오피스)",
}

NON_PHYSICAL_TYPES = {"금융상품", "기업주식", "지분증권", "채권", "증권"}
NON_PHYSICAL_KINDS = {"fund_interest", "portfolio_asset", "synthetic_bucket"}

FINANCIAL_KEYWORDS = [
    "채권",
    "증권",
    "주식",
    "전환사채",
    "회사채",
    "공모주",
    "수익증권",
    "금융상품",
    "대출채권",
    "메자닌",
    "담보대출",
    "bridge loan",
    "brloan",
    "senior loan",
    "junior loan",
    "mezzanine loan",
    "b-note",
    "a2-note",
    "note loan",
    "cmbs loan",
    "rescue capital loan",
    "term facility",
    "standby facility",
    "debt fund",
    "credit fund",
    "direct lending",
    "principal finance",
    "rcps",
    "cb",
    "eb",
    "bw",
]

FUND_LIKE_KEYWORDS = [
    " fund",
    " lp",
    " l.p.",
    " sicav",
    " raif",
    " co-invest",
    " opportunity",
    " opportunities",
    " principal finance",
    " direct lending",
]

STRIP_PATTERNS = [
    r"\s+Senior\s+Mezzanine\s+Loan\b.*$",
    r"\s+Junior\s+Mezzanine\s+Loan\b.*$",
    r"\s+Mezzanine\s+Loan\b.*$",
    r"\s+Senior\s+B-?Note\s+Loan\b.*$",
    r"\s+B-?Note\s+Loan\b.*$",
    r"\s+A2-?Note\s+Loan\b.*$",
    r"\s+Senior\s+Loan\b.*$",
    r"\s+CMBS\s+Loan\b.*$",
    r"\s+Rescue\s+Capital\s+Loan\b.*$",
    r"\s+\(Term\s+Facility\)\s*$",
    r"\s+\(Standby\s+Facility\)\s*$",
    r"\s+Bridge\s+Loan\b.*$",
    r"\s+담보대출.*$",
    r"\s+대출채권.*$",
    r"\s+대출\s*투자.*$",
]


def clean(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


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


def request_json(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]
    query = urllib.parse.urlencode(params, safe="*,.:()")
    req = urllib.request.Request(
        f"{base}/rest/v1/{table}?{query}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.loads(response.read().decode("utf-8") or "[]")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GET {table} failed: HTTP {exc.code} {detail}") from exc


def fetch_live_assets() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = request_json(
            "asset_master",
            {
                "select": "asset_id,canonical_name,asset_type,asset_kind,is_physical,address_text,pnu,asset_code,review_status,metadata",
                "limit": "1000",
                "offset": str(offset),
            },
        )
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        offset += 1000


def fetch_all(table: str, select: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = request_json(table, {"select": select, "limit": "1000", "offset": str(offset)})
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        offset += 1000


def build_fund_short_names_by_asset() -> dict[str, list[str]]:
    links = fetch_all("asset_fund_links", "asset_id,fund_id")
    funds = fetch_all("v_funds_enriched", "fund_id,short_name")
    short_by_fund = {clean(row.get("fund_id")): clean(row.get("short_name")) for row in funds}
    result: dict[str, list[str]] = {}
    for link in links:
        asset_id = clean(link.get("asset_id"))
        fund_id = clean(link.get("fund_id"))
        label = short_by_fund.get(fund_id) or fund_id
        if not asset_id or not label:
            continue
        result.setdefault(asset_id, [])
        if label not in result[asset_id]:
            result[asset_id].append(label)
    return result


def has_financial_keyword(text: str) -> bool:
    lowered = text.lower()
    return any(keyword.lower() in lowered for keyword in FINANCIAL_KEYWORDS)


def has_fund_like_keyword(text: str) -> bool:
    lowered = f" {text.lower()} "
    return any(keyword in lowered for keyword in FUND_LIKE_KEYWORDS)


def has_physical_evidence(row: dict[str, Any]) -> bool:
    return bool(clean(row.get("pnu")) or clean(row.get("address_text")))


def strip_instrument_terms(name: str) -> str:
    stripped = clean(name)
    for pattern in STRIP_PATTERNS:
        stripped = re.sub(pattern, "", stripped, flags=re.I)
    stripped = re.sub(r"\s+\+\s+Mezz\s+Loan\b.*$", "", stripped, flags=re.I)
    return clean(stripped)


def instrument_label(row: dict[str, Any]) -> str:
    name = clean(row.get("canonical_name"))
    asset_type = clean(row.get("asset_type"))
    text = f"{name} {asset_type}".lower()
    labels: list[str] = []
    checks = [
        ("전환사채", ["전환사채", " cb "]),
        ("공모주", ["공모주"]),
        ("RCPS", ["rcps", "상환전환우선주"]),
        ("상장리츠", ["상장리츠", "listed reit"]),
        ("회사채", ["회사채"]),
        ("지분증권", ["지분증권", "equity", "주식", "기업주식"]),
        ("메자닌대출", ["mezzanine loan", "mezz loan", "메자닌"]),
        ("선순위대출", ["senior loan", "super-senior loan", "선순위"]),
        ("후순위대출", ["junior loan", "후순위"]),
        ("브릿지론", ["bridge loan", "brloan", "브릿지"]),
        ("노트/채권", ["b-note", "a2-note", "note loan", "채권"]),
        ("크레딧펀드", ["credit fund", "distressed credit", "direct lending", "debt fund"]),
        ("펀드지분", [" fund", " lp", " l.p.", "sicav", "raif", "co-invest"]),
        ("금융상품", ["금융상품", "증권"]),
    ]
    padded = f" {text} "
    for label, needles in checks:
        if any(needle in padded for needle in needles):
            labels.append(label)
    if labels:
        deduped: list[str] = []
        for label in labels:
            if label not in deduped:
                deduped.append(label)
        return "/".join(deduped[:4])
    if asset_type in NON_PHYSICAL_TYPES:
        return asset_type
    return "비실물자산"


def short_name_suffix(short_names: list[str], asset_code: str) -> str:
    labels = [clean(value) for value in short_names if clean(value)]
    if labels:
        head = labels[:3]
        suffix = ", ".join(head)
        if len(labels) > 3:
            suffix += f" 외 {len(labels) - 3}"
        return suffix
    return clean(asset_code)


def non_physical_label(row: dict[str, Any], fund_short_names: list[str]) -> str:
    instrument = instrument_label(row)
    suffix = short_name_suffix(fund_short_names, clean(row.get("asset_code")))
    return f"{instrument} · {suffix}" if suffix else instrument


def classify(row: dict[str, Any], fund_short_names: list[str] | None = None) -> dict[str, Any]:
    fund_short_names = fund_short_names or []
    name = clean(row.get("canonical_name"))
    asset_type = clean(row.get("asset_type"))
    asset_kind = clean(row.get("asset_kind"))
    physical_evidence = has_physical_evidence(row)
    real_estate_type = asset_type in REAL_ESTATE_TYPES
    financial = has_financial_keyword(name) or asset_type in NON_PHYSICAL_TYPES or asset_kind in NON_PHYSICAL_KINDS

    if asset_kind in NON_PHYSICAL_KINDS or asset_type in NON_PHYSICAL_TYPES:
        action = "suppress_non_physical_name"
        display_name = ""
        reason = "asset kind/type is non-physical financial/security exposure"
    elif physical_evidence and real_estate_type and has_financial_keyword(name):
        display_name = strip_instrument_terms(name)
        action = "strip_instrument_terms" if display_name and display_name != name else "review_financial_name_with_physical_evidence"
        reason = "physical evidence exists, but name contains loan/security terms"
    elif not physical_evidence and has_fund_like_keyword(name):
        action = "suppress_fund_like_name"
        display_name = ""
        reason = "fund-like/security-like name has no physical address or PNU evidence"
    elif real_estate_type or physical_evidence:
        action = "keep_physical_name"
        display_name = name
        reason = "real estate type or physical evidence exists"
    elif financial:
        action = "suppress_financial_name"
        display_name = ""
        reason = "financial/security keyword without enough physical evidence"
    else:
        action = "review_unknown_name"
        display_name = name
        reason = "insufficient evidence for automatic physical name decision"

    return {
        "asset_id": row.get("asset_id") or "",
        "asset_code": row.get("asset_code") or "",
        "canonical_name": name,
        "proposed_physical_asset_name": display_name,
        "proposed_non_physical_label": "" if display_name else non_physical_label(row, fund_short_names),
        "linked_fund_short_names": ", ".join(fund_short_names),
        "asset_type": asset_type,
        "asset_kind": asset_kind,
        "review_status": row.get("review_status") or "",
        "has_address": "Y" if clean(row.get("address_text")) else "N",
        "has_pnu": "Y" if clean(row.get("pnu")) else "N",
        "cleanup_action": action,
        "cleanup_reason": reason,
    }


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


def write_report(path: Path, rows: list[dict[str, Any]]) -> None:
    counts = Counter(row["cleanup_action"] for row in rows)
    affected = [row for row in rows if row["cleanup_action"] != "keep_physical_name"]
    lines = [
        "# Asset Name Cleanup Plan",
        "",
        "- Policy: display/search asset names should represent physical real estate only.",
        "- Financial instruments, securities, fund interests, and fund-like names are removed from the physical asset-name contract.",
        "- Non-physical display labels are proposed as instrument/security type plus linked fund short name, never full fund name.",
        "- Original `canonical_name` values are not dropped by this plan; they remain provenance until a reviewed destructive cleanup is approved.",
        "",
        "## Action Counts",
        "",
        "| action | rows |",
        "|---|---:|",
    ]
    for action, count in counts.most_common():
        lines.append(f"| `{action}` | {count} |")
    lines.extend(
        [
            "",
            "## Cleanup Contract",
            "",
            "| action | meaning |",
            "|---|---|",
            "| `keep_physical_name` | keep the current name as a physical real estate display name |",
            "| `strip_instrument_terms` | keep the physical property/location part, remove loan/security wording |",
            "| `suppress_non_physical_name` | hide the name from asset display/search because the row is non-physical |",
            "| `suppress_fund_like_name` | hide fund-like names with no address/PNU physical evidence |",
            "| `suppress_financial_name` | hide financial/security names with no physical evidence |",
            "| `review_*` | do not automatically promote to physical display name |",
            "",
            "## Sample Affected Rows",
            "",
            "| asset_code | current name | proposed physical name | proposed non-physical label | action | reason |",
            "|---|---|---|---|---|---|",
        ]
    )
    for row in affected[:40]:
        lines.append(
            "| {asset_code} | {canonical_name} | {proposed_physical_asset_name} | {proposed_non_physical_label} | `{cleanup_action}` | {cleanup_reason} |".format(
                **{key: str(value).replace("|", "\\|") for key, value in row.items()}
            )
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["live"], default="live")
    parser.add_argument("--output-dir", type=Path, default=OUT_DIR)
    args = parser.parse_args()

    load_env()
    assets = fetch_live_assets()
    fund_short_names_by_asset = build_fund_short_names_by_asset()
    rows = [classify(row, fund_short_names_by_asset.get(clean(row.get("asset_id")), [])) for row in assets]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(args.output_dir / "asset_name_cleanup_candidates.csv", rows)
    write_report(args.output_dir / "asset_name_cleanup_plan.md", rows)
    summary = {
        "total_assets": len(rows),
        "action_counts": dict(Counter(row["cleanup_action"] for row in rows)),
        "output_dir": str(args.output_dir),
    }
    (args.output_dir / "asset_name_cleanup_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
