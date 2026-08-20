import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const crmBaseDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(crmBaseDir, "..");
const defaultOutputDir = path.join(repoRoot, "outputs", "party_classification_clean_contract");

const REQUIRED_RELATIONS = [
  "party_exposure_fact",
  "party_exposure_current",
  "party_exposure_commitment_current",
  "party_exposure_commitment_timeseries",
  "party_exposure_commitment_contract_audit",
  "party_identity_map",
  "party_role_classifications",
  "party_master",
  "beneficiary_exposures",
  "lender_exposures",
];

const EXPECTED_ROLES = ["beneficiary", "lender"];

const ALLOWED_ROLE_CLASSES = {
  beneficiary: ["국내LP", "해외LP", "금융기관", "일반기업", "공기업", "개인", "기타"],
  lender: [
    "은행",
    "보험",
    "증권",
    "저축은행",
    "캐피탈·여전",
    "신용협동조합",
    "새마을금고",
    "펀드·투자기구",
    "유동화SPV",
    "대주단",
    "자산운용",
    "일반기업",
    "개인",
    "기타",
    "미확인",
  ],
};

const LEGACY_RELATIONS = [
  "beneficiary_category_dictionary",
  "beneficiary_category_source_map",
  "beneficiary_classification_master",
  "party_role_memberships",
  "beneficiary_category_contract_audit",
  "beneficiary_classification_backfill_audit",
  "beneficiary_classification_review_queue",
  "beneficiary_exposures_classified",
  "party_origin_contract_audit",
  "party_exposure_current_v1",
  "party_exposure_analysis_fact_v1",
  "party_exposure_analysis_fact_v2",
  "party_exposure_facets_v1",
  "party_exposure_facets_v2",
  "party_exposure_rankings_v1",
  "party_exposure_rankings_v2",
  "party_exposure_timeseries",
];

const LEGACY_FUNCTIONS = [
  "apply_beneficiary_category_contract",
  "assign_party_id_from_exposure",
  "refresh_beneficiary_category_contract",
  "sync_beneficiary_category_dictionary",
  "sync_beneficiary_master_classification",
  "sync_party_master_from_beneficiary_master",
  "normalize_beneficiary_key",
  "infer_party_category",
  "infer_party_class",
];

const LEGACY_TRIGGERS = [
  "beneficiary_category_dictionary_sync_trigger",
  "beneficiary_classification_master_sync_trigger",
  "beneficiary_master_party_sync_trigger",
  "beneficiary_category_contract_trigger",
  "party_exposure_party_assignment_trigger",
];

const LEGACY_BENEFICIARY_COLUMNS = [
  "beneficiary_type",
  "beneficiary_cat",
  "beneficiary_cat_source",
  "beneficiary_class",
  "beneficiary_cat_basis",
  "beneficiary_cat_confidence",
  "beneficiary_cat_method",
  "beneficiary_cat_review_status",
  "beneficiary_cat_normalized_at",
];

function parseArgs(argv) {
  const options = { outputDir: defaultOutputDir, writeFiles: true, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--no-files") {
      options.writeFiles = false;
    } else if (arg === "--output-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output-dir 뒤에 경로가 필요합니다.");
      options.outputDir = path.resolve(process.cwd(), value);
      index += 1;
    } else {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node 01. RA Portal/tools/verify_party_classification_clean_contract.mjs [options]

Live Supabase의 party classification clean contract를 조회 전용 SQL로 검증합니다.

Options:
  --output-dir <path>  JSON/Markdown 출력 폴더를 지정합니다.
  --no-files           파일을 만들지 않고 콘솔에만 결과를 표시합니다.
  -h, --help           도움말을 표시합니다.

Environment (.env 또는 process.env):
  SUPABASE_PROJECT_REF 또는 SUPABASE_URL
  SUPABASE_ACCESS_TOKEN 또는 SUPABASE_TOKEN`);
}

function parseEnv(text) {
  return Object.fromEntries(
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}

async function readEnvFile() {
  try {
    return parseEnv(await fs.readFile(path.join(repoRoot, ".env"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function loadSupabaseConfig() {
  const fileEnv = await readEnvFile();
  const merged = { ...fileEnv, ...process.env };
  const supabaseUrl = merged.SUPABASE_URL?.trim();
  let projectRef = (merged.SUPABASE_PROJECT_REF || merged.SUPABASE_REF || "").trim();

  if (!projectRef && supabaseUrl) {
    try {
      projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    } catch {
      throw new Error(
        "SUPABASE_URL 형식이 올바르지 않습니다. SUPABASE_PROJECT_REF를 직접 지정하거나 URL을 확인하세요.",
      );
    }
  }

  const token = (merged.SUPABASE_ACCESS_TOKEN || merged.SUPABASE_TOKEN || "").trim();
  const missing = [];
  if (!projectRef) missing.push("SUPABASE_PROJECT_REF (또는 SUPABASE_URL)");
  if (!token) missing.push("SUPABASE_ACCESS_TOKEN (또는 SUPABASE_TOKEN)");
  if (missing.length) {
    throw new Error(
      `Supabase Management API 설정이 없습니다: ${missing.join(", ")}. ` +
        `프로세스 환경변수나 ${path.join(repoRoot, ".env")}에 설정하세요.`,
    );
  }
  if (!/^[a-z0-9-]+$/i.test(projectRef)) {
    throw new Error(`SUPABASE_PROJECT_REF 값이 올바르지 않습니다: ${projectRef}`);
  }

  return { projectRef, token };
}

function quoteIdent(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function assertReadOnlySql(sql) {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new Error("검증기는 SELECT 또는 WITH 쿼리만 실행할 수 있습니다.");
  }
  if (/;/.test(trimmed)) {
    throw new Error("검증기는 다중 SQL 문을 실행하지 않습니다.");
  }
  if (/\b(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|call|copy|do)\b/i.test(trimmed)) {
    throw new Error("조회 전용 검증기에서 변경 SQL이 감지되었습니다.");
  }
  return trimmed;
}

function createManagementClient({ projectRef, token }) {
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  return async function query(sql, label) {
    const readOnlySql = assertReadOnlySql(sql);
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: readOnlySql }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new Error(`${label}: Supabase Management API 연결에 실패했습니다. ${error.message}`);
    }

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`${label}: SQL 조회 실패 (${response.status}). ${responseText}`);
    }

    let payload;
    try {
      payload = responseText ? JSON.parse(responseText) : [];
    } catch {
      throw new Error(`${label}: Management API 응답이 JSON이 아닙니다.`);
    }

    const rows = Array.isArray(payload) ? payload : payload?.result ?? payload?.data;
    if (!Array.isArray(rows)) {
      throw new Error(`${label}: Management API 응답에서 row 배열을 찾지 못했습니다.`);
    }
    return rows;
  };
}

function columnsByRelation(rows) {
  const result = new Map();
  for (const row of rows) {
    if (!result.has(row.relation_name)) result.set(row.relation_name, []);
    result.get(row.relation_name).push(row.column_name);
  }
  return result;
}

function resolveColumn(map, relation, candidates, required = true) {
  const columns = map.get(relation) ?? [];
  const resolved = candidates.find((candidate) => columns.includes(candidate));
  if (!resolved && required) {
    throw new Error(
      `${relation}에 필요한 컬럼이 없습니다. 후보: ${candidates.join(", ")}; 실제: ${columns.join(", ")}`,
    );
  }
  return resolved ?? null;
}

function roleExpr(alias, column) {
  return `lower(btrim(${alias}.${quoteIdent(column)}::text))`;
}

function textExpr(alias, column) {
  return `nullif(btrim(${alias}.${quoteIdent(column)}::text), '')`;
}

function numericExpr(alias, column) {
  return `coalesce(${alias}.${quoteIdent(column)}::numeric, 0::numeric)`;
}

function amountContract(map, relation, roleColumn) {
  const committed = resolveColumn(map, relation, ["committed_amt", "committed_amount"]);
  const remaining = resolveColumn(map, relation, ["remaining_amt", "remaining_amount"]);
  const unifiedCurrent = resolveColumn(
    map,
    relation,
    ["current_amt", "current_amount", "active_amt", "active_amount"],
    false,
  );

  if (unifiedCurrent) {
    return {
      committed,
      remaining,
      currentColumns: [unifiedCurrent],
      currentSql: (alias) => numericExpr(alias, unifiedCurrent),
    };
  }

  const invested = resolveColumn(map, relation, ["invested_amt", "invested_amount"]);
  const drawn = resolveColumn(map, relation, ["drawn_amt", "drawn_amount", "executed_amt"]);
  return {
    committed,
    remaining,
    currentColumns: [invested, drawn],
    currentSql: (alias) =>
      `case ${roleExpr(alias, roleColumn)} ` +
      `when 'beneficiary' then ${numericExpr(alias, invested)} ` +
      `when 'lender' then ${numericExpr(alias, drawn)} else 0::numeric end`,
  };
}

function buildContract(map) {
  const fact = {
    role: resolveColumn(map, "party_exposure_fact", ["role_type", "role"]),
    baseDate: resolveColumn(map, "party_exposure_fact", ["base_date"]),
    sourceExposureId: resolveColumn(map, "party_exposure_fact", ["source_exposure_id", "exposure_id"]),
    partyId: resolveColumn(map, "party_exposure_fact", ["party_id"]),
    roleClass: resolveColumn(map, "party_exposure_fact", ["role_class"]),
  };
  fact.amounts = amountContract(map, "party_exposure_fact", fact.role);

  const current = {
    role: resolveColumn(map, "party_exposure_current", ["role_type", "role"]),
    baseDate: resolveColumn(map, "party_exposure_current", ["base_date"]),
    sourceExposureId: resolveColumn(map, "party_exposure_current", ["source_exposure_id", "exposure_id"]),
    partyId: resolveColumn(map, "party_exposure_current", ["party_id"]),
    roleClass: resolveColumn(map, "party_exposure_current", ["role_class"]),
  };
  current.amounts = amountContract(map, "party_exposure_current", current.role);

  const identity = {
    role: resolveColumn(map, "party_identity_map", ["role_type", "role"]),
    sourceNameKey: resolveColumn(map, "party_identity_map", ["source_name_key"]),
    partyId: resolveColumn(map, "party_identity_map", ["party_id"]),
  };

  const classification = {
    role: resolveColumn(map, "party_role_classifications", ["role_type", "role"]),
    partyId: resolveColumn(map, "party_role_classifications", ["party_id"]),
    roleClass: resolveColumn(map, "party_role_classifications", ["role_class"]),
    validTo: resolveColumn(map, "party_role_classifications", ["valid_to", "effective_to"], false),
    isActive: resolveColumn(map, "party_role_classifications", ["is_active"], false),
  };

  const master = {
    partyId: resolveColumn(map, "party_master", ["party_id"]),
    displayName: resolveColumn(map, "party_master", ["display_name", "party_name"]),
    partyOrigin: resolveColumn(map, "party_master", ["party_origin", "origin"]),
    countryCode: resolveColumn(map, "party_master", ["country_code", "domicile_country_code"]),
  };

  return { fact, current, identity, classification, master };
}

function activeClassificationWhere(contract, alias = "c") {
  const clauses = [];
  if (contract.validTo) clauses.push(`${alias}.${quoteIdent(contract.validTo)} is null`);
  if (contract.isActive) clauses.push(`coalesce(${alias}.${quoteIdent(contract.isActive)}::boolean, false)`);
  return clauses.length ? clauses.join(" and ") : "true";
}

function normalizedExposureCte(relation, contract, cteName = "normalized") {
  return `${cteName} as (
    select
      ${roleExpr("src", contract.role)} as role_type,
      src.${quoteIdent(contract.baseDate)}::date as base_date,
      ${textExpr("src", contract.sourceExposureId)} as source_exposure_id,
      ${textExpr("src", contract.partyId)} as party_id,
      ${textExpr("src", contract.roleClass)} as role_class,
      ${numericExpr("src", contract.amounts.committed)} as committed_amt,
      ${contract.amounts.currentSql("src")} as current_amt,
      ${numericExpr("src", contract.amounts.remaining)} as remaining_amt
    from public.${quoteIdent(relation)} src
  )`;
}

function factTotalsSql(contract) {
  return `
    with ${normalizedExposureCte("party_exposure_fact", contract)}
    select
      role_type,
      base_date::text,
      count(*)::bigint as row_count,
      coalesce(sum(committed_amt), 0)::text as committed_total,
      coalesce(sum(current_amt), 0)::text as current_total,
      coalesce(sum(remaining_amt), 0)::text as remaining_total
    from normalized
    group by role_type, base_date
    order by role_type, base_date
  `;
}

function latestClassSubtotalsSql(contract) {
  return `
    with ${normalizedExposureCte("party_exposure_fact", contract)},
    latest as (
      select role_type, max(base_date) as base_date
      from normalized
      group by role_type
    )
    select
      n.role_type,
      n.base_date::text,
      n.role_class,
      count(*)::bigint as row_count,
      coalesce(sum(n.committed_amt), 0)::text as committed_total,
      coalesce(sum(n.current_amt), 0)::text as current_total,
      coalesce(sum(n.remaining_amt), 0)::text as remaining_total
    from normalized n
    join latest l using (role_type, base_date)
    group by n.role_type, n.base_date, n.role_class
    order by n.role_type, n.role_class nulls last
  `;
}

function latestSubtotalParitySql(contract) {
  return `
    with ${normalizedExposureCte("party_exposure_fact", contract)},
    latest as (
      select role_type, max(base_date) as base_date
      from normalized
      group by role_type
    ), scope as (
      select n.*
      from normalized n
      join latest l using (role_type, base_date)
    ), totals as (
      select role_type, base_date, count(*)::numeric as row_count,
             sum(committed_amt) as committed_total,
             sum(current_amt) as current_total,
             sum(remaining_amt) as remaining_total
      from scope
      group by role_type, base_date
    ), class_subtotals as (
      select role_type, base_date, role_class, count(*)::numeric as row_count,
             sum(committed_amt) as committed_total,
             sum(current_amt) as current_total,
             sum(remaining_amt) as remaining_total
      from scope
      group by role_type, base_date, role_class
    ), rolled_up as (
      select role_type, base_date, sum(row_count) as row_count,
             sum(committed_total) as committed_total,
             sum(current_total) as current_total,
             sum(remaining_total) as remaining_total
      from class_subtotals
      group by role_type, base_date
    )
    select
      t.role_type,
      t.base_date::text,
      t.row_count::text as total_row_count,
      r.row_count::text as subtotal_row_count,
      t.committed_total::text,
      r.committed_total::text as subtotal_committed_total,
      t.current_total::text,
      r.current_total::text as subtotal_current_total,
      t.remaining_total::text,
      r.remaining_total::text as subtotal_remaining_total,
      (t.row_count = r.row_count
        and t.committed_total = r.committed_total
        and t.current_total = r.current_total
        and t.remaining_total = r.remaining_total) as exact_match
    from totals t
    join rolled_up r using (role_type, base_date)
    order by t.role_type
  `;
}

function canonicalPartyIntegritySql(contract) {
  return `
    with ${normalizedExposureCte("party_exposure_fact", contract.fact)}
    select
      count(*) filter (where n.party_id is null)::bigint as missing_party_id_count,
      count(*) filter (where n.party_id is not null and pm.${quoteIdent(contract.master.partyId)} is null)::bigint
        as orphan_party_id_count
    from normalized n
    left join public.party_master pm
      on pm.${quoteIdent(contract.master.partyId)}::text = n.party_id
  `;
}

function identityDuplicateSql(contract) {
  return `
    with normalized as (
      select
        ${roleExpr("m", contract.role)} as role_type,
        lower(${textExpr("m", contract.sourceNameKey)}) as source_name_key,
        ${textExpr("m", contract.partyId)} as party_id
      from public.party_identity_map m
    ), duplicate_groups as (
      select role_type, source_name_key, count(*)::bigint as row_count,
             array_agg(distinct party_id order by party_id) as party_ids
      from normalized
      where role_type is not null and source_name_key is not null
      group by role_type, source_name_key
      having count(*) > 1
    )
    select role_type, source_name_key, row_count, party_ids
    from duplicate_groups
    order by row_count desc, role_type, source_name_key
  `;
}

function currentDuplicateSql(contract) {
  return `
    with ${normalizedExposureCte("party_exposure_current", contract)}
    select role_type, source_exposure_id, count(*)::bigint as row_count,
           array_agg(distinct party_id order by party_id) as party_ids
    from normalized
    where role_type is not null and source_exposure_id is not null
    group by role_type, source_exposure_id
    having count(*) > 1
    order by row_count desc, role_type, source_exposure_id
  `;
}

function classificationCoverageSql(contract) {
  const activeWhere = activeClassificationWhere(contract.classification, "c");
  return `
    with ${normalizedExposureCte("party_exposure_current", contract.current, "current_fact")},
    active_classifications as (
      select
        ${roleExpr("c", contract.classification.role)} as role_type,
        ${textExpr("c", contract.classification.partyId)} as party_id,
        ${textExpr("c", contract.classification.roleClass)} as role_class
      from public.party_role_classifications c
      where ${activeWhere}
    ), current_parties as (
      select distinct role_type, party_id
      from current_fact
      where role_type is not null and party_id is not null
    ), missing as (
      select p.role_type, p.party_id
      from current_parties p
      left join active_classifications c using (role_type, party_id)
      where c.party_id is null
    ), duplicates as (
      select role_type, party_id, count(*)::bigint as row_count,
             array_agg(role_class order by role_class) as role_classes
      from active_classifications
      group by role_type, party_id
      having count(*) > 1
    ), mismatches as (
      select distinct f.role_type, f.party_id, f.role_class as fact_role_class,
             c.role_class as classification_role_class
      from current_fact f
      join active_classifications c using (role_type, party_id)
      where f.role_class is distinct from c.role_class
    )
    select
      (select count(*) from missing)::bigint as missing_count,
      (select count(*) from duplicates)::bigint as duplicate_group_count,
      (select coalesce(sum(row_count - 1), 0) from duplicates)::bigint as duplicate_extra_row_count,
      (select count(*) from mismatches)::bigint as mismatch_count,
      coalesce((select jsonb_agg(sample) from (select * from missing order by role_type, party_id limit 25) sample), '[]'::jsonb)
        as missing_samples,
      coalesce((select jsonb_agg(sample) from (select * from duplicates order by row_count desc, role_type, party_id limit 25) sample), '[]'::jsonb)
        as duplicate_samples,
      coalesce((select jsonb_agg(sample) from (select * from mismatches order by role_type, party_id limit 25) sample), '[]'::jsonb)
        as mismatch_samples
  `;
}

function legacyObjectsSql() {
  return `
    select object_type, object_name, object_detail
    from (
      select
        case c.relkind when 'r' then 'table' when 'p' then 'partitioned_table'
          when 'v' then 'view' when 'm' then 'materialized_view' else c.relkind::text end as object_type,
        c.relname::text as object_name,
        n.nspname::text as object_detail
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (${LEGACY_RELATIONS.map(quoteLiteral).join(", ")})
        and c.relkind in ('r', 'p', 'v', 'm')

      union all

      select 'function' as object_type, p.proname::text as object_name,
             pg_get_function_identity_arguments(p.oid)::text as object_detail
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (${LEGACY_FUNCTIONS.map(quoteLiteral).join(", ")})

      union all

      select 'trigger' as object_type, t.tgname::text as object_name,
             c.relname::text as object_detail
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and not t.tgisinternal
        and t.tgname in (${LEGACY_TRIGGERS.map(quoteLiteral).join(", ")})
    ) legacy
    order by object_type, object_name, object_detail
  `;
}

function legacyColumnsSql() {
  return `
    select column_name, data_type, ordinal_position
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'beneficiary_exposures'
      and (
        column_name in (${LEGACY_BENEFICIARY_COLUMNS.map(quoteLiteral).join(", ")})
        or column_name like 'beneficiary_cat_%'
      )
    order by ordinal_position
  `;
}

function allowedRoleClassSql(contract) {
  const activeWhere = activeClassificationWhere(contract.classification, "c");
  const allowedRows = Object.entries(ALLOWED_ROLE_CLASSES)
    .flatMap(([role, classes]) => classes.map((roleClass) => `(${quoteLiteral(role)}, ${quoteLiteral(roleClass)})`))
    .join(",\n        ");
  return `
    with allowed(role_type, role_class) as (
      values ${allowedRows}
    ), ${normalizedExposureCte("party_exposure_fact", contract.fact, "fact_rows")},
    classification_rows as (
      select ${roleExpr("c", contract.classification.role)} as role_type,
             ${textExpr("c", contract.classification.roleClass)} as role_class
      from public.party_role_classifications c
      where ${activeWhere}
    ), observed as (
      select 'party_exposure_fact'::text as source_name, role_type, role_class, count(*)::bigint as row_count
      from fact_rows
      group by role_type, role_class
      union all
      select 'party_role_classifications'::text, role_type, role_class, count(*)::bigint
      from classification_rows
      group by role_type, role_class
    )
    select o.source_name, o.role_type, o.role_class, o.row_count
    from observed o
    left join allowed a using (role_type, role_class)
    where a.role_type is null
    order by o.source_name, o.role_type, o.role_class nulls first
  `;
}

function gicSql(contract) {
  const activeWhere = activeClassificationWhere(contract.classification, "c");
  return `
    with identity_candidates as (
      select distinct ${textExpr("m", contract.identity.partyId)} as party_id
      from public.party_identity_map m
      where ${roleExpr("m", contract.identity.role)} = 'beneficiary'
        and lower(regexp_replace(coalesce(${textExpr("m", contract.identity.sourceNameKey)}, ''), '[^a-z0-9]+', '', 'g')) = 'gic'
      union
      select distinct ${textExpr("pm", contract.master.partyId)} as party_id
      from public.party_master pm
      where lower(regexp_replace(coalesce(${textExpr("pm", contract.master.displayName)}, ''), '[^a-z0-9]+', '', 'g')) = 'gic'
    ), active_classifications as (
      select ${textExpr("c", contract.classification.partyId)} as party_id,
             ${textExpr("c", contract.classification.roleClass)} as role_class
      from public.party_role_classifications c
      where ${activeWhere}
        and ${roleExpr("c", contract.classification.role)} = 'beneficiary'
    )
    select distinct
      ${textExpr("pm", contract.master.partyId)} as party_id,
      ${textExpr("pm", contract.master.displayName)} as display_name,
      c.role_class,
      ${textExpr("pm", contract.master.partyOrigin)} as party_origin,
      upper(${textExpr("pm", contract.master.countryCode)}) as country_code
    from identity_candidates candidate
    join public.party_master pm
      on pm.${quoteIdent(contract.master.partyId)}::text = candidate.party_id
    left join active_classifications c
      on c.party_id = candidate.party_id
    order by party_id, role_class
  `;
}

function commitmentCohortAuditSql() {
  return `
    select *
    from public.party_exposure_commitment_contract_audit
    order by role_type
  `;
}

function relationPreflightSql() {
  return `
    select c.relname::text as relation_name,
           case c.relkind when 'r' then 'table' when 'p' then 'partitioned_table'
             when 'v' then 'view' when 'm' then 'materialized_view' else c.relkind::text end as relation_kind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (${REQUIRED_RELATIONS.map(quoteLiteral).join(", ")})
      and c.relkind in ('r', 'p', 'v', 'm')
    order by c.relname
  `;
}

function columnsSql() {
  return `
    select table_name::text as relation_name, column_name::text, data_type::text, ordinal_position
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (${REQUIRED_RELATIONS.map(quoteLiteral).join(", ")})
    order by table_name, ordinal_position
  `;
}

function addAssertion(result, id, description, passed, details = {}) {
  result.assertions.push({ id, description, passed: passed === true, details });
}

function asInteger(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumeric(value) {
  const raw = String(value ?? "0").trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return raw;
  const [, sign, integer, fraction] = match;
  const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${formatted}${fraction ? `.${fraction}` : ""}`;
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function markdownTable(headers, rows) {
  if (!rows.length) return "_없음_\n";
  const lines = [
    `| ${headers.map((header) => markdownCell(header.label)).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  for (const row of rows) {
    lines.push(
      `| ${headers
        .map((header) => markdownCell(header.format ? header.format(row[header.key], row) : row[header.key]))
        .join(" | ")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function buildMarkdown(result) {
  const lines = [];
  lines.push("# Party Classification Clean Contract 검증");
  lines.push("");
  lines.push(`- 결과: **${result.summary?.passed ? "PASS" : "FAIL"}**`);
  lines.push(`- 검증 시각: ${result.verifiedAt}`);
  lines.push(`- Supabase project ref: ${result.projectRef ?? "확인 실패"}`);
  lines.push("- 실행 모드: read-only Management API SQL");
  lines.push("");

  lines.push("## 1. Fact role/date 합계");
  lines.push("");
  lines.push(
    markdownTable(
      [
        { key: "role_type", label: "role_type" },
        { key: "base_date", label: "base_date" },
        { key: "row_count", label: "rows", format: formatNumeric },
        { key: "committed_total", label: "committed", format: formatNumeric },
        { key: "current_total", label: "current", format: formatNumeric },
        { key: "remaining_total", label: "remaining", format: formatNumeric },
      ],
      result.checks?.factTotalsByRoleAndDate ?? [],
    ),
  );

  lines.push("## 2. 최신 스냅샷 role_class 부분합");
  lines.push("");
  lines.push(
    markdownTable(
      [
        { key: "role_type", label: "role_type" },
        { key: "base_date", label: "base_date" },
        { key: "role_class", label: "role_class" },
        { key: "row_count", label: "rows", format: formatNumeric },
        { key: "committed_total", label: "committed", format: formatNumeric },
        { key: "current_total", label: "current", format: formatNumeric },
        { key: "remaining_total", label: "remaining", format: formatNumeric },
      ],
      result.checks?.latestClassSubtotals ?? [],
    ),
  );
  lines.push("### 부분합 대 전체합 정확 일치");
  lines.push("");
  lines.push(
    markdownTable(
      [
        { key: "role_type", label: "role_type" },
        { key: "base_date", label: "base_date" },
        { key: "total_row_count", label: "total rows", format: formatNumeric },
        { key: "subtotal_row_count", label: "subtotal rows", format: formatNumeric },
        { key: "committed_total", label: "total committed", format: formatNumeric },
        { key: "subtotal_committed_total", label: "subtotal committed", format: formatNumeric },
        { key: "current_total", label: "total current", format: formatNumeric },
        { key: "subtotal_current_total", label: "subtotal current", format: formatNumeric },
        { key: "remaining_total", label: "total remaining", format: formatNumeric },
        { key: "subtotal_remaining_total", label: "subtotal remaining", format: formatNumeric },
        { key: "exact_match", label: "exact" },
      ],
      result.checks?.latestSubtotalParity ?? [],
    ),
  );

  lines.push("## 3-9. 무결성 및 정리 상태");
  lines.push("");
  const integrityRows = [
    ["canonical party_id 누락", result.checks?.canonicalPartyIdIntegrity?.missing_party_id_count],
    ["canonical party_id orphan", result.checks?.canonicalPartyIdIntegrity?.orphan_party_id_count],
    ["identity map 중복 group", result.checks?.identityMapDuplicates?.length],
    ["current source exposure 중복 group", result.checks?.currentExposureDuplicates?.length],
    ["role classification 누락", result.checks?.roleClassification?.missing_count],
    ["role classification 중복 group", result.checks?.roleClassification?.duplicate_group_count],
    ["legacy public object", result.checks?.legacyPublicObjects?.length],
    ["legacy beneficiary column", result.checks?.legacyBeneficiaryColumns?.length],
    ["허용 외 role_class group", result.checks?.invalidRoleClasses?.length],
  ].map(([check, count]) => ({ check, count: asInteger(count) }));
  lines.push(markdownTable([{ key: "check", label: "검사" }, { key: "count", label: "건수" }], integrityRows));

  lines.push("### GIC 계약");
  lines.push("");
  lines.push(
    markdownTable(
      [
        { key: "party_id", label: "party_id" },
        { key: "display_name", label: "display_name" },
        { key: "role_class", label: "role_class" },
        { key: "party_origin", label: "party_origin" },
        { key: "country_code", label: "country_code" },
      ],
      result.checks?.gic ?? [],
    ),
  );

  const detailSections = [
    ["Identity map 중복", result.checks?.identityMapDuplicates],
    ["Current exposure 중복", result.checks?.currentExposureDuplicates],
    ["Legacy public objects", result.checks?.legacyPublicObjects],
    ["Legacy beneficiary columns", result.checks?.legacyBeneficiaryColumns],
    ["허용 외 role_class", result.checks?.invalidRoleClasses],
  ];
  for (const [title, rows] of detailSections) {
    if (!rows?.length) continue;
    lines.push(`### ${title}`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(rows, null, 2));
    lines.push("```");
    lines.push("");
  }

  lines.push("## Assertions");
  lines.push("");
  lines.push(
    markdownTable(
      [
        { key: "passed", label: "상태", format: (value) => (value ? "PASS" : "FAIL") },
        { key: "id", label: "검증 ID" },
        { key: "description", label: "설명" },
      ],
      result.assertions ?? [],
    ),
  );

  if (result.fatalError) {
    lines.push("## Fatal error");
    lines.push("");
    lines.push("```");
    lines.push(result.fatalError);
    lines.push("```");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function writeReports(result, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "verification.json");
  const markdownPath = path.join(outputDir, "verification.md");
  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    fs.writeFile(markdownPath, buildMarkdown(result), "utf8"),
  ]);
  return { jsonPath, markdownPath };
}

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function assertionPassed(result, id) {
  return result.assertions.find((assertion) => assertion.id === id)?.passed === true;
}

function printConsole(result, reportPaths) {
  console.log("");
  console.log(`Party classification clean contract: ${result.summary.passed ? "PASS" : "FAIL"}`);
  console.log(`Project: ${result.projectRef ?? "unknown"}`);
  console.log(`Assertions: ${result.summary.passedCount}/${result.summary.assertionCount} passed`);
  for (const assertion of result.assertions) {
    console.log(`[${assertion.passed ? "PASS" : "FAIL"}] ${assertion.id}: ${assertion.description}`);
  }

  if (result.checks?.factTotalsByRoleAndDate?.length) {
    console.log("\nparty_exposure_fact totals by role_type/base_date");
    console.table(result.checks.factTotalsByRoleAndDate);
  }
  if (result.checks?.latestSubtotalParity?.length) {
    console.log("Latest snapshot class subtotal parity");
    console.table(result.checks.latestSubtotalParity);
  }
  if (result.fatalError) console.error(`\n${result.fatalError}`);
  if (reportPaths) {
    console.log(`\nJSON: ${reportPaths.jsonPath}`);
    console.log(`Markdown: ${reportPaths.markdownPath}`);
  }
}

async function runVerification(options) {
  const result = {
    contract: "party_classification_clean_contract",
    verifiedAt: new Date().toISOString(),
    executionMode: "read_only_management_api",
    projectRef: null,
    requiredRelations: REQUIRED_RELATIONS,
    expectedRoles: EXPECTED_ROLES,
    allowedRoleClasses: ALLOWED_ROLE_CLASSES,
    checks: {},
    assertions: [],
  };

  try {
    const config = await loadSupabaseConfig();
    result.projectRef = config.projectRef;
    const query = createManagementClient(config);

    const [relations, legacyPublicObjects, legacyBeneficiaryColumns] = await Promise.all([
      query(relationPreflightSql(), "clean contract relation preflight"),
      query(legacyObjectsSql(), "legacy public object audit"),
      query(legacyColumnsSql(), "legacy beneficiary column audit"),
    ]);

    result.relations = relations;
    result.checks.legacyPublicObjects = legacyPublicObjects;
    result.checks.legacyBeneficiaryColumns = legacyBeneficiaryColumns;

    const existingRelations = new Set(relations.map((row) => row.relation_name));
    const missingRelations = REQUIRED_RELATIONS.filter((relation) => !existingRelations.has(relation));
    addAssertion(
      result,
      "required_clean_contract_relations_present",
      "clean contract 필수 relation이 모두 존재",
      missingRelations.length === 0,
      { missingRelations },
    );
    addAssertion(
      result,
      "legacy_public_objects_removed",
      "기존 분류 contract의 public object 잔존 0",
      legacyPublicObjects.length === 0,
      { count: legacyPublicObjects.length, objects: legacyPublicObjects },
    );
    addAssertion(
      result,
      "legacy_beneficiary_columns_removed",
      "beneficiary_exposures legacy classification column 잔존 0",
      legacyBeneficiaryColumns.length === 0,
      { count: legacyBeneficiaryColumns.length, columns: legacyBeneficiaryColumns },
    );

    if (missingRelations.length) {
      throw new Error(`clean contract 필수 relation이 없습니다: ${missingRelations.join(", ")}`);
    }

    const columnRows = await query(columnsSql(), "clean contract column preflight");
    result.columns = columnRows;
    const contract = buildContract(columnsByRelation(columnRows));
    result.resolvedColumnContract = contract;

    const [
      factTotals,
      latestClassSubtotals,
      latestSubtotalParity,
      canonicalPartyIdIntegrityRows,
      identityMapDuplicates,
      currentExposureDuplicates,
      roleClassificationRows,
      invalidRoleClasses,
      gicRows,
      commitmentCohortAudit,
    ] = await Promise.all([
      query(factTotalsSql(contract.fact), "party_exposure_fact role/date totals"),
      query(latestClassSubtotalsSql(contract.fact), "latest role_class subtotals"),
      query(latestSubtotalParitySql(contract.fact), "latest subtotal parity"),
      query(canonicalPartyIntegritySql(contract), "canonical party_id integrity"),
      query(identityDuplicateSql(contract.identity), "identity map duplicate check"),
      query(currentDuplicateSql(contract.current), "current exposure duplicate check"),
      query(classificationCoverageSql(contract), "role classification coverage"),
      query(allowedRoleClassSql(contract), "allowed role_class check"),
      query(gicSql(contract), "GIC classification check"),
      query(commitmentCohortAuditSql(), "commitment cohort audit"),
    ]);

    result.checks.factTotalsByRoleAndDate = factTotals;
    result.checks.latestClassSubtotals = latestClassSubtotals;
    result.checks.latestSubtotalParity = latestSubtotalParity;
    result.checks.canonicalPartyIdIntegrity = canonicalPartyIdIntegrityRows[0] ?? {};
    result.checks.identityMapDuplicates = identityMapDuplicates;
    result.checks.currentExposureDuplicates = currentExposureDuplicates;
    result.checks.roleClassification = roleClassificationRows[0] ?? {};
    result.checks.invalidRoleClasses = invalidRoleClasses;
    result.checks.gic = gicRows;
    result.checks.commitmentCohortAudit = commitmentCohortAudit;

    const observedRoles = new Set(factTotals.map((row) => row.role_type));
    const missingFactRoles = EXPECTED_ROLES.filter((role) => !observedRoles.has(role));
    addAssertion(
      result,
      "fact_totals_available_by_role_and_date",
      "party_exposure_fact에서 beneficiary/lender role/date 합계 조회 가능",
      factTotals.length > 0 && missingFactRoles.length === 0,
      { rowCount: factTotals.length, missingRoles: missingFactRoles },
    );

    const parityByRole = new Map(latestSubtotalParity.map((row) => [row.role_type, row]));
    for (const role of EXPECTED_ROLES) {
      const parity = parityByRole.get(role);
      addAssertion(
        result,
        `latest_role_class_subtotals_match_${role}`,
        `${role} 최신 스냅샷 role_class 부분합이 전체합과 정확히 일치`,
        Boolean(parity && parity.exact_match === true),
        parity ?? { missing: true },
      );
    }

    const partyIntegrity = result.checks.canonicalPartyIdIntegrity;
    addAssertion(
      result,
      "canonical_party_id_complete",
      "party_exposure_fact canonical party_id 누락 및 orphan 0",
      asInteger(partyIntegrity.missing_party_id_count) === 0 &&
        asInteger(partyIntegrity.orphan_party_id_count) === 0,
      partyIntegrity,
    );
    addAssertion(
      result,
      "identity_map_role_source_key_unique",
      "party_identity_map의 동일 role/source_name_key 중복 0",
      identityMapDuplicates.length === 0,
      { duplicateGroupCount: identityMapDuplicates.length, samples: identityMapDuplicates.slice(0, 25) },
    );
    addAssertion(
      result,
      "current_role_source_exposure_unique",
      "party_exposure_current의 동일 role_type/source_exposure_id 중복 0",
      currentExposureDuplicates.length === 0,
      { duplicateGroupCount: currentExposureDuplicates.length, samples: currentExposureDuplicates.slice(0, 25) },
    );

    const roleClassification = result.checks.roleClassification;
    addAssertion(
      result,
      "role_classification_complete",
      "current party/role의 활성 role classification 누락 0",
      asInteger(roleClassification.missing_count) === 0,
      roleClassification,
    );
    addAssertion(
      result,
      "role_classification_unique",
      "party/role별 활성 role classification 중복 0",
      asInteger(roleClassification.duplicate_group_count) === 0 &&
        asInteger(roleClassification.duplicate_extra_row_count) === 0,
      roleClassification,
    );
    addAssertion(
      result,
      "role_class_values_allowed",
      "fact 및 활성 role classification의 허용 외 role_class 0",
      invalidRoleClasses.length === 0,
      { invalidGroupCount: invalidRoleClasses.length, rows: invalidRoleClasses },
    );

    const gicPartyIds = new Set(gicRows.map((row) => row.party_id).filter(Boolean));
    const gicValid =
      gicRows.length > 0 &&
      gicPartyIds.size === 1 &&
      gicRows.every(
        (row) => row.role_class === "해외LP" && row.party_origin === "해외" && row.country_code === "SG",
      );
    addAssertion(
      result,
      "gic_contract_valid",
      "GIC는 beneficiary role_class=해외LP, party_origin=해외, country_code=SG",
      gicValid,
      { canonicalPartyCount: gicPartyIds.size, rows: gicRows },
    );

    const commitmentAuditByRole = new Map(
      commitmentCohortAudit.map((row) => [row.role_type, row]),
    );
    for (const role of EXPECTED_ROLES) {
      const audit = commitmentAuditByRole.get(role);
      addAssertion(
        result,
        `commitment_cohort_basis_complete_${role}`,
        `${role} 관계 발생연도 직접일자/보정일자/미상 행이 전체와 일치`,
        Boolean(
          audit &&
          audit.date_basis_rows_match === true &&
          asInteger(audit.unresolved_date_rows) === 0 &&
          asInteger(audit.source_date_rows) > 0
        ),
        audit ?? { missing: true },
      );
      addAssertion(
        result,
        `commitment_cohort_amounts_reconcile_${role}`,
        `${role} 약정연도 시계열의 약정/현재/잔여 부분합이 전체와 정확히 일치`,
        Boolean(audit && audit.timeseries_totals_match === true),
        audit ?? { missing: true },
      );
    }
  } catch (error) {
    result.fatalError = errorMessage(error);
    addAssertion(
      result,
      "verification_completed_without_fatal_error",
      "Management API 조회와 검증 쿼리가 치명적 오류 없이 완료",
      false,
      { error: result.fatalError },
    );
  }

  const failedAssertions = result.assertions.filter((assertion) => !assertion.passed);
  result.summary = {
    passed: failedAssertions.length === 0,
    assertionCount: result.assertions.length,
    passedCount: result.assertions.length - failedAssertions.length,
    failedCount: failedAssertions.length,
    failedAssertionIds: failedAssertions.map((assertion) => assertion.id),
  };

  let reportPaths = null;
  if (options.writeFiles) reportPaths = await writeReports(result, options.outputDir);
  printConsole(result, reportPaths);

  if (result.fatalError && !result.projectRef) process.exitCode = 2;
  else if (!result.summary.passed) process.exitCode = 1;

  return result;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  console.error("--help로 사용법을 확인하세요.");
  process.exitCode = 2;
}

if (options?.help) {
  printHelp();
} else if (options) {
  await runVerification(options);
}
