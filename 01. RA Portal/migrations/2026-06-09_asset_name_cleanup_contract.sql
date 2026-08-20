-- Asset name cleanup contract.
-- Policy: asset display/search names should represent physical real estate only.
-- Financial instruments, securities, fund interests, and fund-like names are suppressed
-- from the display-name contract while preserving original canonical_name as provenance.

alter table public.asset_master
    add column if not exists physical_asset_name text,
    add column if not exists non_physical_asset_label text,
    add column if not exists asset_name_cleanup_action text not null default 'undecided',
    add column if not exists asset_name_cleanup_reason text,
    add column if not exists asset_name_cleaned_at timestamptz;

create or replace function public.ra_strip_asset_instrument_terms(input_name text)
returns text
language sql
immutable
as $$
    select nullif(
        btrim(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(
            regexp_replace(coalesce(input_name, ''),
                '\s+Senior\s+Mezzanine\s+Loan\b.*$', '', 'i'),
                '\s+Junior\s+Mezzanine\s+Loan\b.*$', '', 'i'),
                '\s+Mezzanine\s+Loan\b.*$', '', 'i'),
                '\s+Senior\s+B-?Note\s+Loan\b.*$', '', 'i'),
                '\s+B-?Note\s+Loan\b.*$', '', 'i'),
                '\s+A2-?Note\s+Loan\b.*$', '', 'i'),
                '\s+Senior\s+Loan\b.*$', '', 'i'),
                '\s+CMBS\s+Loan\b.*$', '', 'i'),
                '\s+Rescue\s+Capital\s+Loan\b.*$', '', 'i'),
                '\s+\(Term\s+Facility\)\s*$', '', 'i'),
                '\s+\(Standby\s+Facility\)\s*$', '', 'i'),
                '\s+Bridge\s+Loan\b.*$', '', 'i'),
                '\s+(담보대출|대출채권|대출\s*투자).*$',
                '',
                'i'
            )
        ),
        ''
    );
$$;

create or replace function public.ra_asset_instrument_label(input_name text, input_asset_type text)
returns text
language sql
immutable
as $$
    select case
        when coalesce(input_name, '') ~* '(전환사채|\mcb\M)' then '전환사채'
        when coalesce(input_name, '') ~* '(공모주)' then '공모주'
        when coalesce(input_name, '') ~* '(rcps|상환전환우선주)' then 'RCPS'
        when coalesce(input_name, '') ~* '(상장리츠|listed reit)' then '상장리츠'
        when coalesce(input_name, '') ~* '(회사채)' then '회사채'
        when coalesce(input_name, '') ~* '(지분증권|equity|주식|기업주식)' or coalesce(input_asset_type, '') in ('기업주식', '지분증권') then '지분증권'
        when coalesce(input_name, '') ~* '(mezzanine loan|mezz loan|메자닌)' then '메자닌대출'
        when coalesce(input_name, '') ~* '(senior loan|super-senior loan|선순위)' then '선순위대출'
        when coalesce(input_name, '') ~* '(junior loan|후순위)' then '후순위대출'
        when coalesce(input_name, '') ~* '(bridge loan|brloan|브릿지)' then '브릿지론'
        when coalesce(input_name, '') ~* '(b-note|a2-note|note loan|채권)' then '노트/채권'
        when coalesce(input_name, '') ~* '(credit fund|distressed credit|direct lending|debt fund)' then '크레딧펀드'
        when (' ' || lower(coalesce(input_name, '')) || ' ') ~ '( fund| lp| l\.p\.| sicav| raif| co-invest)' then '펀드지분'
        when coalesce(input_asset_type, '') in ('금융상품', '채권', '증권') then coalesce(input_asset_type, '금융상품')
        else '비실물자산'
    end;
$$;

with fund_short_labels as (
    select
        afl.asset_id,
        string_agg(distinct coalesce(nullif(btrim(f.short_name), ''), afl.fund_id), ', ') as fund_short_label
    from public.asset_fund_links afl
    left join public.v_funds_enriched f on f.fund_id = afl.fund_id
    group by afl.asset_id
),
classified as (
    select
        am.asset_id,
        coalesce(am.asset_code, '') as asset_code_value,
        coalesce(am.canonical_name, '') as current_name,
        coalesce(am.asset_type, '') as asset_type_value,
        coalesce(am.asset_kind, '') as asset_kind_value,
        coalesce(fsl.fund_short_label, '') as fund_short_label,
        (nullif(btrim(coalesce(am.pnu, '')), '') is not null
            or nullif(btrim(coalesce(am.address_text, '')), '') is not null) as has_physical_evidence,
        coalesce(am.asset_type, '') in (
            '오피스', '오피스복합', '주거', '주거복합', '물류', '물류센터',
            '리테일', '리테일복합', '호텔', '호텔복합', '데이터센터', '특별자산', '복합(오피스)'
        ) as is_real_estate_type,
        (
            coalesce(am.canonical_name, '') ~* '(채권|증권|주식|전환사채|회사채|공모주|수익증권|금융상품|대출채권|메자닌|담보대출)'
            or coalesce(am.canonical_name, '') ~* '(bridge loan|brloan|senior loan|junior loan|mezzanine loan|b-note|a2-note|cmbs loan|rescue capital loan|term facility|standby facility|debt fund|credit fund|direct lending|principal finance|rcps|cb|eb|bw)'
            or coalesce(am.asset_type, '') in ('금융상품', '기업주식', '지분증권', '채권', '증권')
            or coalesce(am.asset_kind, '') in ('fund_interest', 'portfolio_asset', 'synthetic_bucket')
        ) as has_financial_signal,
        (
            (' ' || lower(coalesce(am.canonical_name, '')) || ' ') ~ '( fund| lp| l\.p\.| sicav| raif| co-invest| opportunity| opportunities| principal finance| direct lending)'
        ) as has_fund_like_signal
    from public.asset_master am
    left join fund_short_labels fsl on fsl.asset_id = am.asset_id
),
planned as (
    select
        asset_id,
        case
            when asset_kind_value in ('fund_interest', 'portfolio_asset', 'synthetic_bucket')
              or asset_type_value in ('금융상품', '기업주식', '지분증권', '채권', '증권')
                then null
            when has_physical_evidence and is_real_estate_type and has_financial_signal
                then public.ra_strip_asset_instrument_terms(current_name)
            when not has_physical_evidence and has_fund_like_signal
                then null
            when is_real_estate_type or has_physical_evidence
                then nullif(btrim(current_name), '')
            when has_financial_signal
                then null
            else nullif(btrim(current_name), '')
        end as physical_asset_name,
        case
            when asset_kind_value in ('fund_interest', 'portfolio_asset', 'synthetic_bucket')
              or asset_type_value in ('금융상품', '기업주식', '지분증권', '채권', '증권')
              or (not has_physical_evidence and has_fund_like_signal)
              or (has_financial_signal and not has_physical_evidence)
                then concat_ws(' · ', public.ra_asset_instrument_label(current_name, asset_type_value), nullif(fund_short_label, ''))
            else null
        end as non_physical_asset_label,
        case
            when asset_kind_value in ('fund_interest', 'portfolio_asset', 'synthetic_bucket')
              or asset_type_value in ('금융상품', '기업주식', '지분증권', '채권', '증권')
                then 'suppress_non_physical_name'
            when has_physical_evidence and is_real_estate_type and has_financial_signal
                then case
                    when public.ra_strip_asset_instrument_terms(current_name) is not null
                     and public.ra_strip_asset_instrument_terms(current_name) <> current_name
                        then 'strip_instrument_terms'
                    else 'review_financial_name_with_physical_evidence'
                end
            when not has_physical_evidence and has_fund_like_signal
                then 'suppress_fund_like_name'
            when is_real_estate_type or has_physical_evidence
                then 'keep_physical_name'
            when has_financial_signal
                then 'suppress_financial_name'
            else 'review_unknown_name'
        end as cleanup_action,
        case
            when asset_kind_value in ('fund_interest', 'portfolio_asset', 'synthetic_bucket')
              or asset_type_value in ('금융상품', '기업주식', '지분증권', '채권', '증권')
                then 'asset kind/type is non-physical financial/security exposure'
            when has_physical_evidence and is_real_estate_type and has_financial_signal
                then 'physical evidence exists, but name contains loan/security terms'
            when not has_physical_evidence and has_fund_like_signal
                then 'fund-like/security-like name has no physical address or PNU evidence'
            when is_real_estate_type or has_physical_evidence
                then 'real estate type or physical evidence exists'
            when has_financial_signal
                then 'financial/security keyword without enough physical evidence'
            else 'insufficient evidence for automatic physical name decision'
        end as cleanup_reason
    from classified
)
update public.asset_master am
set
    physical_asset_name = planned.physical_asset_name,
    non_physical_asset_label = planned.non_physical_asset_label,
    asset_name_cleanup_action = planned.cleanup_action,
    asset_name_cleanup_reason = planned.cleanup_reason,
    asset_name_cleaned_at = now(),
    metadata = case
        when planned.cleanup_action <> 'keep_physical_name'
         and not (coalesce(am.metadata, '{}'::jsonb) ? 'pre_asset_name_cleanup_canonical_name')
            then jsonb_set(coalesce(am.metadata, '{}'::jsonb), '{pre_asset_name_cleanup_canonical_name}', to_jsonb(am.canonical_name), true)
        else coalesce(am.metadata, '{}'::jsonb)
    end
from planned
where planned.asset_id = am.asset_id;

create or replace view public.asset_name_contract as
select
    asset_id,
    asset_code,
    canonical_name as source_canonical_name,
    physical_asset_name,
    non_physical_asset_label,
    coalesce(physical_asset_name, non_physical_asset_label, asset_code, asset_id) as dashboard_asset_title,
    asset_name_cleanup_action,
    asset_name_cleanup_reason,
    case when physical_asset_name is not null then true else false end as is_named_physical_asset,
    asset_type,
    asset_kind,
    address_text,
    pnu,
    review_status
from public.asset_master;

create or replace view public.asset_relationship_summary as
select
    am.asset_id,
    coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id) as canonical_name,
    am.address_text,
    am.latitude,
    am.longitude,
    am.pnu,
    am.asset_code,
    am.main_usage,
    am.gross_floor_area,
    am.site_area,
    am.review_status,
    count(distinct afl.fund_id) as fund_count,
    count(distinct apl.project_id) as project_count,
    array_remove(array_agg(distinct afl.fund_id), null) as fund_ids,
    array_remove(array_agg(distinct apl.project_id), null) as project_ids,
    am.canonical_name as source_canonical_name,
    am.physical_asset_name,
    am.non_physical_asset_label,
    am.asset_name_cleanup_action,
    am.asset_name_cleanup_reason
from public.asset_master am
left join public.asset_fund_links afl on afl.asset_id = am.asset_id
left join public.asset_project_links apl on apl.asset_id = am.asset_id
group by am.asset_id;

create or replace view public.asset_name_cleanup_audit as
select
    asset_name_cleanup_action as cleanup_action,
    count(*) as row_count
from public.asset_master
group by asset_name_cleanup_action
union all
select
    'suppressed_name_with_physical_evidence'::text,
    count(*)
from public.asset_master
where physical_asset_name is null
  and (nullif(btrim(coalesce(pnu, '')), '') is not null
       or nullif(btrim(coalesce(address_text, '')), '') is not null)
  and asset_name_cleanup_action like 'suppress%';

create index if not exists idx_asset_master_physical_asset_name on public.asset_master(physical_asset_name);
create index if not exists idx_asset_master_name_cleanup_action on public.asset_master(asset_name_cleanup_action);

comment on view public.asset_name_contract is
    'Asset display-name contract: only physical real estate names are promoted to dashboard_asset_title; financial/security names are provenance.';

comment on view public.asset_name_cleanup_audit is
    'Audit counts for the asset name cleanup policy.';
