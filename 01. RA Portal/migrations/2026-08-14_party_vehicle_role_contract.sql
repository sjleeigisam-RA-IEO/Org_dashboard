-- Separate LP identities from fund/REIT/SPC investment vehicles.
-- Geographic origin remains in party_origin and is never used as a substitute for role type.

begin;
set local statement_timeout = 0;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('party_vehicle_role_contract_20260814'));

create schema if not exists ra_archive;

create table if not exists ra_archive.party_role_classifications_before_vehicle_role_20260814 as
select classification.*, now() as archived_at
from public.party_role_classifications classification
where classification.role_type = 'beneficiary'
  and classification.valid_to is null;

create or replace function public.normalize_managed_vehicle_name(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select public.normalize_party_key(
    regexp_replace(
      regexp_replace(
        btrim(coalesce(p_value, '')),
        '^[[:space:]]*(주식회사|㈜)[[:space:]]*',
        '',
        'i'
      ),
      '[[:space:]]*\(([0-9]+(의[0-9]+)?종|운용|class[[:space:]]+[[:alnum:]-]+|c[0-9]+)\)[[:space:]]*$',
      '',
      'gi'
    )
  );
$$;

create or replace function public.is_beneficiary_investment_vehicle_name(p_value text)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    nullif(btrim(coalesce(p_value, '')), '') is not null
    and btrim(p_value) !~* '^개인투자자[[:space:]]*포함'
    and btrim(p_value) !~* '(자산운용|투자운용|투자신탁운용)[[:space:]]*$'
    and btrim(p_value) !~* '^메리츠[[:space:]]*$'
    and (
      btrim(p_value) ~* '리츠[[:space:]]*$'
      or btrim(p_value) ~* '위탁관리부동산투자회사[[:space:]]*$'
      or btrim(p_value) ~* '투자신탁'
      or btrim(p_value) ~* '사모.*투자(유한)?회사'
      or btrim(p_value) ~* '\(?PFV\)?[[:space:]]*$'
      or btrim(p_value) ~* '([0-9]+호[[:space:]]*)?펀드[[:space:]]*$'
    );
$$;

create or replace view public.party_managed_fund_resolution_v1 as
with fund_keys as (
  select
    fund.fund_id::text as fund_id,
    fund.fund_name,
    public.normalize_managed_vehicle_name(fund.fund_name) as vehicle_name_key
  from public.funds fund
  where nullif(btrim(fund.fund_name), '') is not null
),
party_keys as (
  select
    party.party_id,
    party.display_name as party_name,
    public.normalize_managed_vehicle_name(party.display_name) as vehicle_name_key
  from public.party_master party
),
brand_aliases as (
  select
    public.normalize_party_key('이지스밸류리츠') as party_name_key,
    public.normalize_managed_vehicle_name('이지스밸류플러스위탁관리부동산투자회사') as fund_name_key,
    'managed_reit_brand_alias'::text as match_type,
    1.000::numeric(4, 3) as confidence
  union all
  select
    public.normalize_party_key('이지스글로벌레지던스리츠'),
    public.normalize_managed_vehicle_name('이지스글로벌레지던스위탁관리부동산투자회사'),
    'managed_reit_brand_alias'::text,
    1.000::numeric(4, 3)
),
fund_matches as (
  select
    party.party_id,
    party.party_name,
    fund.fund_id,
    fund.fund_name,
    'normalized_legal_name'::text as match_type,
    1.000::numeric(4, 3) as confidence
  from party_keys party
  join fund_keys fund on fund.vehicle_name_key = party.vehicle_name_key

  union all

  select
    party.party_id,
    party.party_name,
    fund.fund_id,
    fund.fund_name,
    alias.match_type,
    alias.confidence
  from party_keys party
  join brand_aliases alias
    on alias.party_name_key = public.normalize_party_key(party.party_name)
  join fund_keys fund on fund.vehicle_name_key = alias.fund_name_key
),
matched_resolution as (
  select
    match.party_id,
    min(match.party_name) as party_name,
    array_agg(distinct match.fund_id order by match.fund_id) as managed_fund_ids,
    array_agg(distinct match.fund_name order by match.fund_name) as managed_fund_names,
    case
      when bool_or(match.match_type = 'managed_reit_brand_alias') then 'managed_reit_brand_alias'
      else 'normalized_legal_name'
    end as resolution_type,
    max(match.confidence)::numeric(4, 3) as confidence,
    'confirmed'::text as resolution_status,
    'fund_master_normalized_vehicle_contract'::text as resolution_basis
  from fund_matches match
  group by match.party_id
),
inferred_managed_vehicle as (
  select
    party.party_id,
    party.display_name as party_name,
    array[]::text[] as managed_fund_ids,
    array[]::text[] as managed_fund_names,
    'igis_managed_vehicle_name'::text as resolution_type,
    0.950::numeric(4, 3) as confidence,
    'confirmed'::text as resolution_status,
    'igis_name_and_legal_vehicle_form_contract'::text as resolution_basis
  from public.party_master party
  where party.display_name ~* '^[[:space:]]*이지스'
    and public.is_beneficiary_investment_vehicle_name(party.display_name)
    and not exists (
      select 1 from matched_resolution matched where matched.party_id = party.party_id
    )
    and exists (
      select 1 from public.beneficiary_exposures exposure where exposure.party_id = party.party_id
    )
),
resolved as (
  select * from matched_resolution
  union all
  select * from inferred_managed_vehicle
),
resolved_funds as (
  select resolved.party_id, unnest(resolved.managed_fund_ids) as fund_id
  from resolved
),
upstream_coverage as (
  select
    resolved_funds.party_id,
    count(distinct upstream.exposure_uid)::int as upstream_beneficiary_rows,
    count(distinct upstream.party_id)::int as upstream_beneficiary_parties,
    coalesce(sum(upstream.committed_amt), 0)::bigint as upstream_committed_amt
  from resolved_funds
  join public.party_exposure_commitment_current upstream
    on upstream.role_type = 'beneficiary'
   and upstream.fund_id::text = resolved_funds.fund_id
  group by resolved_funds.party_id
)
select
  resolved.*,
  coalesce(upstream_coverage.upstream_beneficiary_rows, 0)::int as upstream_beneficiary_rows,
  coalesce(upstream_coverage.upstream_beneficiary_parties, 0)::int as upstream_beneficiary_parties,
  coalesce(upstream_coverage.upstream_committed_amt, 0)::bigint as upstream_committed_amt,
  case
    when coalesce(upstream_coverage.upstream_beneficiary_rows, 0) > 0 then 'direct_upstream_available'
    else 'direct_upstream_missing'
  end as lookthrough_coverage_status
from resolved
left join upstream_coverage on upstream_coverage.party_id = resolved.party_id;

comment on view public.party_managed_fund_resolution_v1 is
  'IGIS-managed fund/REIT identity resolution using normalized legal names, confirmed brand aliases and strong managed-vehicle legal-name evidence.';

create or replace view public.beneficiary_vehicle_role_resolution_v1 as
with source_categories as (
  select
    exposure.party_id,
    array_agg(distinct metadata.source_beneficiary_category order by metadata.source_beneficiary_category)
      filter (where nullif(btrim(metadata.source_beneficiary_category), '') is not null) as source_categories
  from public.beneficiary_exposures exposure
  left join public.beneficiary_exposure_source_metadata metadata
    on metadata.exposure_id = exposure.id
  group by exposure.party_id
),
candidates as (
  select
    party.party_id,
    party.display_name as party_name,
    coalesce(source.source_categories, array[]::text[]) as source_categories,
    managed.party_id is not null as is_internal_managed_vehicle,
    managed.resolution_type as managed_resolution_type,
    case
      when coalesce(source.source_categories, array[]::text[]) && array['상장공모리츠']::text[] then '상장공모리츠'
      when coalesce(source.source_categories, array[]::text[]) && array['사모리츠']::text[] then '사모리츠'
      when coalesce(source.source_categories, array[]::text[]) && array['펀드']::text[] then '펀드'
      when party.display_name ~* '\(?PFV\)?[[:space:]]*$' then 'PFV'
      when party.display_name ~* '(리츠|위탁관리부동산투자회사)[[:space:]]*$' then '리츠'
      when public.is_beneficiary_investment_vehicle_name(party.display_name) then '펀드'
      else '투자기구'
    end as vehicle_subtype,
    case
      when managed.party_id is not null then managed.resolution_basis
      when coalesce(source.source_categories, array[]::text[]) && array['상장공모리츠', '사모리츠', '펀드']::text[]
        then '2026-07-13 외부검증 원천 투자기구 분류'
      else '법적 투자기구 명칭 계약'
    end as resolution_basis,
    case
      when managed.party_id is not null then managed.confidence
      when coalesce(source.source_categories, array[]::text[]) && array['상장공모리츠', '사모리츠', '펀드']::text[]
        then 1.000::numeric(4, 3)
      else 0.950::numeric(4, 3)
    end as confidence
  from public.party_master party
  left join source_categories source on source.party_id = party.party_id
  left join public.party_managed_fund_resolution_v1 managed on managed.party_id = party.party_id
  where exists (
    select 1 from public.beneficiary_exposures exposure where exposure.party_id = party.party_id
  )
    and party.display_name !~* '^개인투자자[[:space:]]*포함'
    and (
      managed.party_id is not null
      or coalesce(source.source_categories, array[]::text[]) && array['상장공모리츠', '사모리츠', '펀드']::text[]
      or public.is_beneficiary_investment_vehicle_name(party.display_name)
    )
)
select * from candidates;

comment on view public.beneficiary_vehicle_role_resolution_v1 is
  'Canonical interpretation of beneficiary identities that are funds, REITs or SPCs. LP role and geographic origin remain separate.';

create or replace view public.beneficiary_identity_role_resolution_v1 as
select
  party.party_id,
  party.display_name as party_name,
  case
    when party.display_name ~* '^[[:space:]]*개인([[:space:]]|\(|$)' then '개인'
    else '금융기관'
  end::text as role_class,
  case
    when party.display_name ~* '^[[:space:]]*개인([[:space:]]|\(|$)' then '개인'
    else '자산운용사'
  end::text as role_subtype,
  case
    when party.display_name ~* '^[[:space:]]*개인([[:space:]]|\(|$)'
      then 'canonical_party_name_person_identity'
    else 'canonical_party_name_asset_manager_identity'
  end::text as resolution_basis,
  1.000::numeric(4, 3) as confidence
from public.party_master party
where exists (
    select 1 from public.beneficiary_exposures exposure where exposure.party_id = party.party_id
  )
  and not public.is_beneficiary_investment_vehicle_name(party.display_name)
  and (
    party.display_name ~* '^[[:space:]]*개인([[:space:]]|\(|$)'
    or party.display_name ~* '(자산운용|투자운용|투자신탁운용)[[:space:]]*$'
  );

comment on view public.beneficiary_identity_role_resolution_v1 is
  'Identity-first beneficiary role overrides: a named person remains 개인 and an asset manager remains 금융기관 even when source categories describe an underlying fund.';

alter table public.party_role_classifications
  drop constraint if exists party_role_classifications_class_check;

alter table public.party_role_classifications
  add constraint party_role_classifications_class_check check (
    (role_type = 'beneficiary' and role_class in
      ('국내LP', '해외LP', '펀드·리츠·SPC', '금융기관', '일반기업', '공기업', '개인', '기타'))
    or
    (role_type = 'lender' and role_class in
      ('은행', '보험', '증권', '저축은행', '캐피탈·여전', '신용협동조합',
       '새마을금고', '유동화SPV', '펀드·투자기구', '자산운용', '대주단',
       '일반기업', '개인', '기타', '미확인'))
  );

create or replace function public.refresh_beneficiary_vehicle_role_contract()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.party_role_classifications classification
  set
    classification_scheme = 'beneficiary_vehicle_role_v1',
    role_class = '펀드·리츠·SPC',
    role_subtype = resolution.vehicle_subtype,
    classification_basis = resolution.resolution_basis,
    confidence = resolution.confidence,
    review_status = 'confirmed',
    updated_at = now()
  from public.beneficiary_vehicle_role_resolution_v1 resolution
  where classification.party_id = resolution.party_id
    and classification.role_type = 'beneficiary'
    and classification.valid_to is null;

  insert into public.party_role_classifications (
    classification_id, party_id, role_type, classification_scheme,
    role_class, role_subtype, classification_basis, confidence,
    review_status, valid_from, source_file, updated_at
  )
  select
    'prc_' || substr(md5(concat_ws('|', 'beneficiary', resolution.party_id)), 1, 24),
    resolution.party_id, 'beneficiary', 'beneficiary_vehicle_role_v1',
    '펀드·리츠·SPC', resolution.vehicle_subtype, resolution.resolution_basis,
    resolution.confidence, 'confirmed', date '1900-01-01',
    'beneficiary_vehicle_role_contract_20260814', now()
  from public.beneficiary_vehicle_role_resolution_v1 resolution
  where not exists (
    select 1
    from public.party_role_classifications classification
    where classification.party_id = resolution.party_id
      and classification.role_type = 'beneficiary'
      and classification.valid_to is null
  );

  update public.party_role_classifications classification
  set
    classification_scheme = 'beneficiary_identity_role_v1',
    role_class = resolution.role_class,
    role_subtype = resolution.role_subtype,
    classification_basis = resolution.resolution_basis,
    confidence = resolution.confidence,
    review_status = 'confirmed',
    updated_at = now()
  from public.beneficiary_identity_role_resolution_v1 resolution
  where classification.party_id = resolution.party_id
    and classification.role_type = 'beneficiary'
    and classification.valid_to is null;

  insert into public.party_role_classifications (
    classification_id, party_id, role_type, classification_scheme,
    role_class, role_subtype, classification_basis, confidence,
    review_status, valid_from, source_file, updated_at
  )
  select
    'prc_' || substr(md5(concat_ws('|', 'beneficiary', resolution.party_id)), 1, 24),
    resolution.party_id, 'beneficiary', 'beneficiary_identity_role_v1',
    resolution.role_class, resolution.role_subtype, resolution.resolution_basis,
    resolution.confidence, 'confirmed', date '1900-01-01',
    'beneficiary_vehicle_role_contract_20260814', now()
  from public.beneficiary_identity_role_resolution_v1 resolution
  where not exists (
    select 1
    from public.party_role_classifications classification
    where classification.party_id = resolution.party_id
      and classification.role_type = 'beneficiary'
      and classification.valid_to is null
  );
end;
$$;

select public.refresh_beneficiary_vehicle_role_contract();

create or replace function public.enforce_beneficiary_vehicle_role_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.party_id is null then return new; end if;

  update public.party_role_classifications classification
  set
    classification_scheme = 'beneficiary_vehicle_role_v1',
    role_class = '펀드·리츠·SPC',
    role_subtype = resolution.vehicle_subtype,
    classification_basis = resolution.resolution_basis,
    confidence = resolution.confidence,
    review_status = 'confirmed',
    updated_at = now()
  from public.beneficiary_vehicle_role_resolution_v1 resolution
  where resolution.party_id = new.party_id
    and classification.party_id = resolution.party_id
    and classification.role_type = 'beneficiary'
    and classification.valid_to is null;

  update public.party_role_classifications classification
  set
    classification_scheme = 'beneficiary_identity_role_v1',
    role_class = resolution.role_class,
    role_subtype = resolution.role_subtype,
    classification_basis = resolution.resolution_basis,
    confidence = resolution.confidence,
    review_status = 'confirmed',
    updated_at = now()
  from public.beneficiary_identity_role_resolution_v1 resolution
  where resolution.party_id = new.party_id
    and classification.party_id = resolution.party_id
    and classification.role_type = 'beneficiary'
    and classification.valid_to is null;

  return new;
end;
$$;

drop trigger if exists beneficiary_vehicle_role_contract_trigger on public.beneficiary_exposures;
create trigger beneficiary_vehicle_role_contract_trigger
after insert or update of beneficiary_raw, beneficiary_clean, party_id
on public.beneficiary_exposures
for each row execute function public.enforce_beneficiary_vehicle_role_contract();

refresh materialized view ra_internal.party_exposure_fact_cache;

create or replace view public.party_external_investor_rollup_audit as
select
  role_type,
  role_class,
  capital_scope,
  include_in_external_investor_rollup,
  count(*)::int as exposure_rows,
  count(distinct party_id)::int as party_count,
  count(distinct fund_id)::int as target_fund_count,
  coalesce(sum(committed_amt), 0)::bigint as committed_amt,
  coalesce(sum(invested_amt), 0)::bigint as invested_amt,
  coalesce(sum(drawn_amt), 0)::bigint as drawn_amt,
  coalesce(sum(remaining_amt), 0)::bigint as remaining_amt,
  lookthrough_coverage_status
from public.party_exposure_external_current_v1
group by role_type, role_class, capital_scope,
  include_in_external_investor_rollup, lookthrough_coverage_status;

create or replace view public.party_vehicle_role_contract_audit as
with direct_totals as (
  select
    role_type,
    count(*)::bigint as direct_rows,
    coalesce(sum(committed_amt), 0)::bigint as direct_committed,
    coalesce(sum(primary_amount), 0)::bigint as direct_primary,
    coalesce(sum(remaining_amt), 0)::bigint as direct_remaining
  from public.party_exposure_commitment_current
  group by role_type
),
scope_totals as (
  select
    role_type,
    count(*)::bigint as scope_rows,
    coalesce(sum(committed_amt), 0)::bigint as scope_committed,
    coalesce(sum(primary_amount), 0)::bigint as scope_primary,
    coalesce(sum(remaining_amt), 0)::bigint as scope_remaining
  from public.party_exposure_external_current_v1
  group by role_type
)
select
  direct.role_type,
  direct.direct_rows,
  scope.scope_rows,
  direct.direct_committed,
  scope.scope_committed,
  direct.direct_primary,
  scope.scope_primary,
  direct.direct_remaining,
  scope.scope_remaining,
  direct.direct_rows = scope.scope_rows
    and direct.direct_committed = scope.scope_committed
    and direct.direct_primary = scope.scope_primary
    and direct.direct_remaining = scope.scope_remaining as direct_scope_totals_match,
  (select count(*)::int
   from public.party_exposure_external_current_v1 row
   where row.role_type = 'beneficiary'
     and row.role_class in ('국내LP', '해외LP')
     and row.is_managed_fund_party) as managed_vehicles_still_classified_as_lp,
  (select count(*)::int
   from public.party_exposure_external_current_v1 row
   join public.beneficiary_vehicle_role_resolution_v1 vehicle
     on vehicle.party_id = row.party_id
   where row.role_type = 'beneficiary'
     and row.role_class in ('국내LP', '해외LP')) as resolved_vehicles_still_classified_as_lp,
  (select count(*)::int
   from public.party_exposure_external_current_v1 row
   where row.role_type = 'beneficiary'
     and row.party_name in ('이지스밸류리츠', '이지스밸류플러스위탁관리부동산투자회사')
     and (row.role_class <> '펀드·리츠·SPC'
       or row.include_in_external_investor_rollup)) as invalid_value_reit_rows
from direct_totals direct
join scope_totals scope using (role_type);

do $verify_vehicle_role_contract$
declare
  failure_count int;
begin
  select count(*) into failure_count
  from public.party_vehicle_role_contract_audit audit
  where audit.direct_scope_totals_match is not true
     or audit.managed_vehicles_still_classified_as_lp <> 0
     or audit.resolved_vehicles_still_classified_as_lp <> 0
     or audit.invalid_value_reit_rows <> 0;

  if failure_count <> 0 then
    raise exception 'party vehicle role contract verification failed: % rows', failure_count;
  end if;
end;
$verify_vehicle_role_contract$;

revoke all on function public.refresh_beneficiary_vehicle_role_contract() from public;
grant execute on function public.refresh_beneficiary_vehicle_role_contract() to service_role;
grant select on public.beneficiary_vehicle_role_resolution_v1 to anon, authenticated;
grant select on public.beneficiary_identity_role_resolution_v1 to anon, authenticated;
grant select on public.party_vehicle_role_contract_audit to anon, authenticated;

notify pgrst, 'reload schema';
commit;
