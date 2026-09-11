-- One Account v1.6 RM-scope Account profile integration.
-- Account relationship classifications are projected to the capital dashboard.
-- Provisional RM assignments remain in a restricted base table and are never
-- exposed by the portal-serving view or Edge Function.

begin;

create table if not exists public.one_account_profile (
  snapshot_version text not null,
  source_snapshot_id text not null,
  source_snapshot_date date not null,
  account_id text not null,
  canonical_account_name text not null,
  account_category text,
  account_roles text[] not null default '{}'::text[],
  aliases jsonb not null default '[]'::jsonb check (jsonb_typeof(aliases) = 'array'),
  merged_from_account_ids text[] not null default '{}'::text[],
  split_from_account_id text,
  entity_resolution_status text,
  validation_status text,
  piscfh_code text check (piscfh_code is null or piscfh_code in ('P', 'I', 'S', 'C', 'F', 'H')),
  piscfh_label text,
  investor_class text,
  portal_role_class text not null check (portal_role_class in
    ('국내LP', '해외LP', '펀드·리츠·SPC', '금융기관', '일반기업', '공기업', '개인', '기타')),
  classification_version text,
  classification_rule text,
  classification_confidence text,
  classification_status text,
  classification_review_status text not null check (classification_review_status in ('confirmed', 'review')),
  classification_source_file text,
  classification_source_sha256 text,
  classification_source_sheet text,
  classification_source_rows jsonb not null default '[]'::jsonb
    check (jsonb_typeof(classification_source_rows) = 'array'),
  classification_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(classification_evidence) = 'object'),
  portal_party_link_status text not null check (portal_party_link_status in ('linked', 'review', 'unresolved')),
  portal_party_count integer not null default 0 check (portal_party_count >= 0),
  primary_rm_id text,
  primary_rm_name text,
  primary_rm_title text,
  primary_rm_org text,
  primary_rm_updated_at timestamptz,
  backup_rm_id text,
  backup_rm_name text,
  backup_rm_title text,
  backup_rm_org text,
  backup_rm_updated_at timestamptz,
  sponsor_rm_id text,
  sponsor_rm_name text,
  sponsor_rm_title text,
  sponsor_rm_org text,
  sponsor_rm_updated_at timestamptz,
  rm_status text not null default 'draft' check (rm_status in ('draft', 'confirmed')),
  rm_is_confirmed boolean not null default false,
  rm_assignment_source text not null,
  source_file text not null,
  source_sha256 text not null,
  updated_at timestamptz not null default now(),
  primary key (snapshot_version, account_id),
  check (not rm_is_confirmed or rm_status = 'confirmed')
);

create index if not exists one_account_profile_account_date_idx
  on public.one_account_profile (account_id, source_snapshot_date desc);
create index if not exists one_account_profile_portal_class_idx
  on public.one_account_profile (portal_role_class, source_snapshot_date desc);

create table if not exists public.one_account_profile_party_bridge (
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
  primary key (snapshot_version, account_id, party_id),
  foreign key (snapshot_version, account_id)
    references public.one_account_profile(snapshot_version, account_id) on delete cascade
);

create unique index if not exists one_account_profile_party_one_primary_idx
  on public.one_account_profile_party_bridge (snapshot_version, account_id)
  where is_primary;
create index if not exists one_account_profile_party_party_idx
  on public.one_account_profile_party_bridge (party_id, source_snapshot_date desc);

create or replace view public.one_account_profile_current_v1 as
select ranked.*
from (
  select
    profile.*,
    row_number() over (
      partition by profile.account_id
      order by profile.source_snapshot_date desc, profile.updated_at desc, profile.snapshot_version desc
    ) as source_rank
  from public.one_account_profile profile
) ranked
where ranked.source_rank = 1;

drop view if exists public.one_account_portal_party_bridge_current_v1;
create view public.one_account_portal_party_bridge_current_v1 as
with profile_bridge as (
  select
    bridge.source_snapshot_date,
    bridge.account_id,
    bridge.canonical_account_name,
    bridge.party_id,
    bridge.is_primary,
    bridge.resolution_method,
    bridge.resolution_status,
    bridge.resolution_basis,
    profile.account_category,
    profile.piscfh_code,
    profile.piscfh_label,
    profile.investor_class,
    profile.portal_role_class,
    profile.classification_status,
    profile.classification_review_status,
    1 as source_priority
  from public.one_account_profile_party_bridge bridge
  join public.one_account_profile_current_v1 profile
    on profile.snapshot_version = bridge.snapshot_version
   and profile.account_id = bridge.account_id
), legacy_bridge as (
  select
    bridge.source_snapshot_date,
    bridge.account_id,
    bridge.canonical_account_name,
    bridge.party_id,
    bridge.is_primary,
    bridge.resolution_method,
    bridge.resolution_status,
    bridge.resolution_basis,
    null::text as account_category,
    null::text as piscfh_code,
    null::text as piscfh_label,
    null::text as investor_class,
    null::text as portal_role_class,
    null::text as classification_status,
    null::text as classification_review_status,
    2 as source_priority
  from public.one_account_party_bridge_current_v1 bridge
), combined as (
  select * from profile_bridge
  union all
  select * from legacy_bridge
), ranked as (
  select
    combined.*,
    row_number() over (
      partition by combined.party_id
      order by combined.source_priority, combined.is_primary desc,
        combined.source_snapshot_date desc, combined.account_id
    ) as party_rank
  from combined
)
select
  source_snapshot_date,
  account_id,
  canonical_account_name,
  party_id,
  is_primary,
  resolution_method,
  resolution_status,
  resolution_basis,
  account_category,
  piscfh_code,
  piscfh_label,
  investor_class,
  portal_role_class,
  classification_status,
  classification_review_status
from ranked
where party_rank = 1;

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
  coalesce(profile.portal_role_class, fact.role_class) as role_class,
  coalesce(nullif(profile.investor_class, '미분류'), profile.piscfh_label) as role_subtype,
  fact.party_origin,
  coalesce(profile.piscfh_code, fact.piscfh_code) as piscfh_code,
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
  case
    when profile.classification_review_status = 'review'
      then array['수익자별 투입액 미제공', 'Account 관계분류 검토 필요']::text[]
    else array['수익자별 투입액 미제공']::text[]
  end as review_statuses,
  ('One Account ' || fact.snapshot_version || ' · 위탁운용 약정 look-through · 수익자별 투입액 미제공')::text as remarks
from public.delegated_beneficiary_lookthrough_fact fact
join latest using (source_snapshot_date)
left join public.one_account_profile_current_v1 profile
  on profile.account_id = fact.account_id;

alter view public.one_account_profile_current_v1 set (security_invoker = true);
alter view public.one_account_portal_party_bridge_current_v1 set (security_invoker = true);
alter view public.one_account_delegated_exposure_current_v1 set (security_invoker = true);

comment on table public.one_account_profile is
  'One Account classification profile. RM fields are provisional and restricted from all portal-serving projections.';
comment on table public.one_account_profile_party_bridge is
  'Account-to-party bridge for the v1.6 RM-scope Account set; separate from the delegated-beneficiary bridge.';
comment on view public.one_account_portal_party_bridge_current_v1 is
  'Portal-safe Account bridge with relationship classifications only. RM fields are intentionally absent.';
comment on view public.one_account_delegated_exposure_current_v1 is
  'Current delegated look-through projection enriched with the latest Account relationship classification; RM is excluded.';

alter table public.one_account_profile enable row level security;
alter table public.one_account_profile_party_bridge enable row level security;

drop policy if exists one_account_profile_read on public.one_account_profile;
drop policy if exists one_account_profile_authenticated_read on public.one_account_profile;
drop policy if exists one_account_profile_party_read on public.one_account_profile_party_bridge;
drop policy if exists one_account_profile_party_authenticated_read on public.one_account_profile_party_bridge;

revoke all privileges on public.one_account_profile,
  public.one_account_profile_party_bridge,
  public.one_account_profile_current_v1,
  public.one_account_portal_party_bridge_current_v1,
  public.one_account_delegated_exposure_current_v1 from anon, authenticated;

notify pgrst, 'reload schema';
commit;
