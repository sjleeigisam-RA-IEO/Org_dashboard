import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(repoRoot, "outputs", "beneficiary_category_cleanup_20260813");
const migrationPath = path.join(repoRoot, "01. RA Portal", "migrations", "2026-08-13_beneficiary_category_contract.sql");
const candidates = JSON.parse(await fs.readFile(path.join(outputDir, "beneficiary_classification_candidates.json"), "utf8"));
const summary = JSON.parse(await fs.readFile(path.join(outputDir, "beneficiary_category_contract_summary.json"), "utf8"));

const categoryByName = new Map(summary.controlledCategories.map((item) => [item.categoryName, item]));
const sourceMap = Object.entries(summary.sourceCategoryMap).map(([sourceCategory, beneficiaryCat]) => ({
  sourceCategory,
  beneficiaryCat,
  beneficiaryClass: categoryByName.get(beneficiaryCat).broadClass,
  mappingBasis: `기존 원천분류 ${sourceCategory}의 통제분류 매핑`,
  confidence: 0.9,
  reviewStatus: "confirmed",
}));

for (const sourceCategory of ["기타", "고유", "미분류"]) {
  sourceMap.push({
    sourceCategory,
    beneficiaryCat: "미분류",
    beneficiaryClass: "미분류",
    mappingBasis: `${sourceCategory}는 기관 성격이 아니므로 명칭별 검토 필요`,
    confidence: 0,
    reviewStatus: "review",
  });
}

const categorySeed = summary.controlledCategories.map((item) => ({
  beneficiaryCat: item.categoryName,
  beneficiaryClass: item.broadClass,
  description: item.description,
  displayOrder: item.displayOrder,
}));

const masterSeed = candidates.map((item) => ({
  beneficiaryName: item.beneficiaryName,
  canonicalName: item.canonicalName,
  beneficiaryCat: item.beneficiaryCat,
  sourceCategories: item.sourceCategories,
  sourceTypes: item.sourceTypes,
  classificationBasis: item.classificationBasis,
  classificationConfidence: item.classificationConfidence,
  classificationMethod: item.classificationMethod,
  reviewStatus: item.reviewStatus,
}));

function dollarJson(value, tag) {
  const text = JSON.stringify(value);
  if (text.includes(`$${tag}$`)) throw new Error(`Seed data contains SQL dollar tag ${tag}`);
  return `$${tag}$${text}$${tag}$`;
}

const categoryJson = dollarJson(categorySeed, "beneficiary_categories");
const sourceMapJson = dollarJson(sourceMap, "beneficiary_source_map");
const masterJson = dollarJson(masterSeed, "beneficiary_master");

const sql = `-- Controlled beneficiary classification contract.
-- Generated from the 2026-08-13 live audit. Existing raw beneficiary_cat values
-- are retained in beneficiary_cat_source before beneficiary_cat is normalized.

begin;

create or replace function public.normalize_beneficiary_key(value text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(regexp_replace(btrim(coalesce(value, '')), '[[:space:]]+', ' ', 'g'));
$$;

create table if not exists public.beneficiary_category_dictionary (
  beneficiary_cat text primary key,
  beneficiary_class text not null,
  description text not null,
  display_order smallint not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beneficiary_category_dictionary_class_check
    check (beneficiary_class in ('기관', '금융기관', '일반기업', '개인', '펀드·리츠·SPC', '미분류'))
);

create table if not exists public.beneficiary_category_source_map (
  source_category text primary key,
  beneficiary_cat text not null references public.beneficiary_category_dictionary(beneficiary_cat),
  mapping_basis text not null,
  classification_confidence numeric(4, 3) not null default 0.9,
  review_status text not null default 'confirmed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beneficiary_category_source_map_confidence_check
    check (classification_confidence between 0 and 1),
  constraint beneficiary_category_source_map_review_check
    check (review_status in ('confirmed', 'review'))
);

create table if not exists public.beneficiary_classification_master (
  beneficiary_key text primary key,
  beneficiary_name text not null,
  canonical_name text not null,
  beneficiary_cat text not null references public.beneficiary_category_dictionary(beneficiary_cat),
  source_categories text[] not null default '{}'::text[],
  source_types text[] not null default '{}'::text[],
  classification_basis text not null,
  classification_confidence numeric(4, 3) not null,
  classification_method text not null,
  review_status text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beneficiary_classification_master_key_check
    check (beneficiary_key = public.normalize_beneficiary_key(beneficiary_name)),
  constraint beneficiary_classification_master_confidence_check
    check (classification_confidence between 0 and 1),
  constraint beneficiary_classification_master_method_check
    check (classification_method in ('explicit_name', 'name_pattern', 'source_category', 'source_conflict', 'legal_form_pattern', 'unresolved')),
  constraint beneficiary_classification_master_review_check
    check (review_status in ('confirmed', 'review'))
);

comment on table public.beneficiary_category_dictionary is
  'Controlled beneficiary detail categories and their report-level broad classes.';
comment on table public.beneficiary_category_source_map is
  'Fallback mapping for raw Excel beneficiary categories when a name is not yet registered.';
comment on table public.beneficiary_classification_master is
  'Approved per-beneficiary classification. This table outranks raw source categories.';

drop trigger if exists beneficiary_classification_master_sync_trigger
  on public.beneficiary_classification_master;
drop trigger if exists beneficiary_category_dictionary_sync_trigger
  on public.beneficiary_category_dictionary;

insert into public.beneficiary_category_dictionary (
  beneficiary_cat, beneficiary_class, description, display_order, is_active, updated_at
)
select
  item->>'beneficiaryCat',
  item->>'beneficiaryClass',
  item->>'description',
  (item->>'displayOrder')::smallint,
  true,
  now()
from jsonb_array_elements(${categoryJson}::jsonb) as item
on conflict (beneficiary_cat) do update set
  beneficiary_class = excluded.beneficiary_class,
  description = excluded.description,
  display_order = excluded.display_order,
  is_active = true,
  updated_at = now();

insert into public.beneficiary_category_source_map (
  source_category, beneficiary_cat, mapping_basis,
  classification_confidence, review_status, updated_at
)
select
  item->>'sourceCategory',
  item->>'beneficiaryCat',
  item->>'mappingBasis',
  (item->>'confidence')::numeric,
  item->>'reviewStatus',
  now()
from jsonb_array_elements(${sourceMapJson}::jsonb) as item
on conflict (source_category) do update set
  beneficiary_cat = excluded.beneficiary_cat,
  mapping_basis = excluded.mapping_basis,
  classification_confidence = excluded.classification_confidence,
  review_status = excluded.review_status,
  updated_at = now();

insert into public.beneficiary_classification_master (
  beneficiary_key, beneficiary_name, canonical_name, beneficiary_cat,
  source_categories, source_types, classification_basis,
  classification_confidence, classification_method, review_status, updated_at
)
select
  public.normalize_beneficiary_key(item->>'beneficiaryName'),
  item->>'beneficiaryName',
  item->>'canonicalName',
  item->>'beneficiaryCat',
  coalesce(array(select jsonb_array_elements_text(item->'sourceCategories')), '{}'::text[]),
  coalesce(array(select jsonb_array_elements_text(item->'sourceTypes')), '{}'::text[]),
  item->>'classificationBasis',
  (item->>'classificationConfidence')::numeric,
  item->>'classificationMethod',
  item->>'reviewStatus',
  now()
from jsonb_array_elements(${masterJson}::jsonb) as item
on conflict (beneficiary_key) do update set
  beneficiary_name = excluded.beneficiary_name,
  canonical_name = excluded.canonical_name,
  beneficiary_cat = excluded.beneficiary_cat,
  source_categories = excluded.source_categories,
  source_types = excluded.source_types,
  classification_basis = excluded.classification_basis,
  classification_confidence = excluded.classification_confidence,
  classification_method = excluded.classification_method,
  review_status = excluded.review_status,
  updated_at = now();

alter table public.beneficiary_exposures
  add column if not exists beneficiary_cat_source text,
  add column if not exists beneficiary_class text,
  add column if not exists beneficiary_cat_basis text,
  add column if not exists beneficiary_cat_confidence numeric(4, 3),
  add column if not exists beneficiary_cat_method text,
  add column if not exists beneficiary_cat_review_status text,
  add column if not exists beneficiary_cat_normalized_at timestamptz;

comment on column public.beneficiary_exposures.beneficiary_cat_source is
  'Raw source category from the exposure workbook before normalization.';
comment on column public.beneficiary_exposures.beneficiary_cat is
  'Controlled detail category resolved by beneficiary_classification_master or source fallback.';
comment on column public.beneficiary_exposures.beneficiary_class is
  'Report-level broad class: institution, financial institution, corporate, individual, vehicle, or unclassified.';

update public.beneficiary_exposures
set beneficiary_cat_source = nullif(btrim(beneficiary_cat), '')
where beneficiary_cat_source is null
  and beneficiary_cat_normalized_at is null;

update public.beneficiary_exposures as exposure
set
  beneficiary_cat = master.beneficiary_cat,
  beneficiary_class = dictionary.beneficiary_class,
  beneficiary_cat_basis = master.classification_basis,
  beneficiary_cat_confidence = master.classification_confidence,
  beneficiary_cat_method = master.classification_method,
  beneficiary_cat_review_status = master.review_status,
  beneficiary_cat_normalized_at = now()
from public.beneficiary_classification_master as master
join public.beneficiary_category_dictionary as dictionary
  on dictionary.beneficiary_cat = master.beneficiary_cat
where master.beneficiary_key = public.normalize_beneficiary_key(
  coalesce(nullif(btrim(exposure.beneficiary_clean), ''), exposure.beneficiary_raw)
);

update public.beneficiary_exposures
set
  beneficiary_cat = '미분류',
  beneficiary_class = '미분류',
  beneficiary_cat_basis = '분류 마스터 미등록',
  beneficiary_cat_confidence = 0,
  beneficiary_cat_method = 'unresolved',
  beneficiary_cat_review_status = 'review',
  beneficiary_cat_normalized_at = now()
where beneficiary_class is null;

create or replace function public.apply_beneficiary_category_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_cat text;
  resolved_class text;
  resolved_basis text;
  resolved_confidence numeric;
  resolved_method text;
  resolved_review text;
  identity_name text;
begin
  if tg_op = 'INSERT' then
    new.beneficiary_cat_source := coalesce(
      nullif(btrim(new.beneficiary_cat_source), ''),
      nullif(btrim(new.beneficiary_cat), '')
    );
  else
    new.beneficiary_cat_source := coalesce(
      nullif(btrim(new.beneficiary_cat_source), ''),
      old.beneficiary_cat_source
    );
  end if;
  identity_name := coalesce(
    nullif(btrim(new.beneficiary_clean), ''),
    nullif(btrim(new.beneficiary_raw), '')
  );

  select
    master.beneficiary_cat,
    dictionary.beneficiary_class,
    master.classification_basis,
    master.classification_confidence,
    master.classification_method,
    master.review_status
  into
    resolved_cat, resolved_class, resolved_basis,
    resolved_confidence, resolved_method, resolved_review
  from public.beneficiary_classification_master as master
  join public.beneficiary_category_dictionary as dictionary
    on dictionary.beneficiary_cat = master.beneficiary_cat
  where master.beneficiary_key = public.normalize_beneficiary_key(identity_name);

  if not found and new.beneficiary_cat_source is not null then
    select
      source_map.beneficiary_cat,
      dictionary.beneficiary_class,
      source_map.mapping_basis,
      source_map.classification_confidence,
      'source_category',
      source_map.review_status
    into
      resolved_cat, resolved_class, resolved_basis,
      resolved_confidence, resolved_method, resolved_review
    from public.beneficiary_category_source_map as source_map
    join public.beneficiary_category_dictionary as dictionary
      on dictionary.beneficiary_cat = source_map.beneficiary_cat
    where source_map.source_category = btrim(new.beneficiary_cat_source);
  end if;

  if resolved_cat is null then
    resolved_cat := '미분류';
    resolved_class := '미분류';
    resolved_basis := '분류 마스터 및 원천분류 매핑 미등록';
    resolved_confidence := 0;
    resolved_method := 'unresolved';
    resolved_review := 'review';
  end if;

  new.beneficiary_cat := resolved_cat;
  new.beneficiary_class := resolved_class;
  new.beneficiary_cat_basis := resolved_basis;
  new.beneficiary_cat_confidence := resolved_confidence;
  new.beneficiary_cat_method := resolved_method;
  new.beneficiary_cat_review_status := resolved_review;
  new.beneficiary_cat_normalized_at := now();
  return new;
end;
$$;

drop trigger if exists beneficiary_category_contract_trigger on public.beneficiary_exposures;
create trigger beneficiary_category_contract_trigger
before insert or update of beneficiary_clean, beneficiary_raw, beneficiary_cat, beneficiary_cat_source
on public.beneficiary_exposures
for each row execute function public.apply_beneficiary_category_contract();

create or replace function public.sync_beneficiary_master_classification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.beneficiary_exposures as exposure
  set beneficiary_cat = new.beneficiary_cat
  where public.normalize_beneficiary_key(
    coalesce(nullif(btrim(exposure.beneficiary_clean), ''), exposure.beneficiary_raw)
  ) = new.beneficiary_key;
  return new;
end;
$$;

create trigger beneficiary_classification_master_sync_trigger
after insert or update of beneficiary_cat, classification_basis,
  classification_confidence, classification_method, review_status
on public.beneficiary_classification_master
for each row execute function public.sync_beneficiary_master_classification();

create or replace function public.sync_beneficiary_category_dictionary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.beneficiary_exposures
  set beneficiary_cat = beneficiary_cat
  where beneficiary_cat = new.beneficiary_cat;
  return new;
end;
$$;

create trigger beneficiary_category_dictionary_sync_trigger
after update of beneficiary_class
on public.beneficiary_category_dictionary
for each row execute function public.sync_beneficiary_category_dictionary();

create or replace function public.refresh_beneficiary_category_contract()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_rows integer;
begin
  update public.beneficiary_exposures
  set beneficiary_cat = beneficiary_cat;
  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'beneficiary_exposures_beneficiary_cat_contract_fkey'
      and conrelid = 'public.beneficiary_exposures'::regclass
  ) then
    alter table public.beneficiary_exposures
      add constraint beneficiary_exposures_beneficiary_cat_contract_fkey
      foreign key (beneficiary_cat)
      references public.beneficiary_category_dictionary(beneficiary_cat)
      not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'beneficiary_exposures_beneficiary_class_check'
      and conrelid = 'public.beneficiary_exposures'::regclass
  ) then
    alter table public.beneficiary_exposures
      add constraint beneficiary_exposures_beneficiary_class_check
      check (beneficiary_class in ('기관', '금융기관', '일반기업', '개인', '펀드·리츠·SPC', '미분류'))
      not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'beneficiary_exposures_beneficiary_confidence_check'
      and conrelid = 'public.beneficiary_exposures'::regclass
  ) then
    alter table public.beneficiary_exposures
      add constraint beneficiary_exposures_beneficiary_confidence_check
      check (beneficiary_cat_confidence between 0 and 1)
      not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'beneficiary_exposures_beneficiary_review_check'
      and conrelid = 'public.beneficiary_exposures'::regclass
  ) then
    alter table public.beneficiary_exposures
      add constraint beneficiary_exposures_beneficiary_review_check
      check (beneficiary_cat_review_status in ('confirmed', 'review'))
      not valid;
  end if;
end;
$$;

alter table public.beneficiary_exposures
  validate constraint beneficiary_exposures_beneficiary_cat_contract_fkey;
alter table public.beneficiary_exposures
  validate constraint beneficiary_exposures_beneficiary_class_check;
alter table public.beneficiary_exposures
  validate constraint beneficiary_exposures_beneficiary_confidence_check;
alter table public.beneficiary_exposures
  validate constraint beneficiary_exposures_beneficiary_review_check;

create index if not exists beneficiary_classification_master_category_idx
  on public.beneficiary_classification_master (beneficiary_cat, review_status);
create index if not exists beneficiary_exposures_class_idx
  on public.beneficiary_exposures (beneficiary_class, beneficiary_cat);
create index if not exists beneficiary_exposures_review_idx
  on public.beneficiary_exposures (beneficiary_cat_review_status)
  where beneficiary_cat_review_status = 'review';

create or replace view public.beneficiary_exposures_classified as
select
  exposure.*,
  master.canonical_name as beneficiary_canonical_name,
  dictionary.description as beneficiary_cat_description,
  dictionary.display_order as beneficiary_cat_display_order
from public.beneficiary_exposures as exposure
left join public.beneficiary_classification_master as master
  on master.beneficiary_key = public.normalize_beneficiary_key(
    coalesce(nullif(btrim(exposure.beneficiary_clean), ''), exposure.beneficiary_raw)
  )
left join public.beneficiary_category_dictionary as dictionary
  on dictionary.beneficiary_cat = exposure.beneficiary_cat;

create or replace view public.beneficiary_classification_review_queue as
select
  master.beneficiary_name,
  master.canonical_name,
  master.beneficiary_cat,
  dictionary.beneficiary_class,
  master.source_categories,
  master.source_types,
  master.classification_basis,
  master.classification_confidence,
  master.classification_method,
  master.review_status,
  count(exposure.id)::int as exposure_row_count,
  count(distinct exposure.fund_id)::int as fund_count,
  coalesce(sum(exposure.invested_amt), 0)::bigint as invested_amt
from public.beneficiary_classification_master as master
join public.beneficiary_category_dictionary as dictionary
  on dictionary.beneficiary_cat = master.beneficiary_cat
left join public.beneficiary_exposures as exposure
  on master.beneficiary_key = public.normalize_beneficiary_key(
    coalesce(nullif(btrim(exposure.beneficiary_clean), ''), exposure.beneficiary_raw)
  )
where master.review_status = 'review'
group by
  master.beneficiary_name, master.canonical_name, master.beneficiary_cat,
  dictionary.beneficiary_class, master.source_categories, master.source_types,
  master.classification_basis, master.classification_confidence,
  master.classification_method, master.review_status;

create or replace view public.beneficiary_category_contract_audit as
select
  count(*)::int as exposure_row_count,
  count(distinct public.normalize_beneficiary_key(
    coalesce(nullif(btrim(exposure.beneficiary_clean), ''), exposure.beneficiary_raw)
  ))::int as beneficiary_name_count,
  count(*) filter (where exposure.beneficiary_cat_source is null)::int as source_category_missing_rows,
  count(*) filter (where exposure.beneficiary_cat_review_status = 'review')::int as review_rows,
  count(*) filter (where exposure.beneficiary_class = '미분류')::int as unclassified_rows,
  count(*) filter (where master.beneficiary_key is null)::int as master_unmatched_rows,
  count(*) filter (where dictionary.beneficiary_cat is null)::int as invalid_controlled_category_rows,
  max(exposure.beneficiary_cat_normalized_at) as last_normalized_at
from public.beneficiary_exposures as exposure
left join public.beneficiary_classification_master as master
  on master.beneficiary_key = public.normalize_beneficiary_key(
    coalesce(nullif(btrim(exposure.beneficiary_clean), ''), exposure.beneficiary_raw)
  )
left join public.beneficiary_category_dictionary as dictionary
  on dictionary.beneficiary_cat = exposure.beneficiary_cat;

grant select on public.beneficiary_category_dictionary to anon, authenticated;
grant select on public.beneficiary_category_source_map to anon, authenticated;
grant select on public.beneficiary_classification_master to anon, authenticated;
grant select on public.beneficiary_exposures_classified to anon, authenticated;
grant select on public.beneficiary_classification_review_queue to anon, authenticated;
grant select on public.beneficiary_category_contract_audit to anon, authenticated;

commit;
`;

const dryRunSql = `with candidate as (
  select
    lower(regexp_replace(btrim(coalesce(item->>'beneficiaryName', '')), '[[:space:]]+', ' ', 'g')) as beneficiary_key,
    item->>'beneficiaryCat' as beneficiary_cat,
    item->>'reviewStatus' as review_status
  from jsonb_array_elements(${masterJson}::jsonb) as item
)
select
  count(*)::int as exposure_row_count,
  count(distinct lower(regexp_replace(btrim(coalesce(nullif(btrim(e.beneficiary_clean), ''), e.beneficiary_raw, '')), '[[:space:]]+', ' ', 'g')))::int as beneficiary_name_count,
  count(*) filter (where c.beneficiary_key is null)::int as unmatched_rows,
  count(*) filter (where e.beneficiary_cat is distinct from c.beneficiary_cat)::int as rows_to_change_or_fill,
  count(distinct lower(regexp_replace(btrim(coalesce(nullif(btrim(e.beneficiary_clean), ''), e.beneficiary_raw, '')), '[[:space:]]+', ' ', 'g')))
    filter (where e.beneficiary_cat is distinct from c.beneficiary_cat)::int as names_to_change_or_fill,
  count(*) filter (where e.beneficiary_cat is null)::int as current_beneficiary_cat_null_rows,
  count(*) filter (where c.review_status = 'review')::int as review_rows_after,
  count(*) filter (where c.beneficiary_cat = '미분류')::int as unclassified_rows_after
from public.beneficiary_exposures as e
left join candidate as c
  on c.beneficiary_key = lower(regexp_replace(btrim(coalesce(nullif(btrim(e.beneficiary_clean), ''), e.beneficiary_raw, '')), '[[:space:]]+', ' ', 'g'));`;

const report = `# beneficiary_cat 정비 계약\n\n` +
  `- 생성일: ${summary.generatedAt}\n` +
  `- 분류 대상 이름: ${summary.candidateCount.toLocaleString("ko-KR")}개\n` +
  `- 확정: ${summary.confirmedCount.toLocaleString("ko-KR")}개\n` +
  `- 검토 유지: ${summary.reviewCount.toLocaleString("ko-KR")}개\n` +
  `- 기존값 변경 또는 누락 보완 후보: ${summary.changedOrFilledCount.toLocaleString("ko-KR")}개 이름\n\n` +
  `## 계약\n\n` +
  `1. \`beneficiary_cat_source\`는 엑셀 원천분류를 보존합니다.\n` +
  `2. \`beneficiary_cat\`은 통제된 세부분류만 사용합니다.\n` +
  `3. \`beneficiary_class\`는 기관/금융기관/일반기업/개인/펀드·리츠·SPC/미분류 대분류입니다.\n` +
  `4. 명칭별 마스터가 원천분류보다 우선합니다. 새 명칭은 원천분류 매핑을 사용하고, 둘 다 없으면 검토 대상으로 남깁니다.\n` +
  `5. 모든 판단에는 근거, 신뢰도, 방식, 검토상태를 남깁니다.\n\n` +
  `## 산출물\n\n` +
  `- \`beneficiary_classification_candidates.csv\`: 495개 명칭별 최종 후보\n` +
  `- \`beneficiary_classification_review.csv\`: 검토 유지 대상\n` +
  `- \`beneficiary_classification_changes.csv\`: 기존 원천과 달라지거나 누락된 대상\n` +
  `- \`2026-08-13_beneficiary_category_contract.sql\`: 재실행 가능한 DB migration\n`;

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(migrationPath, sql, "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_category_dry_run.sql"), dryRunSql, "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_category_contract.md"), report, "utf8"),
]);

console.log(JSON.stringify({
  migrationPath,
  candidateCount: masterSeed.length,
  categoryCount: categorySeed.length,
  sourceMapCount: sourceMap.length,
  sqlBytes: Buffer.byteLength(sql),
}, null, 2));
