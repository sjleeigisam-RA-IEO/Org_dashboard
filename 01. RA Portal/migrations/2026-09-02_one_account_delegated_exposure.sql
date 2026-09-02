-- One Account v1.1 delegated-beneficiary integration.
-- Source/legal rows and derived economic look-through rows remain separate.
-- Existing party_exposure_external_current_v1 and Portfolio AUM contracts are unchanged.

begin;

create table if not exists public.one_account_party_bridge (
  snapshot_version text not null,
  source_snapshot_date date not null,
  account_id text not null,
  canonical_account_name text not null,
  party_id text not null references public.party_master(party_id) on delete restrict,
  is_primary boolean not null default false,
  resolution_method text not null,
  resolution_status text not null check (resolution_status in ('confirmed', 'review')),
  resolution_basis text not null,
  updated_at timestamptz not null default now(),
  primary key (snapshot_version, account_id, party_id)
);

create unique index if not exists one_account_party_bridge_one_primary_idx
  on public.one_account_party_bridge (snapshot_version, account_id)
  where is_primary;
create index if not exists one_account_party_bridge_party_idx
  on public.one_account_party_bridge (party_id, source_snapshot_date desc);

create table if not exists public.delegated_beneficiary_source_fact (
  relationship_id text primary key,
  snapshot_version text not null,
  source_snapshot_date date not null,
  delegated_group_name text not null,
  investor_source_name text not null,
  canonical_account_name text,
  account_id text,
  party_id text references public.party_master(party_id) on delete restrict,
  mapping_status text not null,
  beneficiary_commitment bigint not null check (beneficiary_commitment >= 0),
  beneficiary_paid_in bigint,
  paid_in_available boolean not null default false,
  piscfh_code text check (piscfh_code is null or piscfh_code in ('P', 'I', 'S', 'C', 'F', 'H')),
  group_declared_commitment bigint,
  group_investment_amount bigint,
  group_status text,
  commitment_timing text,
  source_file text not null,
  source_sheet text,
  source_row integer not null,
  updated_at timestamptz not null default now(),
  check ((paid_in_available and beneficiary_paid_in is not null)
      or (not paid_in_available and beneficiary_paid_in is null))
);

create index if not exists delegated_beneficiary_source_snapshot_idx
  on public.delegated_beneficiary_source_fact (source_snapshot_date desc, delegated_group_name);
create index if not exists delegated_beneficiary_source_account_idx
  on public.delegated_beneficiary_source_fact (account_id)
  where account_id is not null;

create table if not exists public.delegated_beneficiary_lookthrough_fact (
  exposure_id text primary key,
  snapshot_version text not null,
  source_snapshot_date date not null,
  account_id text not null,
  canonical_account_name text not null,
  primary_party_id text not null references public.party_master(party_id) on delete restrict,
  role_type text not null default 'beneficiary' check (role_type = 'beneficiary'),
  role_class text not null check (role_class in
    ('국내LP', '해외LP', '펀드·리츠·SPC', '금융기관', '일반기업', '공기업', '개인', '기타')),
  party_origin text not null default '확인 필요' check (party_origin in ('국내', '해외', '확인 필요')),
  piscfh_code text check (piscfh_code is null or piscfh_code in ('P', 'I', 'S', 'C', 'F', 'H')),
  fund_id text not null references public.funds(fund_id) on delete restrict,
  fund_name text not null,
  asset_name text,
  committed_amt bigint not null check (committed_amt >= 0),
  invested_amt bigint,
  remaining_amt bigint,
  paid_in_available boolean not null default false,
  currency text not null default 'KRW' check (currency = 'KRW'),
  measure_type text not null default 'beneficiary_commitment'
    check (measure_type = 'beneficiary_commitment'),
  relationship_layer text not null default 'DELEGATED_BENEFICIARY_LOOKTHROUGH'
    check (relationship_layer = 'DELEGATED_BENEFICIARY_LOOKTHROUGH'),
  amount_basis text not null,
  authority_status text not null,
  economic_vehicle_key text not null,
  source_file text not null,
  source_rows jsonb not null default '[]'::jsonb check (jsonb_typeof(source_rows) = 'array'),
  lineage_paths jsonb not null default '[]'::jsonb check (jsonb_typeof(lineage_paths) = 'array'),
  updated_at timestamptz not null default now(),
  check ((paid_in_available and invested_amt is not null)
      or (not paid_in_available and invested_amt is null)),
  check (remaining_amt is null or remaining_amt >= 0)
);

create index if not exists delegated_beneficiary_lookthrough_snapshot_idx
  on public.delegated_beneficiary_lookthrough_fact (source_snapshot_date desc, account_id);
create index if not exists delegated_beneficiary_lookthrough_fund_idx
  on public.delegated_beneficiary_lookthrough_fact (fund_id);

create or replace view public.one_account_party_bridge_current_v1 as
with latest as (
  select max(source_snapshot_date) as source_snapshot_date
  from public.one_account_party_bridge
)
select bridge.*
from public.one_account_party_bridge bridge
join latest using (source_snapshot_date);

drop view if exists public.one_account_delegated_exposure_current_v1;
create view public.one_account_delegated_exposure_current_v1 as
with latest as (
  select max(source_snapshot_date) as source_snapshot_date
  from public.delegated_beneficiary_lookthrough_fact
)
select
  fact.exposure_id,
  fact.snapshot_version,
  fact.source_snapshot_date as base_date,
  fact.account_id as canonical_account_id,
  fact.canonical_account_name,
  fact.primary_party_id as party_id,
  fact.canonical_account_name as party_name,
  fact.role_type,
  fact.role_class,
  fact.party_origin,
  fact.piscfh_code,
  fact.fund_id,
  fact.fund_name,
  array[fact.asset_name]::text[] as asset_names,
  fact.committed_amt,
  fact.invested_amt,
  fact.remaining_amt,
  fact.paid_in_available,
  fact.currency,
  fact.measure_type,
  fact.relationship_layer,
  fact.amount_basis,
  fact.authority_status,
  fact.economic_vehicle_key,
  'external_party'::text as capital_scope,
  true as include_in_external_investor_rollup,
  false as is_managed_fund_party,
  false as is_internal_fund_lookthrough_shell,
  'delegated_source_lookthrough'::text as relationship_quality,
  array['수익자별 투입액 미제공']::text[] as review_statuses,
  ('One Account ' || fact.snapshot_version || ' · 위탁운용 약정 look-through · 수익자별 투입액 미제공')::text as remarks
from public.delegated_beneficiary_lookthrough_fact fact
join latest using (source_snapshot_date);

alter view public.one_account_party_bridge_current_v1 set (security_invoker = true);
alter view public.one_account_delegated_exposure_current_v1 set (security_invoker = true);

comment on table public.delegated_beneficiary_source_fact is
  'Authoritative delegated-beneficiary source rows at fund-group × source-investor grain; unresolved identities remain visible.';
comment on table public.delegated_beneficiary_lookthrough_fact is
  'Derived economic Account-to-investee-fund exposure. Commitment only; never treated as direct legal exposure or paid-in capital.';
comment on view public.one_account_delegated_exposure_current_v1 is
  'Current One Account delegated look-through projection for RA Portal capital-relationship UI. It is not consumed by Portfolio AUM.';

alter table public.one_account_party_bridge enable row level security;
alter table public.delegated_beneficiary_source_fact enable row level security;
alter table public.delegated_beneficiary_lookthrough_fact enable row level security;

drop policy if exists one_account_party_bridge_read on public.one_account_party_bridge;
drop policy if exists one_account_party_bridge_authenticated_read on public.one_account_party_bridge;
drop policy if exists delegated_beneficiary_source_read on public.delegated_beneficiary_source_fact;
drop policy if exists delegated_beneficiary_lookthrough_read on public.delegated_beneficiary_lookthrough_fact;
drop policy if exists delegated_beneficiary_lookthrough_authenticated_read on public.delegated_beneficiary_lookthrough_fact;

revoke all privileges on public.one_account_party_bridge,
  public.delegated_beneficiary_source_fact,
  public.delegated_beneficiary_lookthrough_fact,
  public.one_account_party_bridge_current_v1,
  public.one_account_delegated_exposure_current_v1 from anon, authenticated;

notify pgrst, 'reload schema';
commit;