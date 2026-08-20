-- Unified equity-investor and lender analysis contract.
--
-- Grain rules:
-- 1. party_exposure_current_v1 keeps exactly one row per source exposure selected
--    from each fund's latest available snapshot.
-- 2. Asset attributes are attached as arrays. They may be used as EXISTS-style
--    filters but must never multiply an exposure amount.
-- 3. party_exposure_rankings_v1 aggregates only the one-row-per-exposure view.

create or replace function public.normalize_party_key(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select public.normalize_beneficiary_key(p_value);
$$;

create or replace function public.party_id_for_key(p_party_key text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when nullif(btrim(p_party_key), '') is null then null
    else 'pty_' || substr(md5(p_party_key), 1, 24)
  end;
$$;

create or replace function public.infer_party_category(p_name text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when coalesce(p_name, '') ~* '(저축은행)' then '저축은행'
    when coalesce(p_name, '') ~* '(은행|bank)' then '은행'
    when coalesce(p_name, '') ~* '(생명|화재|손해보험|보험)' then '보험사'
    when coalesce(p_name, '') ~* '(증권|securities)' then '증권사'
    when coalesce(p_name, '') ~* '(신협|신용협동|새마을금고|수협|농협|상호금융)' then '상호금융'
    when coalesce(p_name, '') ~* '(카드)' then '카드사'
    when coalesce(p_name, '') ~* '(캐피탈|리스|capital)' then '캐피탈·리스'
    when coalesce(p_name, '') ~* '(자산운용|투자운용|asset management)' then '자산운용사'
    when coalesce(p_name, '') ~* '(연금|공제회)' then '연기금·공제회'
    when coalesce(p_name, '') ~* '(기금|공단|공사|정부|국가)' then '공공기관'
    when coalesce(p_name, '') ~* '(리츠|reit)' then '리츠'
    when coalesce(p_name, '') ~* '(pfv|spc|제(일|이|삼|사|오|육|칠|팔|구|십)+차)$' then 'SPC'
    when coalesce(p_name, '') ~* '(펀드|투자신탁|사모투자|전문사모|일반사모|집합투자|블라인드|blind)' then '펀드'
    when coalesce(p_name, '') ~* '(대주단)' then '대주단'
    when coalesce(p_name, '') ~* '(^개인|개인\s*\(|\(개인\))' then '개인'
    when coalesce(p_name, '') ~* '(주식회사|유한회사|㈜|co\.?[, ]|corp\.?|company|ltd\.?|limited|기업$|중공업$|산업$|텔레콤$|건설$|제강$)' then '일반기업'
    else '미분류'
  end;
$$;

create or replace function public.infer_party_class(p_name text)
returns text
language sql
immutable
parallel safe
as $$
  select case public.infer_party_category(p_name)
    when '은행' then '금융기관'
    when '저축은행' then '금융기관'
    when '보험사' then '금융기관'
    when '증권사' then '금융기관'
    when '상호금융' then '금융기관'
    when '카드사' then '금융기관'
    when '캐피탈·리스' then '금융기관'
    when '자산운용사' then '금융기관'
    when '연기금·공제회' then '기관'
    when '공공기관' then '기관'
    when '리츠' then '펀드·리츠·SPC'
    when 'SPC' then '펀드·리츠·SPC'
    when '펀드' then '펀드·리츠·SPC'
    when '대주단' then '금융기관'
    when '개인' then '개인'
    when '일반기업' then '일반기업'
    else '미분류'
  end;
$$;

create table if not exists public.party_master (
  party_id text primary key,
  party_key text not null unique,
  display_name text not null,
  party_class text not null default '미분류',
  party_category text not null default '미분류',
  classification_basis text not null default '명칭규칙 또는 미분류',
  classification_confidence numeric not null default 0.50,
  classification_method text not null default 'name_rule',
  review_status text not null default 'review',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint party_master_key_check check (party_key = public.normalize_party_key(display_name)),
  constraint party_master_class_check check (party_class in ('기관', '금융기관', '일반기업', '개인', '펀드·리츠·SPC', '미분류')),
  constraint party_master_confidence_check check (classification_confidence between 0 and 1),
  constraint party_master_review_check check (review_status in ('confirmed', 'review'))
);

create table if not exists public.party_aliases (
  alias_id text primary key,
  party_id text not null references public.party_master(party_id) on delete cascade,
  alias_name text not null,
  alias_key text not null,
  source_table text not null,
  confidence numeric not null default 1.00,
  created_at timestamptz not null default now(),
  constraint party_aliases_confidence_check check (confidence between 0 and 1),
  unique (party_id, alias_key, source_table)
);

comment on table public.party_master is
  'Canonical institution/party identity shared by equity beneficiary and lender roles.';
comment on table public.party_aliases is
  'Search aliases and source spellings mapped to a canonical party.';

-- Beneficiary classifications are the highest-confidence seed.
insert into public.party_master (
  party_id, party_key, display_name, party_class, party_category,
  classification_basis, classification_confidence, classification_method,
  review_status, notes, updated_at
)
select
  public.party_id_for_key(master.beneficiary_key),
  master.beneficiary_key,
  master.canonical_name,
  dictionary.beneficiary_class,
  master.beneficiary_cat,
  master.classification_basis,
  master.classification_confidence,
  'beneficiary_contract:' || master.classification_method,
  master.review_status,
  master.notes,
  now()
from public.beneficiary_classification_master master
join public.beneficiary_category_dictionary dictionary
  on dictionary.beneficiary_cat = master.beneficiary_cat
on conflict (party_key) do update set
  display_name = excluded.display_name,
  party_class = excluded.party_class,
  party_category = excluded.party_category,
  classification_basis = excluded.classification_basis,
  classification_confidence = excluded.classification_confidence,
  classification_method = excluded.classification_method,
  review_status = excluded.review_status,
  notes = excluded.notes,
  updated_at = now();

-- Lender-only names reuse the same controlled broad-class vocabulary.
insert into public.party_master (
  party_id, party_key, display_name, party_class, party_category,
  classification_basis, classification_confidence, classification_method,
  review_status, updated_at
)
select distinct on (public.normalize_party_key(le.lender_clean))
  public.party_id_for_key(public.normalize_party_key(le.lender_clean)),
  public.normalize_party_key(le.lender_clean),
  btrim(le.lender_clean),
  public.infer_party_class(le.lender_clean),
  public.infer_party_category(le.lender_clean),
  case
    when public.infer_party_class(le.lender_clean) = '미분류' then '대주명 분류 단서 부족'
    else '대주명 규칙 기반 초기 분류'
  end,
  case when public.infer_party_class(le.lender_clean) = '미분류' then 0.30 else 0.75 end,
  'lender_name_rule',
  case when public.infer_party_class(le.lender_clean) = '미분류' then 'review' else 'confirmed' end,
  now()
from public.lender_exposures le
where nullif(btrim(le.lender_clean), '') is not null
order by public.normalize_party_key(le.lender_clean), length(btrim(le.lender_clean)) desc, le.lender_clean
on conflict (party_key) do update set
  display_name = case
    when party_master.classification_method like 'beneficiary_contract:%' then party_master.display_name
    else excluded.display_name
  end,
  party_class = case
    when party_master.classification_method like 'beneficiary_contract:%' then party_master.party_class
    else excluded.party_class
  end,
  party_category = case
    when party_master.classification_method like 'beneficiary_contract:%' then party_master.party_category
    else excluded.party_category
  end,
  classification_basis = case
    when party_master.classification_method like 'beneficiary_contract:%' then party_master.classification_basis
    else excluded.classification_basis
  end,
  classification_confidence = case
    when party_master.classification_method like 'beneficiary_contract:%' then party_master.classification_confidence
    else excluded.classification_confidence
  end,
  classification_method = case
    when party_master.classification_method like 'beneficiary_contract:%' then party_master.classification_method
    else excluded.classification_method
  end,
  review_status = case
    when party_master.classification_method like 'beneficiary_contract:%' then party_master.review_status
    else excluded.review_status
  end,
  updated_at = now();

-- Counterparty records supply aliases and identities not yet observed in a fact table.
insert into public.party_master (
  party_id, party_key, display_name, party_class, party_category,
  classification_basis, classification_confidence, classification_method,
  review_status, updated_at
)
select distinct on (public.normalize_party_key(cp.name))
  public.party_id_for_key(public.normalize_party_key(cp.name)),
  public.normalize_party_key(cp.name),
  btrim(cp.name),
  public.infer_party_class(cp.name),
  public.infer_party_category(cp.name),
  case
    when public.infer_party_class(cp.name) = '미분류' then 'counterparties 명칭 분류 단서 부족'
    else 'counterparties 명칭 규칙 기반 초기 분류'
  end,
  case when public.infer_party_class(cp.name) = '미분류' then 0.30 else 0.70 end,
  'counterparty_name_rule',
  case when public.infer_party_class(cp.name) = '미분류' then 'review' else 'confirmed' end,
  now()
from public.counterparties cp
where nullif(btrim(cp.name), '') is not null
order by public.normalize_party_key(cp.name), length(btrim(cp.name)) desc, cp.name
on conflict (party_key) do nothing;

alter table public.beneficiary_exposures add column if not exists party_id text;
alter table public.lender_exposures add column if not exists party_id text;

update public.beneficiary_exposures be
set party_id = pm.party_id
from public.party_master pm
where pm.party_key = public.normalize_party_key(coalesce(be.beneficiary_clean, be.beneficiary_raw))
  and be.party_id is distinct from pm.party_id;

update public.lender_exposures le
set party_id = pm.party_id
from public.party_master pm
where pm.party_key = public.normalize_party_key(coalesce(le.lender_clean, le.lender_raw))
  and le.party_id is distinct from pm.party_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'beneficiary_exposures_party_id_fkey'
      and conrelid = 'public.beneficiary_exposures'::regclass
  ) then
    alter table public.beneficiary_exposures
      add constraint beneficiary_exposures_party_id_fkey
      foreign key (party_id) references public.party_master(party_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lender_exposures_party_id_fkey'
      and conrelid = 'public.lender_exposures'::regclass
  ) then
    alter table public.lender_exposures
      add constraint lender_exposures_party_id_fkey
      foreign key (party_id) references public.party_master(party_id);
  end if;
end;
$$;

create index if not exists beneficiary_exposures_party_id_idx
  on public.beneficiary_exposures (party_id, fund_id, base_date);
create index if not exists lender_exposures_party_id_idx
  on public.lender_exposures (party_id, fund_id, base_date);
create index if not exists party_master_class_idx
  on public.party_master (party_class, party_category, review_status);
create index if not exists party_aliases_key_idx
  on public.party_aliases (alias_key);

insert into public.party_aliases (alias_id, party_id, alias_name, alias_key, source_table, confidence)
select distinct
  'pal_' || substr(md5(concat_ws('|', pm.party_id, public.normalize_party_key(alias_name), source_table)), 1, 24),
  pm.party_id,
  alias_name,
  public.normalize_party_key(alias_name),
  source_table,
  confidence
from (
  select coalesce(beneficiary_clean, beneficiary_raw) as canonical_name,
         beneficiary_raw as alias_name, 'beneficiary_exposures'::text as source_table, 0.95::numeric as confidence
  from public.beneficiary_exposures
  union all
  select coalesce(lender_clean, lender_raw), lender_raw, 'lender_exposures', 0.95::numeric
  from public.lender_exposures
  union all
  select name, name, 'counterparties', 1.00::numeric
  from public.counterparties
) aliases
join public.party_master pm
  on pm.party_key = public.normalize_party_key(aliases.canonical_name)
where nullif(btrim(alias_name), '') is not null
on conflict (party_id, alias_key, source_table) do update set
  alias_name = excluded.alias_name,
  confidence = greatest(party_aliases.confidence, excluded.confidence);

create or replace function public.assign_party_id_from_exposure()
returns trigger
language plpgsql
as $$
declare
  resolved_name text;
  resolved_key text;
  resolved_id text;
  resolved_class text;
  resolved_category text;
  resolved_basis text;
  resolved_method text;
  resolved_review text;
  raw_alias text;
begin
  if tg_table_name = 'beneficiary_exposures' then
    resolved_name := coalesce(nullif(btrim(new.beneficiary_clean), ''), nullif(btrim(new.beneficiary_raw), ''));
    raw_alias := new.beneficiary_raw;
    resolved_class := coalesce(nullif(btrim(new.beneficiary_class), ''), public.infer_party_class(resolved_name));
    resolved_category := coalesce(nullif(btrim(new.beneficiary_cat), ''), public.infer_party_category(resolved_name));
    resolved_basis := coalesce(nullif(btrim(new.beneficiary_cat_basis), ''), '수익자 exposure 신규 명칭');
    resolved_method := 'beneficiary_exposure';
    resolved_review := coalesce(nullif(btrim(new.beneficiary_cat_review_status), ''), 'review');
  else
    resolved_name := coalesce(nullif(btrim(new.lender_clean), ''), nullif(btrim(new.lender_raw), ''));
    raw_alias := new.lender_raw;
    resolved_class := public.infer_party_class(resolved_name);
    resolved_category := public.infer_party_category(resolved_name);
    resolved_basis := case when resolved_class = '미분류' then '대주명 분류 단서 부족' else '대주명 규칙 기반 초기 분류' end;
    resolved_method := 'lender_name_rule';
    resolved_review := case when resolved_class = '미분류' then 'review' else 'confirmed' end;
  end if;

  if resolved_name is null then
    new.party_id := null;
    return new;
  end if;

  resolved_key := public.normalize_party_key(resolved_name);
  resolved_id := public.party_id_for_key(resolved_key);

  insert into public.party_master (
    party_id, party_key, display_name, party_class, party_category,
    classification_basis, classification_confidence, classification_method,
    review_status, updated_at
  ) values (
    resolved_id, resolved_key, resolved_name, resolved_class, resolved_category,
    resolved_basis,
    case when resolved_class = '미분류' then 0.30 else 0.75 end,
    resolved_method, resolved_review, now()
  )
  on conflict (party_key) do nothing;

  new.party_id := resolved_id;

  if nullif(btrim(raw_alias), '') is not null then
    insert into public.party_aliases (
      alias_id, party_id, alias_name, alias_key, source_table, confidence
    ) values (
      'pal_' || substr(md5(concat_ws('|', resolved_id, public.normalize_party_key(raw_alias), tg_table_name)), 1, 24),
      resolved_id, raw_alias, public.normalize_party_key(raw_alias), tg_table_name, 0.95
    )
    on conflict (party_id, alias_key, source_table) do update set
      alias_name = excluded.alias_name,
      confidence = greatest(party_aliases.confidence, excluded.confidence);
  end if;

  return new;
end;
$$;

drop trigger if exists party_exposure_party_assignment_trigger on public.beneficiary_exposures;
create trigger party_exposure_party_assignment_trigger
before insert or update of beneficiary_raw, beneficiary_clean, beneficiary_cat, beneficiary_class
on public.beneficiary_exposures
for each row execute function public.assign_party_id_from_exposure();

drop trigger if exists party_exposure_party_assignment_trigger on public.lender_exposures;
create trigger party_exposure_party_assignment_trigger
before insert or update of lender_raw, lender_clean
on public.lender_exposures
for each row execute function public.assign_party_id_from_exposure();

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
    review_status, notes, updated_at
  ) values (
    public.party_id_for_key(new.beneficiary_key), new.beneficiary_key,
    new.canonical_name, coalesce(resolved_class, '미분류'), new.beneficiary_cat,
    new.classification_basis, new.classification_confidence,
    'beneficiary_contract:' || new.classification_method,
    new.review_status, new.notes, now()
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
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists beneficiary_master_party_sync_trigger
  on public.beneficiary_classification_master;
create trigger beneficiary_master_party_sync_trigger
after insert or update on public.beneficiary_classification_master
for each row execute function public.sync_party_master_from_beneficiary_master();

create or replace view public.party_role_memberships as
select
  party_id,
  'beneficiary'::text as role_type,
  count(*)::int as source_row_count,
  count(distinct fund_id)::int as fund_count,
  min(base_date) as first_observed_date,
  max(base_date) as last_observed_date,
  'beneficiary_exposures'::text as source_table
from public.beneficiary_exposures
where party_id is not null
group by party_id
union all
select
  party_id,
  'lender'::text as role_type,
  count(*)::int,
  count(distinct fund_id)::int,
  min(base_date),
  max(base_date),
  'lender_exposures'::text
from public.lender_exposures
where party_id is not null
group by party_id;

create or replace view public.party_exposure_current_v1 as
with beneficiary_latest as (
  select fund_id, max(base_date) as base_date
  from public.beneficiary_exposures
  group by fund_id
),
lender_latest as (
  select fund_id, max(base_date) as base_date
  from public.lender_exposures
  group by fund_id
)
select
  'beneficiary:' || be.id::text as exposure_uid,
  'beneficiary'::text as role_type,
  be.id::text as source_exposure_id,
  be.party_id,
  be.fund_id::text as fund_id,
  be.base_date,
  coalesce(be.committed_amt, 0)::bigint as committed_amt,
  coalesce(be.invested_amt, 0)::bigint as invested_amt,
  0::bigint as drawn_amt,
  coalesce(be.remaining_amt, 0)::bigint as remaining_amt,
  coalesce(be.invested_amt, 0)::bigint as primary_amount,
  be.asset_id::text as direct_asset_id,
  be.beneficiary_type as source_party_type,
  be.beneficiary_cat_source as source_party_category,
  be.remarks,
  be.invested_date as activity_date,
  null::date as maturity_date
from public.beneficiary_exposures be
join beneficiary_latest latest
  on latest.fund_id = be.fund_id
 and latest.base_date is not distinct from be.base_date
union all
select
  'lender:' || le.id::text,
  'lender'::text,
  le.id::text,
  le.party_id,
  le.fund_id::text,
  le.base_date,
  coalesce(le.committed_amt, 0)::bigint,
  0::bigint,
  coalesce(le.drawn_amt, 0)::bigint,
  coalesce(le.remaining_amt, 0)::bigint,
  coalesce(le.drawn_amt, 0)::bigint,
  le.asset_id::text,
  le.trench,
  null::text,
  le.remarks,
  coalesce(le.drawdown_date, le.start_date),
  coalesce(le.loan_maturity_date, le.end_date)
from public.lender_exposures le
join lender_latest latest
  on latest.fund_id = le.fund_id
 and latest.base_date is not distinct from le.base_date;

create or replace view public.party_exposure_analysis_fact_v1 as
with fund_asset_degree as (
  select fund_id::text as fund_id, count(distinct asset_id)::int as asset_count
  from public.asset_fund_links
  group by fund_id
),
direct_match as (
  select current.exposure_uid,
         exists (
           select 1 from public.asset_fund_links link
           where link.fund_id = current.fund_id
             and link.asset_id = current.direct_asset_id
         ) as matches_fund_link
  from public.party_exposure_current_v1 current
),
resolved_asset_edges as (
  select current.exposure_uid, current.direct_asset_id as asset_id
  from public.party_exposure_current_v1 current
  where current.direct_asset_id is not null

  union

  select current.exposure_uid, link.asset_id
  from public.party_exposure_current_v1 current
  join public.asset_fund_links link on link.fund_id = current.fund_id
  left join direct_match match on match.exposure_uid = current.exposure_uid
  where current.direct_asset_id is null
     or coalesce(match.matches_fund_link, false) is false
),
asset_attributes as (
  select
    edge.exposure_uid,
    array_agg(distinct asset.asset_id order by asset.asset_id) as asset_ids,
    array_agg(
      distinct coalesce(
        nullif(asset.physical_asset_name, ''),
        nullif(asset.non_physical_asset_label, ''),
        nullif(asset.canonical_name, ''),
        nullif(asset.asset_code, ''),
        asset.asset_id
      )
      order by coalesce(
        nullif(asset.physical_asset_name, ''),
        nullif(asset.non_physical_asset_label, ''),
        nullif(asset.canonical_name, ''),
        nullif(asset.asset_code, ''),
        asset.asset_id
      )
    ) as asset_names,
    array_agg(distinct asset.asset_type order by asset.asset_type)
      filter (where nullif(btrim(asset.asset_type), '') is not null) as asset_types,
    array_agg(distinct asset.asset_kind order by asset.asset_kind)
      filter (where nullif(btrim(asset.asset_kind), '') is not null) as asset_kinds,
    array_agg(distinct asset.portfolio_region order by asset.portfolio_region)
      filter (where nullif(btrim(asset.portfolio_region), '') is not null) as asset_regions,
    array_agg(distinct asset.business_stage order by asset.business_stage)
      filter (where nullif(btrim(asset.business_stage), '') is not null) as asset_business_stages,
    array_agg(distinct asset.city order by asset.city)
      filter (where nullif(btrim(asset.city), '') is not null) as cities,
    array_agg(distinct asset.country_code order by asset.country_code)
      filter (where nullif(btrim(asset.country_code), '') is not null) as country_codes
  from resolved_asset_edges edge
  join public.asset_master asset on asset.asset_id = edge.asset_id
  group by edge.exposure_uid
)
select
  current.exposure_uid,
  current.role_type,
  current.source_exposure_id,
  current.party_id,
  party.display_name as party_name,
  party.party_class,
  party.party_category,
  party.classification_basis,
  party.classification_confidence,
  party.classification_method,
  party.review_status,
  current.fund_id,
  coalesce(nullif(fund.short_name, ''), nullif(fund.fund_name, ''), current.fund_id) as fund_name,
  current.base_date,
  current.committed_amt,
  current.invested_amt,
  current.drawn_amt,
  current.remaining_amt,
  current.primary_amount,
  current.direct_asset_id,
  coalesce(attributes.asset_ids, array[]::text[]) as asset_ids,
  coalesce(attributes.asset_names, array[]::text[]) as asset_names,
  coalesce(attributes.asset_types, array[]::text[]) as asset_types,
  coalesce(attributes.asset_kinds, array[]::text[]) as asset_kinds,
  array(
    select distinct value
    from unnest(coalesce(attributes.asset_regions, array[]::text[]) || array[fund.primary_region, fund.location]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as regions,
  array(
    select distinct value
    from unnest(coalesce(attributes.asset_business_stages, array[]::text[]) || array[fund.notion_business_stage_class]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as business_stages,
  array(
    select distinct value
    from unnest(coalesce(attributes.asset_types, array[]::text[]) || array[fund.notion_base_asset_class, fund.sector]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as base_asset_classes,
  array(
    select distinct value
    from unnest(array[fund.notion_investment_strategy_class]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as strategies,
  array(
    select distinct value
    from unnest(array[coalesce(fund.notion_vehicle_class, fund.fund_type, fund.fund_class)]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as vehicle_types,
  array(
    select distinct value
    from unnest(array[fund.status]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as operational_statuses,
  coalesce(attributes.cities, array[]::text[]) as cities,
  coalesce(attributes.country_codes, array[]::text[]) as country_codes,
  case
    when current.direct_asset_id is not null and coalesce(match.matches_fund_link, false) then 'direct'
    when current.direct_asset_id is not null and coalesce(match.matches_fund_link, false) is false then 'direct_conflict'
    when current.direct_asset_id is null and coalesce(degree.asset_count, 0) = 1 then 'derived_single'
    when current.direct_asset_id is null and coalesce(degree.asset_count, 0) > 1 then 'derived_multi'
    else 'unresolved'
  end as relationship_quality,
  current.source_party_type,
  current.source_party_category,
  current.remarks,
  current.activity_date,
  current.maturity_date
from public.party_exposure_current_v1 current
join public.party_master party on party.party_id = current.party_id
left join public.v_funds_enriched fund on fund.fund_id = current.fund_id
left join fund_asset_degree degree on degree.fund_id = current.fund_id
left join direct_match match on match.exposure_uid = current.exposure_uid
left join asset_attributes attributes on attributes.exposure_uid = current.exposure_uid;

create or replace view public.party_exposure_rankings_v1 as
with totals as (
  select
    fact.role_type,
    fact.party_id,
    min(fact.party_name) as party_name,
    min(fact.party_class) as party_class,
    min(fact.party_category) as party_category,
    min(fact.classification_basis) as classification_basis,
    min(fact.classification_confidence) as classification_confidence,
    min(fact.classification_method) as classification_method,
    min(fact.review_status) as review_status,
    count(*)::int as exposure_count,
    count(distinct fact.fund_id)::int as fund_count,
    min(fact.base_date) as min_base_date,
    max(fact.base_date) as max_base_date,
    coalesce(sum(fact.committed_amt), 0)::bigint as committed_amt,
    coalesce(sum(fact.invested_amt), 0)::bigint as invested_amt,
    coalesce(sum(fact.drawn_amt), 0)::bigint as drawn_amt,
    coalesce(sum(fact.remaining_amt), 0)::bigint as remaining_amt,
    coalesce(sum(fact.primary_amount), 0)::bigint as primary_amount,
    count(*) filter (where fact.relationship_quality = 'direct')::int as direct_exposure_count,
    count(*) filter (where fact.relationship_quality = 'direct_conflict')::int as conflict_exposure_count,
    count(*) filter (where fact.relationship_quality = 'derived_single')::int as derived_single_exposure_count,
    count(*) filter (where fact.relationship_quality = 'derived_multi')::int as derived_multi_exposure_count,
    count(*) filter (where fact.relationship_quality = 'unresolved')::int as unresolved_exposure_count
  from public.party_exposure_analysis_fact_v1 fact
  group by fact.role_type, fact.party_id
)
select
  totals.*,
  case when totals.committed_amt = 0 then 0::numeric
       else totals.primary_amount::numeric / totals.committed_amt::numeric end as utilization_ratio,
  coalesce((
    select count(distinct asset_id)::int
    from public.party_exposure_analysis_fact_v1 fact
    cross join lateral unnest(fact.asset_ids) asset_id
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), 0) as asset_count,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_analysis_fact_v1 fact
    cross join lateral unnest(fact.asset_types) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as asset_types,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_analysis_fact_v1 fact
    cross join lateral unnest(fact.base_asset_classes) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as base_asset_classes,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_analysis_fact_v1 fact
    cross join lateral unnest(fact.regions) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as regions,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_analysis_fact_v1 fact
    cross join lateral unnest(fact.strategies) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as strategies,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_analysis_fact_v1 fact
    cross join lateral unnest(fact.business_stages) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as business_stages,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_analysis_fact_v1 fact
    cross join lateral unnest(fact.vehicle_types) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as vehicle_types,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_analysis_fact_v1 fact
    cross join lateral unnest(fact.operational_statuses) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as operational_statuses,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_analysis_fact_v1 fact
    cross join lateral unnest(fact.asset_names) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as asset_names,
  coalesce((
    select array_agg(distinct fact.fund_name order by fact.fund_name)
    from public.party_exposure_analysis_fact_v1 fact
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as fund_names
from totals;

create or replace view public.party_exposure_facets_v1 as
with facet_rows as (
  select exposure_uid, role_type, party_id, fund_id, committed_amt, invested_amt, drawn_amt, remaining_amt, primary_amount,
         'party_class'::text as facet_name, party_class as facet_value
  from public.party_exposure_analysis_fact_v1
  union all
  select exposure_uid, role_type, party_id, fund_id, committed_amt, invested_amt, drawn_amt, remaining_amt, primary_amount,
         'party_category', party_category
  from public.party_exposure_analysis_fact_v1
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id, fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'asset_type', value
  from public.party_exposure_analysis_fact_v1 fact cross join lateral unnest(fact.asset_types) value
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id, fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'base_asset_class', value
  from public.party_exposure_analysis_fact_v1 fact cross join lateral unnest(fact.base_asset_classes) value
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id, fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'region', value
  from public.party_exposure_analysis_fact_v1 fact cross join lateral unnest(fact.regions) value
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id, fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'strategy', value
  from public.party_exposure_analysis_fact_v1 fact cross join lateral unnest(fact.strategies) value
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id, fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'business_stage', value
  from public.party_exposure_analysis_fact_v1 fact cross join lateral unnest(fact.business_stages) value
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id, fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'vehicle_type', value
  from public.party_exposure_analysis_fact_v1 fact cross join lateral unnest(fact.vehicle_types) value
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id, fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'operational_status', value
  from public.party_exposure_analysis_fact_v1 fact cross join lateral unnest(fact.operational_statuses) value
),
deduplicated as (
  select distinct on (role_type, exposure_uid, facet_name, facet_value) *
  from facet_rows
  where nullif(btrim(facet_value), '') is not null
  order by role_type, exposure_uid, facet_name, facet_value
)
select
  role_type,
  facet_name,
  facet_value,
  count(distinct exposure_uid)::int as exposure_count,
  count(distinct party_id)::int as party_count,
  count(distinct fund_id)::int as fund_count,
  coalesce(sum(committed_amt), 0)::bigint as committed_amt,
  coalesce(sum(invested_amt), 0)::bigint as invested_amt,
  coalesce(sum(drawn_amt), 0)::bigint as drawn_amt,
  coalesce(sum(remaining_amt), 0)::bigint as remaining_amt,
  coalesce(sum(primary_amount), 0)::bigint as primary_amount
from deduplicated
group by role_type, facet_name, facet_value;

create or replace view public.party_exposure_contract_audit as
with beneficiary_latest as (
  select fund_id, max(base_date) as base_date
  from public.beneficiary_exposures
  group by fund_id
),
beneficiary_source as (
  select count(*)::int as rows,
         coalesce(sum(be.committed_amt), 0)::bigint as committed_amt,
         coalesce(sum(be.invested_amt), 0)::bigint as primary_amt,
         coalesce(sum(be.remaining_amt), 0)::bigint as remaining_amt
  from public.beneficiary_exposures be
  join beneficiary_latest latest
    on latest.fund_id = be.fund_id and latest.base_date is not distinct from be.base_date
),
lender_latest as (
  select fund_id, max(base_date) as base_date
  from public.lender_exposures
  group by fund_id
),
lender_source as (
  select count(*)::int as rows,
         coalesce(sum(le.committed_amt), 0)::bigint as committed_amt,
         coalesce(sum(le.drawn_amt), 0)::bigint as primary_amt,
         coalesce(sum(le.remaining_amt), 0)::bigint as remaining_amt
  from public.lender_exposures le
  join lender_latest latest
    on latest.fund_id = le.fund_id and latest.base_date is not distinct from le.base_date
),
fact_totals as (
  select role_type, count(*)::int as rows,
         coalesce(sum(committed_amt), 0)::bigint as committed_amt,
         coalesce(sum(primary_amount), 0)::bigint as primary_amt,
         coalesce(sum(remaining_amt), 0)::bigint as remaining_amt
  from public.party_exposure_analysis_fact_v1
  group by role_type
),
ranking_totals as (
  select role_type, coalesce(sum(exposure_count), 0)::int as rows,
         coalesce(sum(committed_amt), 0)::bigint as committed_amt,
         coalesce(sum(primary_amount), 0)::bigint as primary_amt,
         coalesce(sum(remaining_amt), 0)::bigint as remaining_amt
  from public.party_exposure_rankings_v1
  group by role_type
),
class_subtotals as (
  select role_type, party_class,
         coalesce(sum(exposure_count), 0)::int as rows,
         coalesce(sum(committed_amt), 0)::bigint as committed_amt,
         coalesce(sum(primary_amount), 0)::bigint as primary_amt,
         coalesce(sum(remaining_amt), 0)::bigint as remaining_amt
  from public.party_exposure_rankings_v1
  group by role_type, party_class
),
class_grand_totals as (
  select role_type, coalesce(sum(rows), 0)::int as rows,
         coalesce(sum(committed_amt), 0)::bigint as committed_amt,
         coalesce(sum(primary_amt), 0)::bigint as primary_amt,
         coalesce(sum(remaining_amt), 0)::bigint as remaining_amt
  from class_subtotals
  group by role_type
),
duplicate_facts as (
  select count(*)::int as duplicate_groups
  from (
    select role_type, exposure_uid from public.party_exposure_analysis_fact_v1
    group by role_type, exposure_uid having count(*) > 1
  ) duplicate_rows
),
duplicate_rankings as (
  select count(*)::int as duplicate_groups
  from (
    select role_type, party_id from public.party_exposure_rankings_v1
    group by role_type, party_id having count(*) > 1
  ) duplicate_rows
)
select
  beneficiary_source.rows as beneficiary_source_rows,
  bf.rows as beneficiary_fact_rows,
  br.rows as beneficiary_ranking_rows,
  bc.rows as beneficiary_class_subtotal_rows,
  beneficiary_source.committed_amt as beneficiary_source_committed_amt,
  bf.committed_amt as beneficiary_fact_committed_amt,
  br.committed_amt as beneficiary_ranking_committed_amt,
  bc.committed_amt as beneficiary_class_subtotal_committed_amt,
  beneficiary_source.primary_amt as beneficiary_source_invested_amt,
  bf.primary_amt as beneficiary_fact_invested_amt,
  br.primary_amt as beneficiary_ranking_invested_amt,
  bc.primary_amt as beneficiary_class_subtotal_invested_amt,
  beneficiary_source.remaining_amt as beneficiary_source_remaining_amt,
  bf.remaining_amt as beneficiary_fact_remaining_amt,
  br.remaining_amt as beneficiary_ranking_remaining_amt,
  bc.remaining_amt as beneficiary_class_subtotal_remaining_amt,
  lender_source.rows as lender_source_rows,
  lf.rows as lender_fact_rows,
  lr.rows as lender_ranking_rows,
  lc.rows as lender_class_subtotal_rows,
  lender_source.committed_amt as lender_source_committed_amt,
  lf.committed_amt as lender_fact_committed_amt,
  lr.committed_amt as lender_ranking_committed_amt,
  lc.committed_amt as lender_class_subtotal_committed_amt,
  lender_source.primary_amt as lender_source_drawn_amt,
  lf.primary_amt as lender_fact_drawn_amt,
  lr.primary_amt as lender_ranking_drawn_amt,
  lc.primary_amt as lender_class_subtotal_drawn_amt,
  lender_source.remaining_amt as lender_source_remaining_amt,
  lf.remaining_amt as lender_fact_remaining_amt,
  lr.remaining_amt as lender_ranking_remaining_amt,
  lc.remaining_amt as lender_class_subtotal_remaining_amt,
  duplicate_facts.duplicate_groups as duplicate_fact_groups,
  duplicate_rankings.duplicate_groups as duplicate_ranking_groups,
  (select count(*)::int from public.party_exposure_current_v1 where party_id is null) as orphan_party_rows,
  (select count(*)::int from public.party_master where party_class not in ('기관', '금융기관', '일반기업', '개인', '펀드·리츠·SPC', '미분류')) as invalid_party_class_rows,
  (
    beneficiary_source.rows = bf.rows and bf.rows = br.rows and br.rows = bc.rows
    and beneficiary_source.committed_amt = bf.committed_amt and bf.committed_amt = br.committed_amt and br.committed_amt = bc.committed_amt
    and beneficiary_source.primary_amt = bf.primary_amt and bf.primary_amt = br.primary_amt and br.primary_amt = bc.primary_amt
    and beneficiary_source.remaining_amt = bf.remaining_amt and bf.remaining_amt = br.remaining_amt and br.remaining_amt = bc.remaining_amt
  ) as beneficiary_subtotals_match,
  (
    lender_source.rows = lf.rows and lf.rows = lr.rows and lr.rows = lc.rows
    and lender_source.committed_amt = lf.committed_amt and lf.committed_amt = lr.committed_amt and lr.committed_amt = lc.committed_amt
    and lender_source.primary_amt = lf.primary_amt and lf.primary_amt = lr.primary_amt and lr.primary_amt = lc.primary_amt
    and lender_source.remaining_amt = lf.remaining_amt and lf.remaining_amt = lr.remaining_amt and lr.remaining_amt = lc.remaining_amt
  ) as lender_subtotals_match,
  (
    duplicate_facts.duplicate_groups = 0
    and duplicate_rankings.duplicate_groups = 0
    and (select count(*) from public.party_exposure_current_v1 where party_id is null) = 0
  ) as relationship_grain_valid
from beneficiary_source
cross join lender_source
left join fact_totals bf on bf.role_type = 'beneficiary'
left join fact_totals lf on lf.role_type = 'lender'
left join ranking_totals br on br.role_type = 'beneficiary'
left join ranking_totals lr on lr.role_type = 'lender'
left join class_grand_totals bc on bc.role_type = 'beneficiary'
left join class_grand_totals lc on lc.role_type = 'lender'
cross join duplicate_facts
cross join duplicate_rankings;

grant select on public.party_master to anon, authenticated;
grant select on public.party_aliases to anon, authenticated;
grant select on public.party_role_memberships to anon, authenticated;
grant select on public.party_exposure_current_v1 to anon, authenticated;
grant select on public.party_exposure_analysis_fact_v1 to anon, authenticated;
grant select on public.party_exposure_rankings_v1 to anon, authenticated;
grant select on public.party_exposure_facets_v1 to anon, authenticated;
grant select on public.party_exposure_contract_audit to anon, authenticated;

comment on view public.party_exposure_current_v1 is
  'One row per source exposure using each role/fund latest available base date.';
comment on view public.party_exposure_analysis_fact_v1 is
  'One-row-per-exposure analysis fact with relationship attributes attached as arrays.';
comment on view public.party_exposure_rankings_v1 is
  'Party and role ranking totals derived only from the non-multiplying current exposure fact.';
comment on view public.party_exposure_facets_v1 is
  'Facet counts and amounts; each exposure is counted once per facet value.';
comment on view public.party_exposure_contract_audit is
  'Mandatory source=fact=party ranking=class subtotal reconciliation checks.';
