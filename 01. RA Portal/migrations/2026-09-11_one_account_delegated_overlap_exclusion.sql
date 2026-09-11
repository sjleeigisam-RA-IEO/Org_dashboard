-- Keep delegated look-through estimates separate from authoritative direct rows.
-- A source fact is retained, but the portal projection suppresses the estimate
-- whenever the same beneficiary already has a direct row for the same fund.

begin;

drop view if exists public.one_account_delegated_exposure_current_v1;
drop view if exists public.one_account_delegated_overlap_audit_v1;

create view public.one_account_delegated_overlap_audit_v1 as
with latest as (
  select max(source_snapshot_date) as source_snapshot_date
  from public.delegated_beneficiary_lookthrough_fact
)
select
  fact.exposure_id as delegated_exposure_id,
  fact.snapshot_version,
  fact.source_snapshot_date,
  fact.account_id,
  fact.canonical_account_name,
  fact.primary_party_id as party_id,
  fact.fund_id,
  fact.fund_name,
  fact.asset_name,
  fact.committed_amt as delegated_committed_amt,
  fact.amount_basis as delegated_amount_basis,
  fact.authority_status as delegated_authority_status,
  direct_row.exposure_uid as kept_exposure_id,
  direct_row.base_date as kept_base_date,
  direct_row.committed_amt as kept_committed_amt,
  'DIRECT_AUTHORITY_SAME_PARTY_FUND'::text as exclusion_rule
from public.delegated_beneficiary_lookthrough_fact fact
join latest using (source_snapshot_date)
join lateral (
  select
    direct.exposure_uid,
    direct.base_date,
    direct.committed_amt
  from public.party_exposure_external_current_v1 direct
  where direct.role_type = 'beneficiary'
    and direct.party_id = fact.primary_party_id
    and direct.fund_id = fact.fund_id
    and coalesce(direct.include_in_external_investor_rollup, true)
    and not coalesce(direct.is_managed_fund_party, false)
    and not coalesce(direct.is_internal_fund_lookthrough_shell, false)
    and coalesce(direct.capital_scope, 'external_party') not in
      ('internal_managed_fund', 'internal_fund_lookthrough_shell')
  order by direct.base_date desc nulls last, direct.exposure_uid
  limit 1
) direct_row on true;

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
      then array[
        '재간접 약정액 비례배분 추정',
        '수익자별 투입·미투입 미수집',
        'Account 관계분류 검토 필요'
      ]::text[]
    else array[
      '재간접 약정액 비례배분 추정',
      '수익자별 투입·미투입 미수집'
    ]::text[]
  end as review_statuses,
  ('One Account ' || fact.snapshot_version
    || ' · 재간접 경제적 귀속 약정 추정'
    || ' · 직접 원천 우선 중복 제거'
    || ' · 수익자별 투입·미투입 미수집')::text as remarks
from public.delegated_beneficiary_lookthrough_fact fact
join latest using (source_snapshot_date)
left join public.one_account_profile_current_v1 profile
  on profile.account_id = fact.account_id
where not exists (
  select 1
  from public.party_exposure_external_current_v1 direct
  where direct.role_type = 'beneficiary'
    and direct.party_id = fact.primary_party_id
    and direct.fund_id = fact.fund_id
    and coalesce(direct.include_in_external_investor_rollup, true)
    and not coalesce(direct.is_managed_fund_party, false)
    and not coalesce(direct.is_internal_fund_lookthrough_shell, false)
    and coalesce(direct.capital_scope, 'external_party') not in
      ('internal_managed_fund', 'internal_fund_lookthrough_shell')
);

alter view public.one_account_delegated_overlap_audit_v1 set (security_invoker = true);
alter view public.one_account_delegated_exposure_current_v1 set (security_invoker = true);

comment on view public.one_account_delegated_overlap_audit_v1 is
  'Delegated estimates excluded from portal totals because an authoritative direct beneficiary row exists for the same party and fund.';
comment on view public.one_account_delegated_exposure_current_v1 is
  'Current delegated look-through estimates after direct-authority overlap exclusion. RM is excluded; paid-in and remaining amounts remain uncollected.';

revoke all privileges on public.one_account_delegated_overlap_audit_v1,
  public.one_account_delegated_exposure_current_v1 from anon, authenticated;

notify pgrst, 'reload schema';
commit;
