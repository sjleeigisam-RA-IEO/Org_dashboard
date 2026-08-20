import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(repoRoot, "outputs", "beneficiary_category_cleanup_20260813");
const envText = await fs.readFile(path.join(repoRoot, ".env"), "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['\"]|['\"]$/g, "")];
    }),
);

if (!env.SUPABASE_TOKEN || !env.SUPABASE_URL) throw new Error("Supabase management credentials are missing");
const projectRef = new URL(env.SUPABASE_URL).hostname.split(".")[0];

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`Supabase query failed (${response.status}): ${await response.text()}`);
  return response.json();
}

const backup = JSON.parse(await fs.readFile(path.join(outputDir, "beneficiary_exposures_preapply_backup.json"), "utf8"));
const backupTotals = backup.reduce((totals, row) => ({
  committedAmt: totals.committedAmt + Number(row.committed_amt || 0),
  investedAmt: totals.investedAmt + Number(row.invested_amt || 0),
  remainingAmt: totals.remainingAmt + Number(row.remaining_amt || 0),
}), { committedAmt: 0, investedAmt: 0, remainingAmt: 0 });

const [contract, metadata, mixedNames, totals, correctedExamples, triggerTest] = await Promise.all([
  query("select * from public.beneficiary_category_contract_audit;"),
  query(`
    select
      (select count(*)::int from public.beneficiary_category_dictionary) as dictionary_count,
      (select count(*)::int from public.beneficiary_category_source_map) as source_map_count,
      (select count(*)::int from public.beneficiary_classification_master) as master_count,
      (select count(*)::int from public.beneficiary_classification_master where review_status = 'review') as review_name_count,
      (select count(*)::int from pg_trigger where tgname = 'beneficiary_category_contract_trigger' and tgenabled <> 'D') as enabled_trigger_count,
      (select count(*)::int from pg_trigger where tgname = 'beneficiary_classification_master_sync_trigger' and tgenabled <> 'D') as enabled_master_sync_trigger_count,
      (select count(*)::int from pg_trigger where tgname = 'beneficiary_category_dictionary_sync_trigger' and tgenabled <> 'D') as enabled_dictionary_sync_trigger_count,
      (select count(*)::int from pg_constraint where conrelid = 'public.beneficiary_exposures'::regclass
        and conname like 'beneficiary_exposures_beneficiary_%' and convalidated) as validated_constraint_count;
  `),
  query(`
    select beneficiary_clean, array_agg(distinct beneficiary_cat order by beneficiary_cat) as categories
    from public.beneficiary_exposures
    group by beneficiary_clean
    having count(distinct beneficiary_cat) > 1;
  `),
  query(`
    select count(*)::int as row_count,
           coalesce(sum(committed_amt), 0)::bigint as committed_amt,
           coalesce(sum(invested_amt), 0)::bigint as invested_amt,
           coalesce(sum(remaining_amt), 0)::bigint as remaining_amt
    from public.beneficiary_exposures;
  `),
  query(`
    select beneficiary_clean, array_agg(distinct beneficiary_cat_source order by beneficiary_cat_source) as source_categories,
           min(beneficiary_cat) as beneficiary_cat, min(beneficiary_class) as beneficiary_class,
           min(beneficiary_cat_basis) as classification_basis,
           min(beneficiary_cat_review_status) as review_status
    from public.beneficiary_exposures
    where beneficiary_clean in (
      '이지스자산운용', '신한투자증권', '신협중앙회', '신용협동조합중앙회',
      '엠디엠플러스', '넥슨코리아', '개인(정석우)', '448-3호',
      '이지스인컴앤그로스 2-4-4호', '성담솔트베이'
    )
    group by beneficiary_clean
    order by beneficiary_clean;
  `),
  query(`
    begin;
    do $contract_test$
    declare
      selected_fund text;
      classified_row record;
    begin
      select fund_id into selected_fund from public.funds where fund_id is not null limit 1;

      insert into public.beneficiary_exposures (
        fund_id, beneficiary_raw, beneficiary_clean, beneficiary_cat,
        committed_amt, invested_amt, remaining_amt, base_date
      ) values (
        selected_fund, '신협중앙회', '신협중앙회', '조합', 0, 0, 0, current_date
      ) returning * into classified_row;
      if classified_row.beneficiary_cat_source <> '조합'
         or classified_row.beneficiary_cat <> '상호금융'
         or classified_row.beneficiary_class <> '금융기관'
         or classified_row.beneficiary_cat_review_status <> 'confirmed' then
        raise exception 'Exact master trigger test failed: %', row_to_json(classified_row);
      end if;

      insert into public.beneficiary_exposures (
        fund_id, beneficiary_raw, beneficiary_clean, beneficiary_cat,
        committed_amt, invested_amt, remaining_amt, base_date
      ) values (
        selected_fund, '__분류계약_신규보험사__', '__분류계약_신규보험사__', '보험사', 0, 0, 0, current_date
      ) returning * into classified_row;
      if classified_row.beneficiary_cat_source <> '보험사'
         or classified_row.beneficiary_cat <> '보험사'
         or classified_row.beneficiary_class <> '금융기관'
         or classified_row.beneficiary_cat_method <> 'source_category' then
        raise exception 'Source fallback trigger test failed: %', row_to_json(classified_row);
      end if;

      insert into public.beneficiary_exposures (
        fund_id, beneficiary_raw, beneficiary_clean,
        committed_amt, invested_amt, remaining_amt, base_date
      ) values (
        selected_fund, '__분류계약_신규미확인__', '__분류계약_신규미확인__', 0, 0, 0, current_date
      ) returning * into classified_row;
      if classified_row.beneficiary_cat <> '미분류'
         or classified_row.beneficiary_class <> '미분류'
         or classified_row.beneficiary_cat_review_status <> 'review' then
        raise exception 'Unresolved fallback trigger test failed: %', row_to_json(classified_row);
      end if;

      update public.beneficiary_classification_master
      set beneficiary_cat = '은행', classification_basis = 'rollback sync test'
      where beneficiary_key = public.normalize_beneficiary_key('신협중앙회');
      select * into classified_row
      from public.beneficiary_exposures
      where beneficiary_clean = '신협중앙회'
      limit 1;
      if classified_row.beneficiary_cat <> '은행'
         or classified_row.beneficiary_class <> '금융기관'
         or classified_row.beneficiary_cat_basis <> 'rollback sync test' then
        raise exception 'Master sync trigger test failed: %', row_to_json(classified_row);
      end if;
    end;
    $contract_test$;
    rollback;
    select 'passed' as trigger_test;
  `),
]);

const liveTotals = totals[0];
const assertions = {
  rowCountPreserved: Number(liveTotals.row_count) === backup.length,
  committedAmtPreserved: Number(liveTotals.committed_amt) === backupTotals.committedAmt,
  investedAmtPreserved: Number(liveTotals.invested_amt) === backupTotals.investedAmt,
  remainingAmtPreserved: Number(liveTotals.remaining_amt) === backupTotals.remainingAmt,
  allNamesMapped: Number(contract[0].master_unmatched_rows) === 0,
  controlledCategoriesValid: Number(contract[0].invalid_controlled_category_rows) === 0,
  oneCategoryPerName: mixedNames.length === 0,
  triggerPassed: triggerTest[0]?.trigger_test === "passed",
  triggerEnabled: Number(metadata[0].enabled_trigger_count) === 1,
  masterSyncTriggerEnabled: Number(metadata[0].enabled_master_sync_trigger_count) === 1,
  dictionarySyncTriggerEnabled: Number(metadata[0].enabled_dictionary_sync_trigger_count) === 1,
  constraintsValidated: Number(metadata[0].validated_constraint_count) >= 4,
};

const publicApiKey = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_KEY;
let restRead = { skipped: true, reason: "A public Supabase API key is not configured" };
if (publicApiKey) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/beneficiary_exposures?select=id,beneficiary_cat_source,beneficiary_cat,beneficiary_class,beneficiary_cat_review_status&limit=1`, {
    headers: { apikey: publicApiKey, Authorization: `Bearer ${publicApiKey}` },
  });
  restRead = { status: response.status, ok: response.ok, body: await response.text() };
  assertions.restColumnsExposed = response.ok;
}

if (Object.values(assertions).some((value) => value !== true)) {
  throw new Error(`Contract verification failed: ${JSON.stringify(assertions)}`);
}

const result = {
  verifiedAt: new Date().toISOString(),
  projectRef,
  assertions,
  contractAudit: contract[0],
  metadata: metadata[0],
  backupTotals,
  liveTotals,
  correctedExamples,
  restRead,
};
await fs.writeFile(path.join(outputDir, "beneficiary_category_contract_verification.json"), JSON.stringify(result, null, 2), "utf8");
console.log(JSON.stringify(result, null, 2));
