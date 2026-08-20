-- Controlled domestic/global origin contract for equity investors and lenders.
-- Raw source classifications remain unchanged; party_origin is an interpreted axis.

begin;

create or replace function public.infer_party_origin(p_name text, p_category text default null)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when nullif(btrim(coalesce(p_name, '')), '') is null then '확인 필요'
    when coalesce(p_name, '') ~* '^(비공개|미정|투자자[0-9]*|기관투자자|우리|I[.]?O[.]?IV|미확인 투자자)$'
      then '확인 필요'
    when coalesce(p_category, '') = '해외기관' then '해외'
    when coalesce(p_name, '') ~* '(^|[^A-Z])(GIC|BLACKSTONE|MORGAN[[:space:]]+STANLEY|INVESCO|ACTIS|NUVEEN|HSBC|M[&]G)([^A-Z]|$)'
      then '해외'
    when coalesce(p_name, '') ~* '(PTE[.]?[[:space:]]*LTD|PRIVATE[[:space:]]+LIMITED|S[.]?[[:space:]]*A[.]?[[:space:]]*R[.]?[[:space:]]*L|B[.]?[[:space:]]*V[.]?|C[.]?[[:space:]]*V[.]?|SICAV|BERMUDA|[[:space:]]LIMITED[.]?$)'
      then '해외'
    when coalesce(p_name, '') ~* '^개인[(][A-Z]' then '해외'
    when coalesce(p_name, '') ~ '[가-힣]' then '국내'
    else '확인 필요'
  end;
$$;

create or replace function public.infer_party_country_code(p_name text, p_origin text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when coalesce(p_origin, '') = '국내' then 'KR'
    when coalesce(p_name, '') ~* '(^|[^A-Z])GIC([^A-Z]|$)|PTE[.]?[[:space:]]*LTD|PRIVATE[[:space:]]+LIMITED' then 'SG'
    when coalesce(p_name, '') ~* 'S[.]?[[:space:]]*A[.]?[[:space:]]*R[.]?[[:space:]]*L|SICAV|SIF' then 'LU'
    when coalesce(p_name, '') ~* 'B[.]?[[:space:]]*V[.]?|C[.]?[[:space:]]*V[.]?' then 'NL'
    when coalesce(p_name, '') ~* 'BERMUDA' then 'BM'
    when coalesce(p_name, '') ~* 'BLACKSTONE|MORGAN[[:space:]]+STANLEY|INVESCO|NUVEEN' then 'US'
    when coalesce(p_name, '') ~* 'ACTIS|HSBC|M[&]G' then 'GB'
    else null
  end;
$$;

alter table public.beneficiary_classification_master
  add column if not exists party_origin text not null default '확인 필요',
  add column if not exists domicile_country_code text,
  add column if not exists origin_basis text not null default '국적 단서 부족',
  add column if not exists origin_confidence numeric(4, 3) not null default 0.300,
  add column if not exists origin_review_status text not null default 'review';

alter table public.party_master
  add column if not exists party_origin text not null default '확인 필요',
  add column if not exists domicile_country_code text,
  add column if not exists origin_basis text not null default '국적 단서 부족',
  add column if not exists origin_confidence numeric(4, 3) not null default 0.300,
  add column if not exists origin_review_status text not null default 'review';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'beneficiary_classification_master_origin_check'
      and conrelid = 'public.beneficiary_classification_master'::regclass
  ) then
    alter table public.beneficiary_classification_master
      add constraint beneficiary_classification_master_origin_check
      check (party_origin in ('국내', '해외', '확인 필요'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'beneficiary_classification_master_origin_confidence_check'
      and conrelid = 'public.beneficiary_classification_master'::regclass
  ) then
    alter table public.beneficiary_classification_master
      add constraint beneficiary_classification_master_origin_confidence_check
      check (origin_confidence between 0 and 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'beneficiary_classification_master_origin_review_check'
      and conrelid = 'public.beneficiary_classification_master'::regclass
  ) then
    alter table public.beneficiary_classification_master
      add constraint beneficiary_classification_master_origin_review_check
      check (origin_review_status in ('confirmed', 'review'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'party_master_origin_check'
      and conrelid = 'public.party_master'::regclass
  ) then
    alter table public.party_master
      add constraint party_master_origin_check
      check (party_origin in ('국내', '해외', '확인 필요'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'party_master_origin_confidence_check'
      and conrelid = 'public.party_master'::regclass
  ) then
    alter table public.party_master
      add constraint party_master_origin_confidence_check
      check (origin_confidence between 0 and 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'party_master_origin_review_check'
      and conrelid = 'public.party_master'::regclass
  ) then
    alter table public.party_master
      add constraint party_master_origin_review_check
      check (origin_review_status in ('confirmed', 'review'));
  end if;
end;
$$;

update public.beneficiary_classification_master master
set
  party_origin = public.infer_party_origin(master.canonical_name, master.beneficiary_cat),
  domicile_country_code = public.infer_party_country_code(
    master.canonical_name,
    public.infer_party_origin(master.canonical_name, master.beneficiary_cat)
  ),
  origin_basis = case
    when master.beneficiary_cat = '해외기관' then '통제 세부분류 해외기관'
    when public.infer_party_origin(master.canonical_name, master.beneficiary_cat) = '해외' then '해외 기관명 또는 법인형태 단서'
    when public.infer_party_origin(master.canonical_name, master.beneficiary_cat) = '국내' then '국내 명칭 단서'
    else '국적 단서 부족'
  end,
  origin_confidence = case
    when master.beneficiary_cat = '해외기관' then 0.980
    when public.infer_party_origin(master.canonical_name, master.beneficiary_cat) = '해외' then 0.900
    when public.infer_party_origin(master.canonical_name, master.beneficiary_cat) = '국내' then 0.850
    else 0.300
  end,
  origin_review_status = case
    when public.infer_party_origin(master.canonical_name, master.beneficiary_cat) = '확인 필요' then 'review'
    else 'confirmed'
  end,
  updated_at = now();

insert into public.beneficiary_classification_master (
  beneficiary_key, beneficiary_name, canonical_name, beneficiary_cat,
  source_categories, source_types, classification_basis,
  classification_confidence, classification_method, review_status, notes,
  party_origin, domicile_country_code, origin_basis,
  origin_confidence, origin_review_status, updated_at
) values (
  public.normalize_beneficiary_key('GIC'), 'GIC', 'GIC', '해외기관',
  array[]::text[], array[]::text[], 'GIC: 싱가포르 국부펀드',
  1.000, 'explicit_name', 'confirmed', 'Government of Singapore Investment Corporation 계열 기관투자자',
  '해외', 'SG', '확정 명칭 사전: 싱가포르 국부펀드',
  1.000, 'confirmed', now()
)
on conflict (beneficiary_key) do update set
  canonical_name = excluded.canonical_name,
  beneficiary_cat = excluded.beneficiary_cat,
  classification_basis = excluded.classification_basis,
  classification_confidence = excluded.classification_confidence,
  classification_method = excluded.classification_method,
  review_status = excluded.review_status,
  notes = excluded.notes,
  party_origin = excluded.party_origin,
  domicile_country_code = excluded.domicile_country_code,
  origin_basis = excluded.origin_basis,
  origin_confidence = excluded.origin_confidence,
  origin_review_status = excluded.origin_review_status,
  updated_at = now();

update public.beneficiary_exposures
set
  beneficiary_cat = '해외기관',
  beneficiary_class = '기관',
  beneficiary_cat_basis = 'GIC: 싱가포르 국부펀드',
  beneficiary_cat_confidence = 1.000,
  beneficiary_cat_review_status = 'confirmed'
where public.normalize_beneficiary_key(coalesce(beneficiary_clean, beneficiary_raw)) = public.normalize_beneficiary_key('GIC');

create or replace function public.sync_party_master_from_beneficiary_master()
returns trigger
language plpgsql
as $$
declare
  resolved_class text;
begin
  select dictionary.beneficiary_class into resolved_class
  from public.beneficiary_category_dictionary dictionary
  where dictionary.beneficiary_cat = new.beneficiary_cat;

  insert into public.party_master (
    party_id, party_key, display_name, party_class, party_category,
    classification_basis, classification_confidence, classification_method,
    review_status, notes, party_origin, domicile_country_code,
    origin_basis, origin_confidence, origin_review_status, updated_at
  ) values (
    public.party_id_for_key(new.beneficiary_key), new.beneficiary_key,
    new.canonical_name, coalesce(resolved_class, '미분류'), new.beneficiary_cat,
    new.classification_basis, new.classification_confidence,
    'beneficiary_contract:' || new.classification_method,
    new.review_status, new.notes, new.party_origin, new.domicile_country_code,
    new.origin_basis, new.origin_confidence, new.origin_review_status, now()
  )
  on conflict (party_key) do update set
    display_name = excluded.display_name,
    party_class = excluded.party_class,
    party_category = excluded.party_category,
    classification_basis = excluded.classification_basis,
    classification_confidence = excluded.classification_confidence,
    classification_method = excluded.classification_method,
    review_status = excluded.review_status,
    notes = excluded.notes,
    party_origin = excluded.party_origin,
    domicile_country_code = excluded.domicile_country_code,
    origin_basis = excluded.origin_basis,
    origin_confidence = excluded.origin_confidence,
    origin_review_status = excluded.origin_review_status,
    updated_at = now();

  return new;
end;
$$;

update public.party_master party
set
  party_origin = public.infer_party_origin(party.display_name, party.party_category),
  domicile_country_code = public.infer_party_country_code(
    party.display_name,
    public.infer_party_origin(party.display_name, party.party_category)
  ),
  origin_basis = case
    when party.party_category = '해외기관' then '통제 세부분류 해외기관'
    when public.infer_party_origin(party.display_name, party.party_category) = '해외' then '해외 기관명 또는 법인형태 단서'
    when public.infer_party_origin(party.display_name, party.party_category) = '국내' then '국내 명칭 단서'
    else '국적 단서 부족'
  end,
  origin_confidence = case
    when party.party_category = '해외기관' then 0.980
    when public.infer_party_origin(party.display_name, party.party_category) = '해외' then 0.900
    when public.infer_party_origin(party.display_name, party.party_category) = '국내' then 0.850
    else 0.300
  end,
  origin_review_status = case
    when public.infer_party_origin(party.display_name, party.party_category) = '확인 필요' then 'review'
    else 'confirmed'
  end,
  updated_at = now();

update public.party_master party
set
  party_class = dictionary.beneficiary_class,
  party_category = master.beneficiary_cat,
  classification_basis = master.classification_basis,
  classification_confidence = master.classification_confidence,
  classification_method = 'beneficiary_contract:' || master.classification_method,
  review_status = master.review_status,
  notes = master.notes,
  party_origin = master.party_origin,
  domicile_country_code = master.domicile_country_code,
  origin_basis = master.origin_basis,
  origin_confidence = master.origin_confidence,
  origin_review_status = master.origin_review_status,
  updated_at = now()
from public.beneficiary_classification_master master
join public.beneficiary_category_dictionary dictionary
  on dictionary.beneficiary_cat = master.beneficiary_cat
where party.party_key = master.beneficiary_key;

insert into public.party_aliases (
  alias_id, party_id, alias_name, alias_key, source_table, confidence
)
select
  'pal_' || substr(md5(concat_ws('|', party.party_id, public.normalize_party_key(alias.alias_name), 'party_origin_contract')), 1, 24),
  party.party_id,
  alias.alias_name,
  public.normalize_party_key(alias.alias_name),
  'party_origin_contract',
  1.000
from public.party_master party
cross join lateral (
  values ('싱가포르투자청'::text), ('Government of Singapore Investment Corporation'::text)
) alias(alias_name)
where party.party_key = public.normalize_party_key('GIC')
on conflict (party_id, alias_key, source_table) do update set
  alias_name = excluded.alias_name,
  confidence = excluded.confidence;

create index if not exists beneficiary_classification_master_origin_idx
  on public.beneficiary_classification_master (party_origin, domicile_country_code, origin_review_status);
create index if not exists party_master_origin_idx
  on public.party_master (party_origin, domicile_country_code, origin_review_status);

create or replace view public.party_exposure_analysis_fact_v2 as
select
  fact.*,
  party.party_origin,
  party.domicile_country_code,
  party.origin_basis,
  party.origin_confidence,
  party.origin_review_status,
  coalesce((
    select array_agg(distinct alias.alias_name order by alias.alias_name)
    from public.party_aliases alias
    where alias.party_id = fact.party_id
  ), array[]::text[]) as party_aliases
from public.party_exposure_analysis_fact_v1 fact
join public.party_master party on party.party_id = fact.party_id;

create or replace view public.party_exposure_rankings_v2 as
select
  ranking.*,
  party.party_origin,
  party.domicile_country_code,
  party.origin_basis,
  party.origin_confidence,
  party.origin_review_status,
  coalesce((
    select array_agg(distinct alias.alias_name order by alias.alias_name)
    from public.party_aliases alias
    where alias.party_id = ranking.party_id
  ), array[]::text[]) as party_aliases
from public.party_exposure_rankings_v1 ranking
join public.party_master party on party.party_id = ranking.party_id;

create or replace view public.party_exposure_facets_v2 as
select * from public.party_exposure_facets_v1
union all
select
  fact.role_type,
  'party_origin'::text as facet_name,
  fact.party_origin as facet_value,
  count(distinct fact.exposure_uid)::int as exposure_count,
  count(distinct fact.party_id)::int as party_count,
  count(distinct fact.fund_id)::int as fund_count,
  coalesce(sum(fact.committed_amt), 0)::bigint as committed_amt,
  coalesce(sum(fact.invested_amt), 0)::bigint as invested_amt,
  coalesce(sum(fact.drawn_amt), 0)::bigint as drawn_amt,
  coalesce(sum(fact.remaining_amt), 0)::bigint as remaining_amt,
  coalesce(sum(fact.primary_amount), 0)::bigint as primary_amount
from public.party_exposure_analysis_fact_v2 fact
group by fact.role_type, fact.party_origin;

create or replace view public.party_origin_contract_audit as
with totals as (
  select
    role_type,
    count(*)::int as exposure_rows,
    coalesce(sum(committed_amt), 0)::bigint as committed_amt,
    coalesce(sum(primary_amount), 0)::bigint as primary_amount,
    coalesce(sum(remaining_amt), 0)::bigint as remaining_amt
  from public.party_exposure_analysis_fact_v2
  group by role_type
),
origin_totals as (
  select
    role_type,
    count(*)::int as exposure_rows,
    coalesce(sum(committed_amt), 0)::bigint as committed_amt,
    coalesce(sum(primary_amount), 0)::bigint as primary_amount,
    coalesce(sum(remaining_amt), 0)::bigint as remaining_amt
  from public.party_exposure_analysis_fact_v2
  group by role_type, party_origin
),
origin_grand as (
  select
    role_type,
    sum(exposure_rows)::int as exposure_rows,
    sum(committed_amt)::bigint as committed_amt,
    sum(primary_amount)::bigint as primary_amount,
    sum(remaining_amt)::bigint as remaining_amt
  from origin_totals
  group by role_type
)
select
  (select count(*)::int from public.party_master where party_origin = '국내') as domestic_party_count,
  (select count(*)::int from public.party_master where party_origin = '해외') as global_party_count,
  (select count(*)::int from public.party_master where party_origin = '확인 필요') as origin_review_party_count,
  coalesce((
    select bool_and(
      party_class = '기관'
      and party_category = '해외기관'
      and party_origin = '해외'
      and domicile_country_code = 'SG'
      and origin_review_status = 'confirmed'
    )
    from public.party_master
    where party_key = public.normalize_party_key('GIC')
  ), false) as gic_contract_valid,
  coalesce((
    select bool_and(
      totals.exposure_rows = origin_grand.exposure_rows
      and totals.committed_amt = origin_grand.committed_amt
      and totals.primary_amount = origin_grand.primary_amount
      and totals.remaining_amt = origin_grand.remaining_amt
    )
    from totals
    join origin_grand using (role_type)
  ), false) as origin_subtotals_match;

grant select on public.party_exposure_analysis_fact_v2 to anon, authenticated;
grant select on public.party_exposure_rankings_v2 to anon, authenticated;
grant select on public.party_exposure_facets_v2 to anon, authenticated;
grant select on public.party_origin_contract_audit to anon, authenticated;

comment on column public.party_master.party_origin is
  'Interpreted domicile axis: 국내, 해외, 확인 필요. Equity UI renders this as 국내 LP or 글로벌 LP.';
comment on view public.party_exposure_analysis_fact_v2 is
  'v1 exposure grain plus controlled party domicile/origin fields; amounts remain one row per exposure.';
comment on view public.party_origin_contract_audit is
  'GIC classification and domestic/global subtotal reconciliation checks.';

commit;
