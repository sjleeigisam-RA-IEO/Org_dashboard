-- Promote reviewed investor-name classifications into the controlled DB contract.
-- This migration follows 2026-08-13_party_origin_contract.sql.

begin;

with reviewed_names(beneficiary_name, beneficiary_cat, party_origin, country_code) as (
  values
    ('아우토스트라세', '일반기업', '국내', 'KR'),
    ('신세계', '일반기업', '국내', 'KR'),
    ('핀포인트', '일반기업', '국내', 'KR'),
    ('데피니트파트너스', '일반기업', '국내', 'KR'),
    ('아이알디브이', '일반기업', '국내', 'KR'),
    ('네오밸류', '일반기업', '국내', 'KR'),
    ('제이피어반디', '일반기업', '국내', 'KR'),
    ('동부산테마파크', '일반기업', '국내', 'KR'),
    ('디앤오', '일반기업', '국내', 'KR'),
    ('한국부동산에스앤디', '일반기업', '국내', 'KR'),
    ('게우트플래닝', '일반기업', '국내', 'KR'),
    ('이지스린', '일반기업', '국내', 'KR'),
    ('뉴익스파트너스', '일반기업', '국내', 'KR'),
    ('대림', '일반기업', '국내', 'KR'),
    ('라크라', '일반기업', '국내', 'KR'),
    ('에스제이더블유인터내셔널', '일반기업', '국내', 'KR'),
    ('더스노우볼', '일반기업', '국내', 'KR'),
    ('DNSC', '일반기업', '확인 필요', null),
    ('에이치엔아이', '일반기업', '국내', 'KR'),
    ('이노베스트', '일반기업', '국내', 'KR'),
    ('골든웨이브', '일반기업', '국내', 'KR'),
    ('밸류업베스트', '일반기업', '국내', 'KR'),
    ('디앤에스코리아', '일반기업', '국내', 'KR'),
    ('건강한시간', '일반기업', '국내', 'KR'),
    ('에스유씨플러스', '일반기업', '국내', 'KR'),
    ('이코노미쿠스', '일반기업', '국내', 'KR'),
    ('교보리얼코', '일반기업', '국내', 'KR'),
    ('스카이밸류', '일반기업', '국내', 'KR'),
    ('에스엔유비아이제트1호', '펀드', '국내', 'KR'),
    ('LX판토스', '일반기업', '국내', 'KR'),
    ('KG파트너스', '일반기업', '국내', 'KR'),
    ('진흥기업', '일반기업', '국내', 'KR'),
    ('서민이엔씨', '일반기업', '국내', 'KR')
)
insert into public.beneficiary_classification_master (
  beneficiary_key,
  beneficiary_name,
  canonical_name,
  beneficiary_cat,
  source_categories,
  source_types,
  classification_basis,
  classification_confidence,
  classification_method,
  review_status,
  notes,
  party_origin,
  domicile_country_code,
  origin_basis,
  origin_confidence,
  origin_review_status,
  updated_at
)
select
  public.normalize_beneficiary_key(reviewed.beneficiary_name),
  reviewed.beneficiary_name,
  reviewed.beneficiary_name,
  reviewed.beneficiary_cat,
  array[]::text[],
  array[]::text[],
  '확정 명칭 사전: 2026-08-13 미분류 정비',
  0.950,
  'explicit_name',
  'confirmed',
  '보고서 명칭 분류 규칙을 DB 통제분류로 승격',
  reviewed.party_origin,
  reviewed.country_code,
  case
    when reviewed.party_origin = '국내' then '확정 명칭 사전: 국내 투자자'
    else '법인명만으로 소재국 확인 필요'
  end,
  case when reviewed.party_origin = '국내' then 0.950 else 0.300 end,
  case when reviewed.party_origin = '국내' then 'confirmed' else 'review' end,
  now()
from reviewed_names reviewed
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

-- Keep the source spelling in beneficiary_raw while converging the interpreted
-- identity to the already approved canonical investor name.
update public.beneficiary_exposures exposure
set beneficiary_clean = '에스제이더블유인터내셔널'
where public.normalize_beneficiary_key(
  coalesce(nullif(btrim(exposure.beneficiary_clean), ''), exposure.beneficiary_raw)
) = public.normalize_beneficiary_key('에스제이더블유인터네셔널');

update public.beneficiary_exposures exposure
set beneficiary_clean = '디에스네트웍스'
where public.normalize_beneficiary_key(
  coalesce(nullif(btrim(exposure.beneficiary_clean), ''), exposure.beneficiary_raw)
) = public.normalize_beneficiary_key('DS네트웍스');

create or replace view public.beneficiary_classification_backfill_audit as
with reviewed_names(beneficiary_name, beneficiary_cat) as (
  values
    ('아우토스트라세', '일반기업'), ('신세계', '일반기업'),
    ('핀포인트', '일반기업'), ('데피니트파트너스', '일반기업'),
    ('아이알디브이', '일반기업'), ('네오밸류', '일반기업'),
    ('제이피어반디', '일반기업'), ('동부산테마파크', '일반기업'),
    ('디앤오', '일반기업'), ('한국부동산에스앤디', '일반기업'),
    ('게우트플래닝', '일반기업'), ('이지스린', '일반기업'),
    ('뉴익스파트너스', '일반기업'), ('대림', '일반기업'),
    ('라크라', '일반기업'), ('에스제이더블유인터내셔널', '일반기업'),
    ('더스노우볼', '일반기업'), ('DNSC', '일반기업'),
    ('에이치엔아이', '일반기업'), ('이노베스트', '일반기업'),
    ('골든웨이브', '일반기업'), ('밸류업베스트', '일반기업'),
    ('디앤에스코리아', '일반기업'), ('건강한시간', '일반기업'),
    ('에스유씨플러스', '일반기업'), ('이코노미쿠스', '일반기업'),
    ('교보리얼코', '일반기업'), ('스카이밸류', '일반기업'),
    ('에스엔유비아이제트1호', '펀드'), ('LX판토스', '일반기업'),
    ('KG파트너스', '일반기업'), ('진흥기업', '일반기업'),
    ('서민이엔씨', '일반기업')
),
allowed_unresolved(beneficiary_name) as (
  values ('비공개'), ('투자자1'), ('I.O.IV'), ('우리'), ('미정')
),
active_unclassified as (
  select distinct
    public.normalize_beneficiary_key(
      coalesce(nullif(btrim(exposure.beneficiary_clean), ''), exposure.beneficiary_raw)
    ) as beneficiary_key
  from public.beneficiary_exposures exposure
  where exposure.beneficiary_class = '미분류'
)
select
  (select count(*)::int from reviewed_names) as target_party_count,
  (
    select count(*)::int
    from reviewed_names reviewed
    join public.beneficiary_classification_master master
      on master.beneficiary_key = public.normalize_beneficiary_key(reviewed.beneficiary_name)
     and master.beneficiary_cat = reviewed.beneficiary_cat
     and master.review_status = 'confirmed'
  ) as resolved_target_party_count,
  (select count(*)::int from active_unclassified) as remaining_unclassified_party_count,
  not exists (
    select 1
    from active_unclassified active
    where active.beneficiary_key not in (
      select public.normalize_beneficiary_key(allowed.beneficiary_name)
      from allowed_unresolved allowed
    )
  ) as remaining_unclassified_only_allowed,
  coalesce((select gic_contract_valid from public.party_origin_contract_audit), false)
    as gic_contract_valid,
  coalesce((select origin_subtotals_match from public.party_origin_contract_audit), false)
    as origin_subtotals_match;

grant select on public.beneficiary_classification_backfill_audit to anon, authenticated;

comment on view public.beneficiary_classification_backfill_audit is
  'Verifies the reviewed name backfill, the five intentionally unresolved investor labels, GIC, and amount partitions.';

commit;
