import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(repoRoot, "outputs", "party_exposure_analysis_20260813");
const jsonOutputPath = path.join(outputDir, "contract_verification.json");
const markdownOutputPath = path.join(outputDir, "contract_verification.md");

const REQUIRED_RELATIONS = [
  "party_master",
  "party_role_memberships",
  "party_exposure_current_v1",
  "party_exposure_analysis_fact_v1",
  "party_exposure_rankings_v1",
  "party_exposure_contract_audit",
];

const SOURCE_RELATIONS = ["beneficiary_exposures", "lender_exposures"];
const CONTROLLED_CLASSES = ["기관", "금융기관", "일반기업", "개인", "펀드·리츠·SPC", "미분류"];
const CONTROLLED_ROLES = ["beneficiary", "lender"];

const ROLE_CONFIG = {
  beneficiary: {
    label: "에쿼티 투자자",
    activeMetric: "investedAmt",
    metricLabels: {
      committedAmt: "약정액",
      investedAmt: "투입액",
      remainingAmt: "미투입액",
    },
  },
  lender: {
    label: "대주",
    activeMetric: "drawnAmt",
    metricLabels: {
      committedAmt: "약정액",
      drawnAmt: "실행액",
      remainingAmt: "미실행액",
    },
  },
};

const COLUMN_CANDIDATES = {
  role: ["role", "party_role", "role_type", "exposure_role"],
  exposureId: ["exposure_id", "source_exposure_id", "exposure_key", "id"],
  partyId: ["party_id", "counterparty_id"],
  partyClass: ["party_class", "beneficiary_class", "classification_class", "class_name"],
  committedAmt: ["committed_amt", "total_committed_amt", "committed_amount", "total_committed_amount"],
  investedAmt: [
    "invested_amt",
    "total_invested_amt",
    "invested_amount",
    "total_invested_amount",
    "active_amt",
    "total_active_amt",
  ],
  drawnAmt: [
    "drawn_amt",
    "total_drawn_amt",
    "drawn_amount",
    "total_drawn_amount",
    "executed_amt",
    "active_amt",
    "total_active_amt",
  ],
  remainingAmt: ["remaining_amt", "total_remaining_amt", "remaining_amount", "total_remaining_amount"],
};

const ASSET_FACET_NAME_PATTERN = /(?:^|_)(?:asset|country|city|region|location|portfolio|business_stage|usage|physical|kind|sector|strategy)(?:_|$)/i;
const FACET_JSON_CANDIDATES = ["asset_facets", "asset_attributes", "asset_facet_values", "facets"];
const FACET_EXCLUDED_COLUMNS = new Set([
  "asset_id",
  "primary_asset_id",
  "representative_asset_id",
  "asset_count",
  "asset_relation_count",
]);

function parseEnv(text) {
  return Object.fromEntries(
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index).trim(),
          line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
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

function columnRef(alias, columnName) {
  return `${alias}.${quoteIdent(columnName)}`;
}

function normalizedRoleSql(alias, columnName) {
  return `lower(btrim(${columnRef(alias, columnName)}::text))`;
}

function numericSql(alias, columnName) {
  return `coalesce(${columnRef(alias, columnName)}::numeric, 0::numeric)`;
}

function asInteger(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asAmount(value) {
  if (value === null || value === undefined || value === "") return "0";
  return String(value).replace(/\.0+$/, "");
}

function amountEquals(left, right) {
  try {
    return BigInt(asAmount(left)) === BigInt(asAmount(right));
  } catch {
    return Number(left ?? 0) === Number(right ?? 0);
  }
}

function formatAmount(value) {
  try {
    return BigInt(asAmount(value)).toLocaleString("ko-KR");
  } catch {
    return String(value ?? 0);
  }
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function addAssertion(result, id, description, passed, details = {}) {
  result.assertions.push({ id, description, passed: passed === true, details });
}

function indexRowsByRole(rows) {
  return Object.fromEntries(rows.map((row) => [String(row.role), row]));
}

function metricsForRole(role) {
  return role === "beneficiary"
    ? ["committedAmt", "investedAmt", "remainingAmt"]
    : ["committedAmt", "drawnAmt", "remainingAmt"];
}

function sqlMetricAlias(logicalName) {
  return {
    committedAmt: "committed_amt",
    investedAmt: "invested_amt",
    drawnAmt: "drawn_amt",
    remainingAmt: "remaining_amt",
  }[logicalName];
}

function normalizeTotalsRow(row = {}) {
  return {
    role: row.role ?? null,
    rowCount: asInteger(row.row_count),
    exposureCount: asInteger(row.exposure_count),
    partyCount: asInteger(row.party_count),
    committedAmt: asAmount(row.committed_amt),
    investedAmt: asAmount(row.invested_amt),
    drawnAmt: asAmount(row.drawn_amt),
    remainingAmt: asAmount(row.remaining_amt),
  };
}

function totalsMatch(left, right, role) {
  return metricsForRole(role).every((metric) => amountEquals(left?.[metric], right?.[metric]));
}

function resolveColumn(columnsByRelation, relationName, logicalName, required = true) {
  const columns = columnsByRelation.get(relationName) ?? [];
  const candidates = COLUMN_CANDIDATES[logicalName] ?? [];
  const match = candidates.find((candidate) => columns.some((column) => column.column_name === candidate));
  if (!match && required) {
    throw new Error(
      `${relationName} is missing the ${logicalName} column. Expected one of: ${candidates.join(", ")}`,
    );
  }
  return match ?? null;
}

function relationContract(columnsByRelation, relationName, options = {}) {
  const contract = {
    role: resolveColumn(columnsByRelation, relationName, "role", options.role !== false),
    exposureId: resolveColumn(columnsByRelation, relationName, "exposureId", options.exposureId !== false),
    partyId: resolveColumn(columnsByRelation, relationName, "partyId", options.partyId !== false),
    partyClass: resolveColumn(columnsByRelation, relationName, "partyClass", false),
  };

  if (options.amounts !== false) {
    contract.committedAmt = resolveColumn(columnsByRelation, relationName, "committedAmt");
    contract.investedAmt = resolveColumn(columnsByRelation, relationName, "investedAmt");
    contract.drawnAmt = resolveColumn(columnsByRelation, relationName, "drawnAmt");
    contract.remainingAmt = resolveColumn(columnsByRelation, relationName, "remainingAmt");
  }

  return contract;
}

function normalizedFactCte(relationName, contract, alias = "src") {
  return `
    select
      ${alias}.*,
      ${normalizedRoleSql(alias, contract.role)} as __role,
      ${columnRef(alias, contract.exposureId)}::text as __exposure_id,
      ${columnRef(alias, contract.partyId)}::text as __party_id,
      ${numericSql(alias, contract.committedAmt)} as __committed_amt,
      ${numericSql(alias, contract.investedAmt)} as __invested_amt,
      ${numericSql(alias, contract.drawnAmt)} as __drawn_amt,
      ${numericSql(alias, contract.remainingAmt)} as __remaining_amt
    from public.${quoteIdent(relationName)} ${alias}
  `;
}

function totalsQuery(relationName, contract) {
  return `
    select
      ${normalizedRoleSql("src", contract.role)} as role,
      count(*)::int as row_count,
      count(distinct ${columnRef("src", contract.exposureId)}::text)::int as exposure_count,
      count(distinct ${columnRef("src", contract.partyId)}::text)::int as party_count,
      sum(${numericSql("src", contract.committedAmt)})::text as committed_amt,
      sum(${numericSql("src", contract.investedAmt)})::text as invested_amt,
      sum(${numericSql("src", contract.drawnAmt)})::text as drawn_amt,
      sum(${numericSql("src", contract.remainingAmt)})::text as remaining_amt
    from public.${quoteIdent(relationName)} src
    group by 1
    order by 1;
  `;
}

function rankingTotalsQuery(contract) {
  return `
    select
      ${normalizedRoleSql("r", contract.role)} as role,
      count(*)::int as row_count,
      count(distinct ${columnRef("r", contract.partyId)}::text)::int as party_count,
      sum(${numericSql("r", contract.committedAmt)})::text as committed_amt,
      sum(${numericSql("r", contract.investedAmt)})::text as invested_amt,
      sum(${numericSql("r", contract.drawnAmt)})::text as drawn_amt,
      sum(${numericSql("r", contract.remainingAmt)})::text as remaining_amt
    from public.party_exposure_rankings_v1 r
    group by 1
    order by 1;
  `;
}

function classSubtotalsQuery(rankingContract, masterContract) {
  const classExpression = rankingContract.partyClass
    ? `coalesce(nullif(btrim(${columnRef("r", rankingContract.partyClass)}::text), ''), '미분류')`
    : `coalesce(nullif(btrim(${columnRef("p", masterContract.partyClass)}::text), ''), '미분류')`;

  return `
    select
      ${normalizedRoleSql("r", rankingContract.role)} as role,
      ${classExpression} as party_class,
      count(*)::int as ranking_row_count,
      count(distinct ${columnRef("r", rankingContract.partyId)}::text)::int as party_count,
      sum(${numericSql("r", rankingContract.committedAmt)})::text as committed_amt,
      sum(${numericSql("r", rankingContract.investedAmt)})::text as invested_amt,
      sum(${numericSql("r", rankingContract.drawnAmt)})::text as drawn_amt,
      sum(${numericSql("r", rankingContract.remainingAmt)})::text as remaining_amt
    from public.party_exposure_rankings_v1 r
    left join public.party_master p
      on ${columnRef("p", masterContract.partyId)}::text = ${columnRef("r", rankingContract.partyId)}::text
    group by 1, 2
    order by 1, 2;
  `;
}

function rawLatestTotalsQuery() {
  return `
    with beneficiary_source as (
      select
        b.*,
        max(b.base_date) over (
          partition by coalesce(b.fund_id::text, '__missing__:' || b.id::text)
        ) as latest_base_date
      from public.beneficiary_exposures b
    ),
    beneficiary_latest as (
      select *
      from beneficiary_source
      where base_date is not distinct from latest_base_date
    ),
    lender_source as (
      select
        l.*,
        max(l.base_date) over (
          partition by coalesce(l.fund_id::text, '__missing__:' || l.id::text)
        ) as latest_base_date
      from public.lender_exposures l
    ),
    lender_latest as (
      select *
      from lender_source
      where base_date is not distinct from latest_base_date
    )
    select
      'beneficiary'::text as role,
      count(*)::int as row_count,
      count(distinct id)::int as exposure_count,
      sum(coalesce(committed_amt, 0)::numeric)::text as committed_amt,
      sum(coalesce(invested_amt, 0)::numeric)::text as invested_amt,
      0::numeric::text as drawn_amt,
      sum(coalesce(remaining_amt, 0)::numeric)::text as remaining_amt
    from beneficiary_latest
    union all
    select
      'lender'::text as role,
      count(*)::int as row_count,
      count(distinct id)::int as exposure_count,
      sum(coalesce(committed_amt, 0)::numeric)::text as committed_amt,
      0::numeric::text as invested_amt,
      sum(coalesce(drawn_amt, 0)::numeric)::text as drawn_amt,
      sum(coalesce(remaining_amt, 0)::numeric)::text as remaining_amt
    from lender_latest
    order by role;
  `;
}

function sumClassRows(rows, role) {
  const selected = rows.filter((row) => row.role === role);
  const sum = {
    role,
    classCount: selected.length,
    rankingRowCount: 0,
    partyCount: 0,
    committedAmt: "0",
    investedAmt: "0",
    drawnAmt: "0",
    remainingAmt: "0",
  };

  for (const row of selected) {
    sum.rankingRowCount += asInteger(row.ranking_row_count);
    sum.partyCount += asInteger(row.party_count);
    for (const metric of ["committedAmt", "investedAmt", "drawnAmt", "remainingAmt"]) {
      const column = sqlMetricAlias(metric);
      sum[metric] = (BigInt(sum[metric]) + BigInt(asAmount(row[column]))).toString();
    }
  }
  return sum;
}

function discoverFacetDefinitions(columnsByRelation) {
  const columns = columnsByRelation.get("party_exposure_analysis_fact_v1") ?? [];
  const jsonColumns = columns.filter(
    (column) =>
      FACET_JSON_CANDIDATES.includes(column.column_name) &&
      ["json", "jsonb"].includes(String(column.udt_name).replace(/^_/, "")),
  );
  if (jsonColumns.length) {
    return jsonColumns.map((column) => ({
      columnName: column.column_name,
      mode: "json",
      dataType: column.formatted_type,
    }));
  }

  return columns
    .filter((column) => {
      if (FACET_EXCLUDED_COLUMNS.has(column.column_name)) return false;
      if (!ASSET_FACET_NAME_PATTERN.test(column.column_name)) return false;
      const isArray = String(column.udt_name).startsWith("_") || String(column.formatted_type).endsWith("[]");
      const scalarType = String(column.udt_name).replace(/^_/, "");
      const isScalar = ["text", "varchar", "bpchar", "bool", "int2", "int4", "int8", "numeric"].includes(scalarType);
      return isArray || isScalar;
    })
    .map((column) => ({
      columnName: column.column_name,
      mode:
        String(column.udt_name).startsWith("_") || String(column.formatted_type).endsWith("[]")
          ? "array"
          : "scalar",
      dataType: column.formatted_type,
    }));
}

function jsonFacetValueSql(definition) {
  const sourceColumn = `to_jsonb(f.${quoteIdent(definition.columnName)})`;
  return `
    select
      f.__role,
      f.__exposure_id,
      pair.facet_name,
      nullif(btrim(value_item.facet_value #>> '{}'), '') as facet_value
    from fact_normalized f
    cross join lateral (
      select object_pair.key::text as facet_name, object_pair.value as facet_value
      from jsonb_each(
        case when jsonb_typeof(${sourceColumn}) = 'object' then ${sourceColumn} else '{}'::jsonb end
      ) object_pair
      union all
      select array_pair.key::text as facet_name, array_pair.value as facet_value
      from jsonb_array_elements(
        case when jsonb_typeof(${sourceColumn}) = 'array' then ${sourceColumn} else '[]'::jsonb end
      ) array_item(item)
      cross join lateral jsonb_each(
        case when jsonb_typeof(array_item.item) = 'object' then array_item.item else '{}'::jsonb end
      ) array_pair
    ) pair
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(pair.facet_value) = 'array' then pair.facet_value
        else jsonb_build_array(pair.facet_value)
      end
    ) value_item(facet_value)
  `;
}

function arrayFacetValueSql(definition) {
  return `
    select
      f.__role,
      f.__exposure_id,
      ${quoteLiteral(definition.columnName)}::text as facet_name,
      nullif(btrim(facet_item.facet_value::text), '') as facet_value
    from fact_normalized f
    cross join lateral unnest(f.${quoteIdent(definition.columnName)}) facet_item(facet_value)
  `;
}

function scalarFacetValueSql(definition) {
  return `
    select
      f.__role,
      f.__exposure_id,
      ${quoteLiteral(definition.columnName)}::text as facet_name,
      nullif(btrim(f.${quoteIdent(definition.columnName)}::text), '') as facet_value
    from fact_normalized f
  `;
}

function facetVerificationQuery(analysisContract, facetDefinitions) {
  const facetParts = facetDefinitions.map((definition) => {
    if (definition.mode === "json") return jsonFacetValueSql(definition);
    if (definition.mode === "array") return arrayFacetValueSql(definition);
    return scalarFacetValueSql(definition);
  });

  if (!facetParts.length) {
    throw new Error(
      "party_exposure_analysis_fact_v1 has no discoverable asset facet column. " +
        "Expected asset_facets JSON or asset attribute array/scalar columns.",
    );
  }

  return `
    with fact_normalized as (
      ${normalizedFactCte("party_exposure_analysis_fact_v1", analysisContract)}
    ),
    raw_facet_values as (
      ${facetParts.join("\n      union all\n")}
    ),
    valid_facet_values as (
      select __role, __exposure_id, facet_name, facet_value
      from raw_facet_values
      where facet_name is not null
        and facet_value is not null
        and btrim(facet_value) <> ''
        and lower(btrim(facet_value)) not in ('null', '[]', '{}')
    ),
    facet_values as (
      select distinct __role, __exposure_id, facet_name, facet_value
      from valid_facet_values
    ),
    facet_filters as (
      select distinct __role, facet_name, facet_value
      from facet_values
    ),
    filtered_exposures as (
      select distinct
        filter.__role,
        filter.facet_name,
        filter.facet_value,
        f.__exposure_id,
        f.__committed_amt,
        f.__invested_amt,
        f.__drawn_amt,
        f.__remaining_amt
      from facet_filters filter
      join fact_normalized f on f.__role = filter.__role
      where exists (
        select 1
        from facet_values membership
        where membership.__role = filter.__role
          and membership.__exposure_id = f.__exposure_id
          and membership.facet_name = filter.facet_name
          and membership.facet_value = filter.facet_value
      )
    ),
    exists_totals as (
      select
        __role,
        facet_name,
        facet_value,
        count(*)::int as exposure_count,
        sum(__committed_amt) as committed_amt,
        sum(__invested_amt) as invested_amt,
        sum(__drawn_amt) as drawn_amt,
        sum(__remaining_amt) as remaining_amt
      from filtered_exposures
      group by __role, facet_name, facet_value
    ),
    distinct_membership_totals as (
      select
        membership.__role,
        membership.facet_name,
        membership.facet_value,
        count(*)::int as exposure_count,
        sum(f.__committed_amt) as committed_amt,
        sum(f.__invested_amt) as invested_amt,
        sum(f.__drawn_amt) as drawn_amt,
        sum(f.__remaining_amt) as remaining_amt
      from facet_values membership
      join fact_normalized f
        on f.__role = membership.__role
       and f.__exposure_id = membership.__exposure_id
      group by membership.__role, membership.facet_name, membership.facet_value
    ),
    comparisons as (
      select
        e.*,
        d.exposure_count as distinct_exposure_count,
        (
          e.exposure_count <> d.exposure_count
          or e.committed_amt <> d.committed_amt
          or e.invested_amt <> d.invested_amt
          or e.drawn_amt <> d.drawn_amt
          or e.remaining_amt <> d.remaining_amt
        ) as mismatch
      from exists_totals e
      join distinct_membership_totals d
        on d.__role = e.__role
       and d.facet_name = e.facet_name
       and d.facet_value = e.facet_value
    ),
    role_facet_rollup as (
      select
        membership.__role,
        count(*)::int as distinct_membership_count,
        sum(f.__committed_amt)::text as committed_amt,
        sum(f.__invested_amt)::text as invested_amt,
        sum(f.__drawn_amt)::text as drawn_amt,
        sum(f.__remaining_amt)::text as remaining_amt
      from facet_values membership
      join fact_normalized f
        on f.__role = membership.__role
       and f.__exposure_id = membership.__exposure_id
      group by membership.__role
    )
    select
      (select count(*)::int from valid_facet_values) as raw_membership_count,
      (select count(*)::int from facet_values) as distinct_membership_count,
      (select count(*)::int from facet_filters) as facet_filter_count,
      (select count(distinct facet_name)::int from facet_values) as facet_name_count,
      (select count(*)::int from comparisons where mismatch) as filter_mismatch_count,
      (
        select coalesce(jsonb_agg(to_jsonb(sample)), '[]'::jsonb)
        from (
          select *
          from comparisons
          where mismatch
          order by __role, facet_name, facet_value
          limit 20
        ) sample
      ) as mismatch_samples,
      (
        select coalesce(jsonb_agg(to_jsonb(rollup) order by __role), '[]'::jsonb)
        from role_facet_rollup rollup
      ) as role_facet_rollups;
  `;
}

function duplicateGrainQuery(analysisContract, rankingContract) {
  return `
    select
      (
        select count(*)::int
        from (
          select
            ${normalizedRoleSql("f", analysisContract.role)} as role,
            ${columnRef("f", analysisContract.exposureId)}::text as exposure_id
          from public.party_exposure_analysis_fact_v1 f
          group by 1, 2
          having count(*) > 1
        ) duplicates
      ) as analysis_duplicate_exposure_groups,
      (
        select coalesce(sum(duplicate_count - 1), 0)::int
        from (
          select count(*)::int as duplicate_count
          from public.party_exposure_analysis_fact_v1 f
          group by ${normalizedRoleSql("f", analysisContract.role)}, ${columnRef("f", analysisContract.exposureId)}::text
          having count(*) > 1
        ) duplicates
      ) as analysis_extra_rows,
      (
        select count(*)::int
        from (
          select
            ${normalizedRoleSql("r", rankingContract.role)} as role,
            ${columnRef("r", rankingContract.partyId)}::text as party_id
          from public.party_exposure_rankings_v1 r
          group by 1, 2
          having count(*) > 1
        ) duplicates
      ) as ranking_duplicate_role_party_groups;
  `;
}

function integrityQuery(currentContract, analysisContract, rankingContract, masterContract, membershipContract) {
  const roleList = CONTROLLED_ROLES.map(quoteLiteral).join(", ");
  const classList = CONTROLLED_CLASSES.map(quoteLiteral).join(", ");
  const currentClassCheck = currentContract.partyClass
    ? `(nullif(btrim(${columnRef("c", currentContract.partyClass)}::text), '') is null
        or btrim(${columnRef("c", currentContract.partyClass)}::text) not in (${classList}))`
    : "false";
  const rankingClassCheck = rankingContract.partyClass
    ? `(nullif(btrim(${columnRef("r", rankingContract.partyClass)}::text), '') is null
        or btrim(${columnRef("r", rankingContract.partyClass)}::text) not in (${classList}))`
    : "false";

  return `
    select
      (
        select count(*)::int
        from public.party_exposure_current_v1 c
        left join public.party_master p
          on ${columnRef("p", masterContract.partyId)}::text = ${columnRef("c", currentContract.partyId)}::text
        where ${columnRef("c", currentContract.partyId)} is null
           or ${columnRef("p", masterContract.partyId)} is null
      ) as current_orphan_party_count,
      (
        select count(*)::int
        from public.party_exposure_analysis_fact_v1 f
        left join public.party_master p
          on ${columnRef("p", masterContract.partyId)}::text = ${columnRef("f", analysisContract.partyId)}::text
        where ${columnRef("f", analysisContract.partyId)} is null
           or ${columnRef("p", masterContract.partyId)} is null
      ) as analysis_orphan_party_count,
      (
        select count(*)::int
        from public.party_exposure_rankings_v1 r
        left join public.party_master p
          on ${columnRef("p", masterContract.partyId)}::text = ${columnRef("r", rankingContract.partyId)}::text
        where ${columnRef("r", rankingContract.partyId)} is null
           or ${columnRef("p", masterContract.partyId)} is null
      ) as ranking_orphan_party_count,
      (
        select count(*)::int
        from public.party_exposure_current_v1 c
        where not exists (
          select 1
          from public.party_role_memberships m
          where ${columnRef("m", membershipContract.partyId)}::text = ${columnRef("c", currentContract.partyId)}::text
            and ${normalizedRoleSql("m", membershipContract.role)} = ${normalizedRoleSql("c", currentContract.role)}
        )
      ) as role_membership_mismatch_count,
      (
        select count(*)::int
        from public.party_master p
        where nullif(btrim(${columnRef("p", masterContract.partyClass)}::text), '') is null
           or btrim(${columnRef("p", masterContract.partyClass)}::text) not in (${classList})
      ) as invalid_master_class_count,
      (
        select count(*)::int
        from public.party_exposure_current_v1 c
        where ${currentClassCheck}
      ) as invalid_current_class_count,
      (
        select count(*)::int
        from public.party_exposure_rankings_v1 r
        where ${rankingClassCheck}
      ) as invalid_ranking_class_count,
      (
        select count(*)::int
        from public.party_exposure_current_v1 c
        where ${normalizedRoleSql("c", currentContract.role)} not in (${roleList})
      ) as invalid_current_role_count,
      (
        select count(*)::int
        from public.party_role_memberships m
        where ${normalizedRoleSql("m", membershipContract.role)} not in (${roleList})
      ) as invalid_membership_role_count,
      (
        select count(*)::int
        from (
          select ${columnRef("p", masterContract.partyId)}::text
          from public.party_master p
          group by 1
          having count(*) > 1
        ) duplicates
      ) as duplicate_party_id_groups;
  `;
}

function buildMarkdown(result) {
  const lines = [];
  const passed = result.summary?.passed === true;
  lines.push("# Party Exposure Analysis Contract Verification");
  lines.push("");
  lines.push(`- 결과: **${passed ? "PASS" : "FAIL"}**`);
  lines.push(`- 검증시각: ${result.verifiedAt}`);
  lines.push(`- Supabase project: ${result.projectRef ?? "확인 실패"}`);
  lines.push(`- Assertion: ${result.summary?.passedCount ?? 0} passed / ${result.summary?.failedCount ?? 0} failed`);
  lines.push("");

  lines.push("## Assertions");
  lines.push("");
  lines.push("| 결과 | ID | 검증 항목 |");
  lines.push("|---|---|---|");
  for (const assertion of result.assertions) {
    lines.push(
      `| ${assertion.passed ? "PASS" : "FAIL"} | ${markdownCell(assertion.id)} | ${markdownCell(assertion.description)} |`,
    );
  }
  lines.push("");

  const rawByRole = indexRowsByRole((result.rawLatestTotals ?? []).map(normalizeTotalsRow));
  const currentByRole = indexRowsByRole((result.currentTotals ?? []).map(normalizeTotalsRow));
  const rankingByRole = indexRowsByRole((result.rankingTotals ?? []).map(normalizeTotalsRow));
  if (Object.keys(rawByRole).length || Object.keys(currentByRole).length || Object.keys(rankingByRole).length) {
    lines.push("## Role Totals");
    lines.push("");
    lines.push("| 역할 | 구분 | 행/기관 | 약정액 | 투입·실행액 | 잔여액 |");
    lines.push("|---|---|---:|---:|---:|---:|");
    for (const role of CONTROLLED_ROLES) {
      const config = ROLE_CONFIG[role];
      const activeMetric = config.activeMetric;
      for (const [label, row, count] of [
        ["원천 최신", rawByRole[role], rawByRole[role]?.rowCount],
        ["current fact", currentByRole[role], currentByRole[role]?.rowCount],
        ["기관별 ranking 합계", rankingByRole[role], rankingByRole[role]?.partyCount],
      ]) {
        if (!row) continue;
        lines.push(
          `| ${config.label} | ${label} | ${count ?? 0} | ${formatAmount(row.committedAmt)} | ${formatAmount(row[activeMetric])} | ${formatAmount(row.remainingAmt)} |`,
        );
      }
    }
    lines.push("");
  }

  if (result.classSubtotals?.length) {
    lines.push("## Controlled Class Subtotals");
    lines.push("");
    lines.push("| 역할 | 대분류 | 기관 수 | 약정액 | 투입액 | 실행액 | 잔여액 |");
    lines.push("|---|---|---:|---:|---:|---:|---:|");
    for (const row of result.classSubtotals) {
      lines.push(
        `| ${markdownCell(ROLE_CONFIG[row.role]?.label ?? row.role)} | ${markdownCell(row.party_class)} | ${asInteger(row.party_count)} | ${formatAmount(row.committed_amt)} | ${formatAmount(row.invested_amt)} | ${formatAmount(row.drawn_amt)} | ${formatAmount(row.remaining_amt)} |`,
      );
    }
    lines.push("");
  }

  if (result.facetVerification) {
    lines.push("## Asset Facet Distinct-Exposure Check");
    lines.push("");
    lines.push(`- 검증 필터 조합: ${asInteger(result.facetVerification.facet_filter_count)}`);
    lines.push(`- facet 종류: ${asInteger(result.facetVerification.facet_name_count)}`);
    lines.push(`- 원시 membership: ${asInteger(result.facetVerification.raw_membership_count)}`);
    lines.push(`- distinct exposure membership: ${asInteger(result.facetVerification.distinct_membership_count)}`);
    lines.push(`- 중복 집계 불일치: ${asInteger(result.facetVerification.filter_mismatch_count)}`);
    lines.push("");
    lines.push(
      "> 자산 facet별 금액을 서로 더하면 동일 exposure가 여러 facet에 속하므로 전체 금액과 같을 필요가 없습니다. " +
        "각 개별 필터 결과만 role + exposure_id 기준으로 한 번씩 집계했는지 검증합니다.",
    );
    lines.push("");
  }

  if (result.integrity) {
    lines.push("## Integrity Counts");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(result.integrity, null, 2));
    lines.push("```");
    lines.push("");
  }

  if (result.fatalError) {
    lines.push("## Fatal Error");
    lines.push("");
    lines.push("```");
    lines.push(result.fatalError);
    lines.push("```");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function writeReports(result) {
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(jsonOutputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    fs.writeFile(markdownOutputPath, buildMarkdown(result), "utf8"),
  ]);
}

async function main() {
  const result = {
    verifiedAt: new Date().toISOString(),
    projectRef: null,
    requiredRelations: REQUIRED_RELATIONS,
    controlledRoles: CONTROLLED_ROLES,
    controlledClasses: CONTROLLED_CLASSES,
    assertions: [],
  };

  try {
    const env = parseEnv(await fs.readFile(path.join(repoRoot, ".env"), "utf8"));
    if (!env.SUPABASE_TOKEN || !env.SUPABASE_URL) {
      throw new Error("SUPABASE_TOKEN or SUPABASE_URL is missing from .env");
    }

    const projectRef = new URL(env.SUPABASE_URL).hostname.split(".")[0];
    result.projectRef = projectRef;

    async function query(sql, label) {
      const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SUPABASE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });
      if (!response.ok) {
        throw new Error(`${label} failed (${response.status}): ${await response.text()}`);
      }
      return response.json();
    }

    const relationNames = [...SOURCE_RELATIONS, ...REQUIRED_RELATIONS];
    const relationRows = await query(
      `
        select relation_name, relation_kind
        from (
          select
            c.relname::text as relation_name,
            case c.relkind
              when 'r' then 'table'
              when 'p' then 'partitioned_table'
              when 'v' then 'view'
              when 'm' then 'materialized_view'
              else c.relkind::text
            end as relation_kind
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname in (${relationNames.map(quoteLiteral).join(", ")})
            and c.relkind in ('r', 'p', 'v', 'm')
        ) relations
        order by relation_name;
      `,
      "relation preflight",
    );

    result.relations = relationRows;
    const existingRelations = new Set(relationRows.map((row) => row.relation_name));
    const missingRelations = relationNames.filter((name) => !existingRelations.has(name));
    addAssertion(
      result,
      "required_relations_present",
      "All source and party exposure contract relations exist",
      missingRelations.length === 0,
      { missingRelations },
    );
    if (missingRelations.length) {
      throw new Error(`Required relations are missing: ${missingRelations.join(", ")}`);
    }

    const columnRows = await query(
      `
        select
          c.relname::text as relation_name,
          a.attname::text as column_name,
          format_type(a.atttypid, a.atttypmod)::text as formatted_type,
          t.typname::text as udt_name,
          a.attnum::int as ordinal_position
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
        join pg_type t on t.oid = a.atttypid
        where n.nspname = 'public'
          and c.relname in (${relationNames.map(quoteLiteral).join(", ")})
          and a.attnum > 0
          and not a.attisdropped
        order by c.relname, a.attnum;
      `,
      "column contract introspection",
    );

    const columnsByRelation = new Map();
    for (const row of columnRows) {
      if (!columnsByRelation.has(row.relation_name)) columnsByRelation.set(row.relation_name, []);
      columnsByRelation.get(row.relation_name).push(row);
    }

    const currentContract = relationContract(columnsByRelation, "party_exposure_current_v1");
    const analysisContract = relationContract(columnsByRelation, "party_exposure_analysis_fact_v1");
    const rankingContract = relationContract(columnsByRelation, "party_exposure_rankings_v1", {
      exposureId: false,
    });
    const masterContract = relationContract(columnsByRelation, "party_master", {
      role: false,
      exposureId: false,
      amounts: false,
    });
    masterContract.partyClass = resolveColumn(columnsByRelation, "party_master", "partyClass");
    const membershipContract = relationContract(columnsByRelation, "party_role_memberships", {
      exposureId: false,
      amounts: false,
    });
    const facetDefinitions = discoverFacetDefinitions(columnsByRelation);

    result.columnContract = {
      partyExposureCurrent: currentContract,
      partyExposureAnalysisFact: analysisContract,
      partyExposureRankings: rankingContract,
      partyMaster: masterContract,
      partyRoleMemberships: membershipContract,
      assetFacets: facetDefinitions,
    };

    const [rawLatestRows, currentRows, analysisRows, rankingRows, classSubtotals, duplicateRows, integrityRows, auditRows] =
      await Promise.all([
        query(rawLatestTotalsQuery(), "raw latest snapshot totals"),
        query(totalsQuery("party_exposure_current_v1", currentContract), "current fact totals"),
        query(totalsQuery("party_exposure_analysis_fact_v1", analysisContract), "analysis fact totals"),
        query(rankingTotalsQuery(rankingContract), "ranking subtotals"),
        query(classSubtotalsQuery(rankingContract, masterContract), "controlled class subtotals"),
        query(duplicateGrainQuery(analysisContract, rankingContract), "grain duplicate checks"),
        query(
          integrityQuery(
            currentContract,
            analysisContract,
            rankingContract,
            masterContract,
            membershipContract,
          ),
          "party and role integrity checks",
        ),
        query("select * from public.party_exposure_contract_audit;", "contract audit readback"),
      ]);

    const facetRows = await query(
      facetVerificationQuery(analysisContract, facetDefinitions),
      "asset facet distinct-exposure checks",
    );

    result.rawLatestTotals = rawLatestRows;
    result.currentTotals = currentRows;
    result.analysisFactTotals = analysisRows;
    result.rankingTotals = rankingRows;
    result.classSubtotals = classSubtotals;
    result.classSubtotalRollups = CONTROLLED_ROLES.map((role) => sumClassRows(classSubtotals, role));
    result.duplicateGrain = duplicateRows[0] ?? {};
    result.integrity = integrityRows[0] ?? {};
    result.facetVerification = facetRows[0] ?? {};
    result.contractAudit = auditRows;

    const rawByRole = indexRowsByRole(rawLatestRows.map(normalizeTotalsRow));
    const currentByRole = indexRowsByRole(currentRows.map(normalizeTotalsRow));
    const analysisByRole = indexRowsByRole(analysisRows.map(normalizeTotalsRow));
    const rankingByRole = indexRowsByRole(rankingRows.map(normalizeTotalsRow));
    const classByRole = indexRowsByRole(result.classSubtotalRollups);

    for (const role of CONTROLLED_ROLES) {
      const raw = rawByRole[role];
      const current = currentByRole[role];
      const analysis = analysisByRole[role];
      const ranking = rankingByRole[role];
      const classRollup = classByRole[role];

      addAssertion(
        result,
        `raw_latest_totals_match_current_${role}`,
        `${ROLE_CONFIG[role].label}: raw latest-per-fund amounts equal current fact amounts`,
        Boolean(raw && current && totalsMatch(raw, current, role)),
        { raw, current },
      );
      addAssertion(
        result,
        `raw_latest_row_count_matches_current_${role}`,
        `${ROLE_CONFIG[role].label}: raw latest-per-fund exposure rows equal current fact rows`,
        Boolean(raw && current && raw.rowCount === current.rowCount && current.rowCount === current.exposureCount),
        { rawRowCount: raw?.rowCount, currentRowCount: current?.rowCount, currentExposureCount: current?.exposureCount },
      );
      addAssertion(
        result,
        `analysis_fact_matches_current_${role}`,
        `${ROLE_CONFIG[role].label}: analysis fact preserves current fact totals and exposure grain`,
        Boolean(
          current &&
            analysis &&
            totalsMatch(current, analysis, role) &&
            current.exposureCount === analysis.exposureCount &&
            analysis.rowCount === analysis.exposureCount
        ),
        { current, analysis },
      );
      addAssertion(
        result,
        `ranking_party_subtotals_match_current_${role}`,
        `${ROLE_CONFIG[role].label}: sum of party ranking rows equals current fact total`,
        Boolean(current && ranking && totalsMatch(current, ranking, role)),
        { current, ranking },
      );
      addAssertion(
        result,
        `ranking_party_count_matches_current_${role}`,
        `${ROLE_CONFIG[role].label}: one ranking row exists for every distinct current party`,
        Boolean(current && ranking && current.partyCount === ranking.partyCount && ranking.rowCount === ranking.partyCount),
        {
          currentPartyCount: current?.partyCount,
          rankingPartyCount: ranking?.partyCount,
          rankingRowCount: ranking?.rowCount,
        },
      );
      addAssertion(
        result,
        `controlled_class_subtotals_match_current_${role}`,
        `${ROLE_CONFIG[role].label}: sum of controlled-class subtotals equals current fact total`,
        Boolean(current && classRollup && totalsMatch(current, classRollup, role)),
        { current, classRollup },
      );
    }

    const duplicateGrain = result.duplicateGrain;
    addAssertion(
      result,
      "analysis_fact_has_one_row_per_exposure",
      "Analysis fact does not multiply the same role + exposure_id",
      asInteger(duplicateGrain.analysis_duplicate_exposure_groups) === 0 &&
        asInteger(duplicateGrain.analysis_extra_rows) === 0,
      duplicateGrain,
    );
    addAssertion(
      result,
      "ranking_has_one_row_per_role_party",
      "Ranking has one row per role + party_id",
      asInteger(duplicateGrain.ranking_duplicate_role_party_groups) === 0,
      duplicateGrain,
    );

    const integrity = result.integrity;
    addAssertion(
      result,
      "party_ids_have_no_orphans",
      "Current, analysis, and ranking party_id values all resolve to party_master",
      asInteger(integrity.current_orphan_party_count) === 0 &&
        asInteger(integrity.analysis_orphan_party_count) === 0 &&
        asInteger(integrity.ranking_orphan_party_count) === 0,
      integrity,
    );
    addAssertion(
      result,
      "party_roles_match_memberships",
      "Every current fact role has a matching party_role_memberships row",
      asInteger(integrity.role_membership_mismatch_count) === 0 &&
        asInteger(integrity.invalid_current_role_count) === 0 &&
        asInteger(integrity.invalid_membership_role_count) === 0,
      integrity,
    );
    addAssertion(
      result,
      "controlled_classes_are_valid",
      "Party master, current fact, and ranking use only controlled broad classes",
      asInteger(integrity.invalid_master_class_count) === 0 &&
        asInteger(integrity.invalid_current_class_count) === 0 &&
        asInteger(integrity.invalid_ranking_class_count) === 0,
      { controlledClasses: CONTROLLED_CLASSES, ...integrity },
    );
    addAssertion(
      result,
      "party_master_ids_are_unique",
      "party_master has no duplicate party_id",
      asInteger(integrity.duplicate_party_id_groups) === 0,
      integrity,
    );

    const facetVerification = result.facetVerification;
    addAssertion(
      result,
      "asset_facet_filters_use_distinct_exposure_grain",
      "Every asset facet filter total equals a SQL EXISTS aggregation over distinct role + exposure_id",
      asInteger(facetVerification.facet_filter_count) > 0 &&
        asInteger(facetVerification.facet_name_count) > 0 &&
        asInteger(facetVerification.filter_mismatch_count) === 0,
      {
        facetDefinitions,
        rawMembershipCount: asInteger(facetVerification.raw_membership_count),
        distinctMembershipCount: asInteger(facetVerification.distinct_membership_count),
        facetFilterCount: asInteger(facetVerification.facet_filter_count),
        facetNameCount: asInteger(facetVerification.facet_name_count),
        filterMismatchCount: asInteger(facetVerification.filter_mismatch_count),
        mismatchSamples: facetVerification.mismatch_samples ?? [],
        note: "Facet subtotal sums are intentionally not asserted against the portfolio total.",
      },
    );

    addAssertion(
      result,
      "contract_audit_is_readable",
      "party_exposure_contract_audit is readable (zero rows may mean no audit findings)",
      true,
      { rowCount: auditRows.length, rows: auditRows },
    );
  } catch (error) {
    result.fatalError = errorMessage(error);
    addAssertion(
      result,
      "verification_completed_without_fatal_error",
      "Verification queries completed without a fatal error",
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

  await writeReports(result);
  console.log(JSON.stringify(result, null, 2));
  console.log(`JSON report: ${jsonOutputPath}`);
  console.log(`Markdown report: ${markdownOutputPath}`);

  if (!result.summary.passed) process.exitCode = 1;
}

await main();
