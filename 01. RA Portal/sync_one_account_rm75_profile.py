"""Sync the One Account v1.6 75-Account profile into RA Portal Supabase.

The source HTML contains authoritative Account identity/classification fields and
provisional RM assignments. Relationship classifications are exposed through a
dedicated portal-safe view. RM columns are written only to the restricted base
table and are deliberately absent from every dashboard-serving payload.

Dry-run is the default. Use --rehearse for a rolled-back database transaction or
--apply to persist the migration and profile rows.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


HERE = Path(__file__).resolve().parent
RA_ROOT = HERE.parent
DEFAULT_MIGRATION = HERE / "migrations" / "2026-09-11_one_account_rm75_profile.sql"
DEFAULT_OUTPUT = HERE / "scratch" / "one_account_rm75"
SOURCE_SHA256 = "e0e6d61a42d50abab8d565a490612fcf78cf05ba968344d44d8d82d22333c5a7"
SNAPSHOT_VERSION = "v1.6-rm75-260909"
SOURCE_SNAPSHOT_DATE = "2026-09-09"
EXPECTED_ACCOUNT_COUNT = 75
PISCFH_LABELS = {
    "P": "연기금·공제회·조합",
    "I": "보험·금융기관",
    "S": "국부·공적기관",
    "C": "일반기업",
    "F": "패밀리오피스",
    "H": "고액자산가",
}
PORTAL_ROLE_CLASSES = {
    "국내LP", "해외LP", "펀드·리츠·SPC", "금융기관",
    "일반기업", "공기업", "개인", "기타",
}


def read_env(path: Path) -> dict[str, object]:
    values: dict[str, object] = {}
    keys: list[str] = []
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key == "SUPABASE_KEY":
            keys.append(value)
        else:
            values[key] = value
    service_key = str(values.get("SUPABASE_SECRET_KEY") or "") or next(
        (value for value in keys if value.startswith("sb_secret_")), None
    )
    fallback_key = str(values.get("SUPABASE_PUBLISHABLE_KEY") or "") or next(
        (value for value in keys if value.startswith("sb_publishable_")), None
    )
    values["SUPABASE_KEY"] = service_key or fallback_key or (keys[0] if keys else "")
    required = ["SUPABASE_URL", "SUPABASE_KEY"]
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise RuntimeError(f"Missing values in {path.name}: {', '.join(missing)}")
    return values


class PostgrestClient:
    def __init__(self, url: str, api_key: str):
        self.base_url = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": api_key,
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "RA-Server-Audit/1.0",
        }

    def request(self, table: str, params: dict[str, str], start: int, end: int):
        query = urlencode(params, safe=",.*()")
        request = Request(
            f"{self.base_url}/{table}?{query}",
            headers={**self.headers, "Range": f"{start}-{end}", "Range-Unit": "items"},
        )
        try:
            with urlopen(request, timeout=120) as response:
                body = response.read()
                return json.loads(body.decode("utf-8")) if body else []
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"PostgREST GET {table} failed ({error.code}): {detail}") from error

    def fetch_all(self, table: str, select: str = "*") -> list[dict]:
        rows: list[dict] = []
        page_size = 1000
        while True:
            page = self.request(table, {"select": select}, len(rows), len(rows) + page_size - 1)
            rows.extend(page)
            if len(page) < page_size:
                return rows


def management_sql(sql: str, env: dict[str, object]):
    token = str(
        env.get("token")
        or env.get("SUPABASE_ACCESS_TOKEN")
        or env.get("SUPABASE_TOKEN")
        or ""
    )
    if not token:
        raise RuntimeError("Supabase management token is required for migration/apply")
    match = re.search(r"https://([a-z0-9]+)\.supabase\.co", str(env["SUPABASE_URL"]))
    if not match:
        raise RuntimeError("Unable to derive Supabase project reference")
    request = Request(
        f"https://api.supabase.com/v1/projects/{match.group(1)}/database/query",
        data=json.dumps({"query": sql}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Codex-RA-Dashboard/1.0",
        },
    )
    try:
        with urlopen(request, timeout=180) as response:
            body = response.read()
            return json.loads(body.decode("utf-8")) if body else None
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase SQL API failed ({error.code}): {detail}") from error


def extract_json_script(html: str, element_id: str):
    match = re.search(
        rf'<script[^>]+id=["\']{re.escape(element_id)}["\'][^>]*>(.*?)</script>',
        html,
        flags=re.S | re.I,
    )
    if not match:
        raise RuntimeError(f"Missing JSON script element: {element_id}")
    return json.loads(match.group(1))


def parse_source(path: Path) -> dict:
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SOURCE_SHA256:
        raise RuntimeError(f"Unexpected source SHA-256: {digest}")
    html = raw.decode("utf-8-sig")
    data = extract_json_script(html, "embedded-data")
    assignments = extract_json_script(html, "sharedTeamState")
    snapshot_match = re.search(
        r'<meta[^>]+id=["\']snapshotMeta["\'][^>]+content=["\']([^"\']+)',
        html,
        flags=re.I,
    )
    snapshot_id = snapshot_match.group(1).strip() if snapshot_match else SNAPSHOT_VERSION
    accounts = {row["account_id"]: row for row in data.get("accounts", [])}
    people = {row["person_id"]: row for row in data.get("rm_candidates", [])}
    if len(assignments) != EXPECTED_ACCOUNT_COUNT:
        raise RuntimeError(f"Expected {EXPECTED_ACCOUNT_COUNT} assigned Accounts, found {len(assignments)}")
    missing_accounts = sorted(set(assignments) - set(accounts))
    if missing_accounts:
        raise RuntimeError(f"Assignment Account IDs absent from source: {missing_accounts}")
    assigned_people = {
        assignment.get(key)
        for assignment in assignments.values()
        for key in ("primaryRmId", "backupRmId", "sponsorRmId")
    }
    missing_people = sorted(person_id for person_id in assigned_people if person_id not in people)
    if missing_people:
        raise RuntimeError(f"RM IDs absent from source candidate roster: {missing_people}")
    return {
        "source_sha256": digest,
        "snapshot_id": snapshot_id,
        "data": data,
        "assignments": assignments,
        "accounts": accounts,
        "people": people,
    }


def normalize_name(value) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    return re.sub(r"[\s\u00a0·ㆍ._,()\[\]{}<>/\\\-]+", "", text)


def alias_names(account: dict) -> list[str]:
    names = [str(account.get("display_name") or "").strip()]
    for alias in account.get("aliases") or []:
        value = alias.get("name") if isinstance(alias, dict) else alias
        value = str(value or "").strip()
        if value:
            names.append(value)
    return list(dict.fromkeys(name for name in names if name))


def relationship_classification(account: dict) -> dict:
    piscfh = account.get("piscfh") or {}
    classification = piscfh.get("classification") or {}
    valid_codes = set(PISCFH_LABELS)
    code = str(classification.get("code") or "").strip().upper()
    if code not in valid_codes:
        active = [
            str(value).strip().upper()
            for value in (piscfh.get("active_default_codes") or [])
            if str(value).strip().upper() in valid_codes
        ]
        code = active[0] if len(set(active)) == 1 else ""
    category = str(account.get("category") or "").strip()
    if "해외LP" in category:
        portal_role_class = "해외LP"
    elif code == "P":
        portal_role_class = "국내LP"
    elif code == "I":
        portal_role_class = "금융기관"
    elif code == "S":
        portal_role_class = "공기업"
    elif code == "C":
        portal_role_class = "일반기업"
    elif code == "H":
        portal_role_class = "개인"
    elif code == "F":
        portal_role_class = "기타"
    else:
        portal_role_class = {
            "국내LP": "국내LP",
            "국내LP·대주": "국내LP",
            "금융기관": "금융기관",
            "보험": "금융기관",
            "은행": "금융기관",
            "캐피탈·여전": "금융기관",
            "새마을금고": "금융기관",
            "공기업": "공기업",
            "일반기업": "일반기업",
            "개인": "개인",
        }.get(category, "기타")
    if portal_role_class not in PORTAL_ROLE_CLASSES:
        raise RuntimeError(f"Invalid portal role class: {portal_role_class}")
    return {
        "piscfh_code": code or None,
        "piscfh_label": PISCFH_LABELS.get(code),
        "investor_class": classification.get("excel_investor_class"),
        "portal_role_class": portal_role_class,
        "classification_version": classification.get("version"),
        "classification_rule": classification.get("rule"),
        "classification_confidence": classification.get("confidence"),
        "classification_status": piscfh.get("link_status") or piscfh.get("assignment_status") or "UNCLASSIFIED",
        "classification_review_status": "confirmed" if code else "review",
        "classification_source_file": classification.get("authority_file"),
        "classification_source_sha256": classification.get("authority_sha256"),
        "classification_source_sheet": classification.get("authority_sheet"),
        "classification_source_rows": classification.get("authority_rows") or [],
        "classification_evidence": classification,
    }


def rm_fields(prefix: str, assignment: dict, people: dict) -> dict:
    role_key = {"primary": "primaryRmId", "backup": "backupRmId", "sponsor": "sponsorRmId"}[prefix]
    person_id = assignment.get(role_key)
    person = people.get(person_id) or {}
    updated = (assignment.get("updatedAtByRole") or {}).get(prefix)
    return {
        f"{prefix}_rm_id": person_id,
        f"{prefix}_rm_name": person.get("name"),
        f"{prefix}_rm_title": person.get("executive_rank") or person.get("job_title"),
        f"{prefix}_rm_org": person.get("primary_org"),
        f"{prefix}_rm_updated_at": updated,
    }


def build_profiles(source: dict) -> list[dict]:
    profiles = []
    for account_id in sorted(source["assignments"]):
        account = source["accounts"][account_id]
        assignment = source["assignments"][account_id]
        profile = {
            "snapshot_version": SNAPSHOT_VERSION,
            "source_snapshot_id": source["snapshot_id"],
            "source_snapshot_date": SOURCE_SNAPSHOT_DATE,
            "account_id": account_id,
            "canonical_account_name": account["display_name"],
            "account_category": account.get("category"),
            "account_roles": account.get("roles") or [],
            "aliases": account.get("aliases") or [],
            "merged_from_account_ids": account.get("merged_from_account_ids") or [],
            "split_from_account_id": account.get("split_from_account_id"),
            "entity_resolution_status": account.get("entity_resolution_status"),
            "validation_status": account.get("validation_status"),
            "portal_party_link_status": "unresolved",
            "portal_party_count": 0,
            "rm_status": "draft",
            "rm_is_confirmed": False,
            "rm_assignment_source": "ONE_ACCOUNT_MAP_v1.6 sharedTeamState; provisional",
            "source_file": "ONE_ACCOUNT_MAP_v1_6_RM_JS_260909.html",
            "source_sha256": source["source_sha256"],
        }
        profile.update(relationship_classification(account))
        for prefix in ("primary", "backup", "sponsor"):
            profile.update(rm_fields(prefix, assignment, source["people"]))
        profiles.append(profile)
    return profiles


def build_party_bridge(profiles: list[dict], source: dict, live: dict[str, list[dict]]):
    party_by_id = {row["party_id"]: row for row in live["party_master"]}
    master_index: dict[str, set[str]] = defaultdict(set)
    alias_index: dict[str, set[str]] = defaultdict(set)
    for row in live["party_master"]:
        master_index[normalize_name(row.get("display_name"))].add(row["party_id"])
    for row in live["party_aliases"]:
        alias_index[normalize_name(row.get("alias_name"))].add(row["party_id"])
    existing_by_account: dict[str, list[dict]] = defaultdict(list)
    for row in live["one_account_party_bridge"]:
        existing_by_account[row["account_id"]].append(row)

    bridge: list[dict] = []
    mapping_report: list[dict] = []
    bridge_rows_by_account: dict[str, list[dict]] = defaultdict(list)
    profile_by_account = {row["account_id"]: row for row in profiles}
    for account_id in sorted(profile_by_account):
        profile = profile_by_account[account_id]
        account = source["accounts"][account_id]
        canonical_key = normalize_name(profile["canonical_account_name"])
        existing_rows = existing_by_account.get(account_id, [])
        canonical_matches = set(master_index.get(canonical_key, set()))
        if existing_rows:
            party_ids = {row["party_id"] for row in existing_rows if row["party_id"] in party_by_id}
            method = "existing_one_account_bridge"
        elif canonical_matches:
            party_ids = set(canonical_matches)
            method = "canonical_exact"
        else:
            party_ids: set[str] = set()
            for name in alias_names(account):
                key = normalize_name(name)
                if not key:
                    continue
                party_ids.update(master_index.get(key, set()))
                party_ids.update(alias_index.get(key, set()))
            method = "verified_account_alias_exact" if party_ids else "unresolved"

        primary_candidates = [
            row["party_id"] for row in existing_rows
            if row.get("is_primary") and row["party_id"] in party_ids
        ]
        if not primary_candidates:
            primary_candidates = sorted(canonical_matches & party_ids)
        primary = sorted(primary_candidates or party_ids)[:1]
        review_required = any(
            marker in str(account.get(field) or "").upper()
            for field in ("entity_resolution_status", "validation_status")
            for marker in ("REVIEW_REQUIRED", "UNRESOLVED", "CONFLICT")
        )
        resolution_status = "review" if review_required else "confirmed"
        resolution_basis = " | ".join(filter(None, [
            str(account.get("entity_resolution_status") or ""),
            str(account.get("validation_status") or ""),
            method,
        ]))
        for party_id in sorted(party_ids):
            row = {
                "snapshot_version": SNAPSHOT_VERSION,
                "source_snapshot_date": SOURCE_SNAPSHOT_DATE,
                "account_id": account_id,
                "canonical_account_name": profile["canonical_account_name"],
                "party_id": party_id,
                "is_primary": party_id in primary,
                "resolution_method": method,
                "resolution_status": resolution_status,
                "resolution_basis": resolution_basis,
            }
            bridge.append(row)
            bridge_rows_by_account[account_id].append(row)
        mapping_report.append({
            "account_id": account_id,
            "canonical_account_name": profile["canonical_account_name"],
            "party_ids": sorted(party_ids),
            "party_names": [party_by_id[party_id].get("display_name") for party_id in sorted(party_ids)],
            "resolution_method": method,
            "resolution_status": resolution_status if party_ids else "unresolved",
        })

    party_accounts: dict[str, set[str]] = defaultdict(set)
    for row in bridge:
        party_accounts[row["party_id"]].add(row["account_id"])
    collisions = {
        party_id: sorted(account_ids)
        for party_id, account_ids in party_accounts.items()
        if len(account_ids) > 1
    }
    if collisions:
        for row in bridge:
            if row["party_id"] in collisions:
                row["resolution_status"] = "review"
        collision_accounts = {account_id for values in collisions.values() for account_id in values}
    else:
        collision_accounts = set()

    for profile in profiles:
        rows = bridge_rows_by_account.get(profile["account_id"], [])
        profile["portal_party_count"] = len(rows)
        if not rows:
            profile["portal_party_link_status"] = "unresolved"
        elif profile["account_id"] in collision_accounts or any(row["resolution_status"] == "review" for row in rows):
            profile["portal_party_link_status"] = "review"
        else:
            profile["portal_party_link_status"] = "linked"
    return bridge, mapping_report, collisions


def fetch_optional(client: PostgrestClient, table: str, select: str = "*") -> list[dict]:
    try:
        return client.fetch_all(table, select)
    except RuntimeError as error:
        if "(404)" in str(error) or "PGRST205" in str(error):
            return []
        raise


def load_live(client: PostgrestClient) -> dict[str, list[dict]]:
    return {
        "party_master": client.fetch_all("party_master", "party_id,display_name,party_origin"),
        "party_aliases": client.fetch_all("party_aliases", "party_id,alias_name"),
        "one_account_party_bridge": fetch_optional(client, "one_account_party_bridge"),
        "one_account_profile": fetch_optional(client, "one_account_profile"),
        "one_account_profile_party_bridge": fetch_optional(client, "one_account_profile_party_bridge"),
        "party_exposure_external_current_v1": client.fetch_all(
            "party_exposure_external_current_v1", "party_id,party_name,role_type,role_class,role_subtype,committed_amt"
        ),
        "delegated_beneficiary_lookthrough_fact": fetch_optional(
            client, "delegated_beneficiary_lookthrough_fact", "source_snapshot_date,committed_amt"
        ),
    }


def direct_contract(rows: list[dict]) -> dict:
    return {
        "rows": len(rows),
        "beneficiary_rows": sum(row.get("role_type") == "beneficiary" for row in rows),
        "lender_rows": sum(row.get("role_type") == "lender" for row in rows),
        "beneficiary_committed": sum(
            int(row.get("committed_amt") or 0) for row in rows if row.get("role_type") == "beneficiary"
        ),
        "lender_committed": sum(
            int(row.get("committed_amt") or 0) for row in rows if row.get("role_type") == "lender"
        ),
    }


def recordset(rows: list[dict], schema: str) -> str:
    raw = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    if "$oa75$" in raw:
        raise RuntimeError("Unexpected SQL delimiter in payload")
    return f"jsonb_to_recordset($oa75${raw}$oa75$::jsonb) as row({schema})"


PROFILE_SCHEMA = """
snapshot_version text,source_snapshot_id text,source_snapshot_date date,account_id text,
canonical_account_name text,account_category text,account_roles text[],aliases jsonb,
merged_from_account_ids text[],split_from_account_id text,entity_resolution_status text,
validation_status text,piscfh_code text,piscfh_label text,investor_class text,
portal_role_class text,classification_version text,classification_rule text,
classification_confidence text,classification_status text,classification_review_status text,
classification_source_file text,classification_source_sha256 text,classification_source_sheet text,
classification_source_rows jsonb,classification_evidence jsonb,portal_party_link_status text,
portal_party_count integer,primary_rm_id text,primary_rm_name text,primary_rm_title text,
primary_rm_org text,primary_rm_updated_at timestamptz,backup_rm_id text,backup_rm_name text,
backup_rm_title text,backup_rm_org text,backup_rm_updated_at timestamptz,sponsor_rm_id text,
sponsor_rm_name text,sponsor_rm_title text,sponsor_rm_org text,sponsor_rm_updated_at timestamptz,
rm_status text,rm_is_confirmed boolean,rm_assignment_source text,source_file text,source_sha256 text
""".replace("\n", "")

BRIDGE_SCHEMA = """
snapshot_version text,source_snapshot_date date,account_id text,canonical_account_name text,
party_id text,is_primary boolean,resolution_method text,resolution_status text,resolution_basis text
""".replace("\n", "")


def data_sql(profiles: list[dict], bridge: list[dict]) -> str:
    return f"""
delete from public.one_account_profile_party_bridge where snapshot_version = '{SNAPSHOT_VERSION}';
delete from public.one_account_profile where snapshot_version = '{SNAPSHOT_VERSION}';

insert into public.one_account_profile (
  snapshot_version,source_snapshot_id,source_snapshot_date,account_id,canonical_account_name,
  account_category,account_roles,aliases,merged_from_account_ids,split_from_account_id,
  entity_resolution_status,validation_status,piscfh_code,piscfh_label,investor_class,
  portal_role_class,classification_version,classification_rule,classification_confidence,
  classification_status,classification_review_status,classification_source_file,
  classification_source_sha256,classification_source_sheet,classification_source_rows,
  classification_evidence,portal_party_link_status,portal_party_count,primary_rm_id,
  primary_rm_name,primary_rm_title,primary_rm_org,primary_rm_updated_at,backup_rm_id,
  backup_rm_name,backup_rm_title,backup_rm_org,backup_rm_updated_at,sponsor_rm_id,
  sponsor_rm_name,sponsor_rm_title,sponsor_rm_org,sponsor_rm_updated_at,rm_status,
  rm_is_confirmed,rm_assignment_source,source_file,source_sha256
)
select
  snapshot_version,source_snapshot_id,source_snapshot_date,account_id,canonical_account_name,
  account_category,account_roles,aliases,merged_from_account_ids,split_from_account_id,
  entity_resolution_status,validation_status,piscfh_code,piscfh_label,investor_class,
  portal_role_class,classification_version,classification_rule,classification_confidence,
  classification_status,classification_review_status,classification_source_file,
  classification_source_sha256,classification_source_sheet,classification_source_rows,
  classification_evidence,portal_party_link_status,portal_party_count,primary_rm_id,
  primary_rm_name,primary_rm_title,primary_rm_org,primary_rm_updated_at,backup_rm_id,
  backup_rm_name,backup_rm_title,backup_rm_org,backup_rm_updated_at,sponsor_rm_id,
  sponsor_rm_name,sponsor_rm_title,sponsor_rm_org,sponsor_rm_updated_at,rm_status,
  rm_is_confirmed,rm_assignment_source,source_file,source_sha256
from {recordset(profiles, PROFILE_SCHEMA)};

insert into public.one_account_profile_party_bridge (
  snapshot_version,source_snapshot_date,account_id,canonical_account_name,party_id,
  is_primary,resolution_method,resolution_status,resolution_basis
)
select snapshot_version,source_snapshot_date,account_id,canonical_account_name,party_id,
  is_primary,resolution_method,resolution_status,resolution_basis
from {recordset(bridge, BRIDGE_SCHEMA)};

do $verify$
declare failures integer;
begin
  select count(*) into failures from (
    select 1 where (select count(*) from public.one_account_profile where snapshot_version = '{SNAPSHOT_VERSION}') <> {EXPECTED_ACCOUNT_COUNT}
    union all select 1 where exists (
      select 1 from public.one_account_profile where snapshot_version = '{SNAPSHOT_VERSION}'
      and (primary_rm_id is null or backup_rm_id is null or sponsor_rm_id is null)
    )
    union all select 1 where exists (
      select 1 from public.one_account_profile where snapshot_version = '{SNAPSHOT_VERSION}'
      and (rm_status <> 'draft' or rm_is_confirmed)
    )
    union all select 1 where (select count(*) from public.one_account_profile_party_bridge where snapshot_version = '{SNAPSHOT_VERSION}') <> {len(bridge)}
    union all select 1 where exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'one_account_portal_party_bridge_current_v1'
        and column_name like '%rm%'
    )
  ) invalid;
  if failures <> 0 then
    raise exception 'One Account RM75 verification failures: %', failures;
  end if;
end
$verify$;
notify pgrst, 'reload schema';
"""


def migration_body(path: Path) -> str:
    sql = path.read_text(encoding="utf-8-sig").strip()
    sql = re.sub(r"^\s*begin\s*;", "", sql, count=1, flags=re.I)
    sql = re.sub(r"commit\s*;\s*$", "", sql, count=1, flags=re.I)
    return sql


def projected_direct_changes(profiles: list[dict], bridge: list[dict], direct_rows: list[dict]) -> dict:
    profile_by_account = {row["account_id"]: row for row in profiles}
    profile_by_party = {
        row["party_id"]: profile_by_account[row["account_id"]]
        for row in bridge
        if row["account_id"] in profile_by_account
    }
    changed = []
    transitions = Counter()
    for row in direct_rows:
        if row.get("role_type") != "beneficiary":
            continue
        profile = profile_by_party.get(row.get("party_id"))
        if not profile or row.get("role_class") == profile["portal_role_class"]:
            continue
        transition = f"{row.get('role_class') or '미분류'} -> {profile['portal_role_class']}"
        transitions[transition] += 1
        changed.append({
            "party_id": row.get("party_id"),
            "party_name": row.get("party_name"),
            "from_role_class": row.get("role_class"),
            "to_role_class": profile["portal_role_class"],
            "to_role_subtype": profile.get("investor_class") or profile.get("piscfh_label"),
            "committed_amt": int(row.get("committed_amt") or 0),
        })
    return {
        "rows": len(changed),
        "parties": len({row["party_id"] for row in changed}),
        "committed_amt": sum(row["committed_amt"] for row in changed),
        "transitions": dict(sorted(transitions.items())),
        "samples": changed[:20],
    }


def payload_summary(
    profiles: list[dict],
    bridge: list[dict],
    mapping_report: list[dict],
    collisions: dict,
    direct_changes: dict,
) -> dict:
    return {
        "profile_rows": len(profiles),
        "bridge_rows": len(bridge),
        "linked_accounts": sum(row["portal_party_link_status"] == "linked" for row in profiles),
        "review_accounts": sum(row["portal_party_link_status"] == "review" for row in profiles),
        "unresolved_accounts": sum(row["portal_party_link_status"] == "unresolved" for row in profiles),
        "rm_complete_accounts": sum(
            all(row.get(f"{role}_rm_id") for role in ("primary", "backup", "sponsor"))
            for row in profiles
        ),
        "rm_confirmed_accounts": sum(bool(row["rm_is_confirmed"]) for row in profiles),
        "piscfh_codes": dict(sorted(Counter(row.get("piscfh_code") or "미분류" for row in profiles).items())),
        "portal_role_classes": dict(sorted(Counter(row["portal_role_class"] for row in profiles).items())),
        "investor_classes": dict(sorted(Counter(row.get("investor_class") or "미분류" for row in profiles).items())),
        "unresolved": [row for row in mapping_report if not row["party_ids"]],
        "party_account_collisions": collisions,
        "projected_direct_beneficiary_changes": direct_changes,
    }


def save_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def verify_live(client: PostgrestClient, baseline_contract: dict, expected_bridge_rows: int) -> dict:
    last_error = None
    for attempt in range(8):
        try:
            profiles = client.fetch_all("one_account_profile")
            bridge = client.fetch_all("one_account_profile_party_bridge")
            safe_bridge = client.fetch_all("one_account_portal_party_bridge_current_v1")
            delegated = client.fetch_all("one_account_delegated_exposure_current_v1")
            direct = client.fetch_all("party_exposure_external_current_v1", "party_id,role_type,committed_amt")
            result = {
                "profile_rows_for_snapshot": sum(row.get("snapshot_version") == SNAPSHOT_VERSION for row in profiles),
                "bridge_rows_for_snapshot": sum(row.get("snapshot_version") == SNAPSHOT_VERSION for row in bridge),
                "safe_bridge_rows": len(safe_bridge),
                "safe_bridge_rm_columns": sorted({key for row in safe_bridge for key in row if "rm" in key.lower()}),
                "safe_bridge_classified_rows": sum(bool(row.get("portal_role_class")) for row in safe_bridge),
                "delegated_rows": len(delegated),
                "direct_contract_unchanged": direct_contract(direct) == baseline_contract,
                "direct_contract": direct_contract(direct),
                "rm_complete_accounts": sum(
                    row.get("snapshot_version") == SNAPSHOT_VERSION
                    and all(row.get(f"{role}_rm_id") for role in ("primary", "backup", "sponsor"))
                    for row in profiles
                ),
                "rm_confirmed_accounts": sum(
                    row.get("snapshot_version") == SNAPSHOT_VERSION and bool(row.get("rm_is_confirmed"))
                    for row in profiles
                ),
            }
            result["ok"] = (
                result["profile_rows_for_snapshot"] == EXPECTED_ACCOUNT_COUNT
                and result["bridge_rows_for_snapshot"] == expected_bridge_rows
                and not result["safe_bridge_rm_columns"]
                and result["rm_complete_accounts"] == EXPECTED_ACCOUNT_COUNT
                and result["rm_confirmed_accounts"] == 0
                and result["direct_contract_unchanged"]
            )
            return result
        except RuntimeError as error:
            last_error = error
            time.sleep(1 + attempt)
    raise RuntimeError(f"Post-apply verification failed after schema reload retries: {last_error}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True, help="One Account v1.6 RM HTML path")
    parser.add_argument("--env-file", type=Path, required=True, help="RA Dashboard .env path")
    parser.add_argument("--migration", type=Path, default=DEFAULT_MIGRATION)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--rehearse", action="store_true", help="Execute and roll back migration plus data")
    mode.add_argument("--apply", action="store_true", help="Persist migration plus data")
    args = parser.parse_args()

    source = parse_source(args.source)
    env = read_env(args.env_file)
    client = PostgrestClient(str(env["SUPABASE_URL"]), str(env["SUPABASE_KEY"]))
    live = load_live(client)
    baseline = direct_contract(live["party_exposure_external_current_v1"])
    profiles = build_profiles(source)
    bridge, mapping_report, collisions = build_party_bridge(profiles, source, live)
    direct_changes = projected_direct_changes(
        profiles, bridge, live["party_exposure_external_current_v1"]
    )
    summary = payload_summary(profiles, bridge, mapping_report, collisions, direct_changes)
    mode_name = "apply" if args.apply else ("rehearse" if args.rehearse else "dry-run")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = {
        "mode": mode_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_file": args.source.name,
        "source_sha256": source["source_sha256"],
        "source_snapshot_id": source["snapshot_id"],
        "snapshot_version": SNAPSHOT_VERSION,
        "source_snapshot_date": SOURCE_SNAPSHOT_DATE,
        "baseline_direct_contract": baseline,
        "summary": summary,
        "mapping_report": mapping_report,
    }
    report_path = args.output_dir / f"{timestamp}_{mode_name}.json"

    if not args.rehearse and not args.apply:
        save_json(report_path, report)
        print(json.dumps({"report": str(report_path), "summary": summary}, ensure_ascii=False, indent=2))
        return 0

    sql = "begin;\n" + migration_body(args.migration) + "\n" + data_sql(profiles, bridge)
    if args.rehearse:
        management_sql(sql + "\nrollback;", env)
        post = load_live(client)
        report["rehearsal"] = {
            "rolled_back": True,
            "profile_rows_unchanged": len(post["one_account_profile"]) == len(live["one_account_profile"]),
            "bridge_rows_unchanged": len(post["one_account_profile_party_bridge"]) == len(live["one_account_profile_party_bridge"]),
            "direct_contract_unchanged": direct_contract(post["party_exposure_external_current_v1"]) == baseline,
        }
        report["ok"] = all(report["rehearsal"].values())
    else:
        backup_dir = args.output_dir / f"{timestamp}_before"
        for name, rows in live.items():
            save_json(backup_dir / f"{name}.json", rows)
        management_sql(sql + "\ncommit;", env)
        report["verification"] = verify_live(client, baseline, len(bridge))
        report["backup_dir"] = str(backup_dir)
        report["ok"] = report["verification"]["ok"]

    save_json(report_path, report)
    print(json.dumps({"report": str(report_path), "summary": summary, "ok": report.get("ok")}, ensure_ascii=False, indent=2))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
