-- Expand the progressive asset map from the overseas-only normalization set to
-- every physical asset. Existing manual decisions are immutable in this pass.

begin;

-- Reuse an already reviewed coordinate when another canonical asset row carries
-- the same durable asset code. This preserves evidence and avoids re-geocoding.
with ranked_source as (
  select
    location.*,
    row_number() over (
      partition by location.asset_code
      order by
        case location.review_status
          when 'manually_verified' then 1
          when 'auto_verified' then 2
          when 'review_required' then 3
          else 4
        end,
        location.updated_at desc,
        location.asset_id
    ) as source_rank
  from public.asset_location_normalization location
  where nullif(trim(location.asset_code), '') is not null
    and location.latitude is not null
    and location.longitude is not null
), inherited as (
  select
    asset.*,
    source.asset_id as inherited_from_asset_id,
    source.location_subject_type as inherited_subject_type,
    source.raw_country as inherited_raw_country,
    source.raw_city as inherited_raw_city,
    source.raw_address as inherited_raw_address,
    source.normalized_country_name as inherited_country_name,
    source.country_code_alpha2 as inherited_alpha2,
    source.country_code_alpha3 as inherited_alpha3,
    source.normalized_city as inherited_city,
    source.normalized_admin1 as inherited_admin1,
    source.normalized_postcode as inherited_postcode,
    source.latitude as inherited_latitude,
    source.longitude as inherited_longitude,
    source.coordinate_source as inherited_coordinate_source,
    source.coordinate_precision as inherited_precision,
    source.confidence as inherited_confidence,
    source.review_status as inherited_review_status,
    source.is_map_eligible as inherited_is_map_eligible,
    source.review_note as inherited_review_note,
    source.geocoder_place_id as inherited_place_id,
    source.geocoder_version as inherited_geocoder_version,
    source.candidate_fingerprint as inherited_fingerprint,
    source.evidence as inherited_evidence,
    source.reviewed_at as inherited_reviewed_at
  from public.asset_master asset
  join ranked_source source
    on source.asset_code = asset.asset_code
   and source.source_rank = 1
  left join public.asset_location_normalization existing
    on existing.asset_id = asset.asset_id
  where asset.is_physical is true
    and asset.asset_kind = 'physical_asset'
    and existing.asset_id is null
)
insert into public.asset_location_normalization (
  asset_id, asset_code, canonical_name, portfolio_region, location_subject_type,
  raw_country, raw_city, raw_address, normalized_country_name,
  country_code_alpha2, country_code_alpha3, normalized_city, normalized_admin1,
  normalized_postcode, latitude, longitude, coordinate_source,
  coordinate_precision, match_method, confidence, review_status,
  is_map_eligible, review_note, source_system, source_record_id,
  geocoder_place_id, classifier_version, geocoder_version,
  candidate_fingerprint, evidence, normalized_at, reviewed_at, updated_at
)
select
  inherited.asset_id,
  inherited.asset_code,
  inherited.canonical_name,
  inherited.portfolio_region,
  inherited.inherited_subject_type,
  coalesce(inherited.country_code, inherited.inherited_raw_country),
  coalesce(inherited.city, inherited.inherited_raw_city),
  coalesce(inherited.address_text, inherited.inherited_raw_address),
  inherited.inherited_country_name,
  inherited.inherited_alpha2,
  inherited.inherited_alpha3,
  inherited.inherited_city,
  inherited.inherited_admin1,
  inherited.inherited_postcode,
  inherited.inherited_latitude,
  inherited.inherited_longitude,
  inherited.inherited_coordinate_source,
  inherited.inherited_precision,
  'same_asset_code_inheritance',
  inherited.inherited_confidence,
  inherited.inherited_review_status,
  inherited.inherited_is_map_eligible,
  concat_ws('; ', inherited.inherited_review_note, '동일 자산코드의 검증 위치를 상속함'),
  'asset_location_normalization_inheritance',
  inherited.inherited_from_asset_id,
  inherited.inherited_place_id,
  'global-coverage-inheritance-v1',
  inherited.inherited_geocoder_version,
  md5(concat_ws('|', inherited.asset_id, inherited.asset_code, inherited.inherited_from_asset_id, inherited.inherited_latitude::text, inherited.inherited_longitude::text)) ||
    md5(concat_ws('|', 'same_asset_code_inheritance', inherited.inherited_fingerprint)),
  coalesce(inherited.inherited_evidence, '{}'::jsonb) || jsonb_build_object(
    'inherited_from_asset_id', inherited.inherited_from_asset_id,
    'inheritance_key', inherited.asset_code,
    'coverage_migration', '2026-09-10'
  ),
  now(),
  case when inherited.inherited_review_status = 'manually_verified' then coalesce(inherited.inherited_reviewed_at, now()) else inherited.inherited_reviewed_at end,
  now()
from inherited
on conflict (asset_id) do nothing;

-- Existing Korean coordinates are already held in the canonical asset table.
-- Promote those coordinates without making any external geocoding request.
with domestic_coordinates as (
  select asset.*
  from public.asset_master asset
  left join public.asset_location_normalization existing using (asset_id)
  where asset.is_physical is true
    and asset.asset_kind = 'physical_asset'
    and existing.asset_id is null
    and asset.latitude between 32.5 and 39.5
    and asset.longitude between 124 and 132
)
insert into public.asset_location_normalization (
  asset_id, asset_code, canonical_name, portfolio_region, location_subject_type,
  raw_country, raw_city, raw_address, normalized_country_name,
  country_code_alpha2, country_code_alpha3, normalized_city, normalized_admin1,
  normalized_postcode, latitude, longitude, coordinate_source,
  coordinate_precision, match_method, confidence, review_status,
  is_map_eligible, review_note, source_system, source_record_id,
  geocoder_place_id, classifier_version, geocoder_version,
  candidate_fingerprint, evidence, normalized_at, updated_at
)
select
  asset_id,
  asset_code,
  canonical_name,
  portfolio_region,
  'single_site',
  coalesce(nullif(trim(country_code), ''), '대한민국'),
  nullif(trim(city), ''),
  nullif(trim(address_text), ''),
  '대한민국',
  'KR',
  'KOR',
  coalesce(nullif(trim(city), ''), nullif(split_part(trim(address_text), ' ', 1), '')),
  nullif(split_part(trim(address_text), ' ', 1), ''),
  null,
  latitude,
  longitude,
  coalesce(nullif(trim(geocode_source), ''), 'asset_master_existing_coordinate'),
  case when nullif(trim(pnu), '') is not null or nullif(trim(address_text), '') is not null then 'address_point' else 'building' end,
  'existing_asset_master_coordinate',
  case
    when nullif(trim(pnu), '') is not null then 0.96
    when lower(coalesce(geocode_source, '')) like '%vworld%' then 0.94
    when nullif(trim(address_text), '') is not null then 0.90
    else 0.86
  end,
  'auto_verified',
  true,
  '자산 마스터의 기존 국내 좌표와 주소·PNU 출처를 승계함',
  'asset_master',
  coalesce(nullif(trim(asset_code), ''), asset_id),
  null,
  'global-coverage-existing-coordinate-v1',
  coalesce(nullif(trim(geocode_source), ''), 'asset-master-coordinate-v1'),
  md5(concat_ws('|', asset_id, asset_code, latitude::text, longitude::text, geocode_source)) ||
    md5(concat_ws('|', address_text, pnu, 'KOR', 'existing_asset_master_coordinate')),
  jsonb_build_object(
    'coverage_migration', '2026-09-10',
    'coordinate_origin', 'asset_master',
    'geocode_source', geocode_source,
    'pnu_present', nullif(trim(pnu), '') is not null,
    'external_request_made', false
  ),
  now(),
  now()
from domestic_coordinates
on conflict (asset_id) do nothing;

-- Keep every remaining physical asset visible in the management totals. Rows
-- without coordinates never become map points merely because an address exists.
with remaining as (
  select
    asset.*,
    case
      when coalesce(asset.canonical_name, '') ~* '(portfolio|포트폴리오|[0-9]+개\s*도시|복수\s*도시|BTS\s+Logistics)'
        or coalesce(asset.address_text, '') ~* '(아래\s*자산별|상세\s*내역|복수\s*도시|[0-9]+개\s*도시|미정|해당\s*없음)'
        then 'multi_site_portfolio'
      when nullif(trim(asset.address_text), '') is not null then 'single_site'
      when coalesce(asset.canonical_name, '') ~* '(대출|담보대출|선순위|메자닌|수익증권|지분증권|브릿지론|대여금|채권|(^|[^a-z])(fund|sicav|raif|scsp|co-invest|secondary|loan|note|cm(b|m)bs|mezzanine|credit\s+fund|infrastructure\s+partners)([^a-z]|$))'
        then 'non_physical_vehicle'
      else 'unresolved_subject'
    end as inferred_subject,
    case
      when asset.portfolio_region in ('대한민국', '국내', '한국')
        or coalesce(asset.address_text, '') ~ '^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충청|전북|전라|경북|경상|제주)'
        then 'KOR'
      when coalesce(asset.address_text, '') ~* '(Canada|Ontario|Montreal)' then 'CAN'
      when coalesce(asset.address_text, '') ~* '(Poland|Zabrze)' then 'POL'
      when coalesce(asset.address_text, '') ~* '(Guam|U\.S\.A\.|USA|United States|\b[A-Z]{2}\s*[0-9]{5}\b|New York|California|Texas|Florida|Washington\s*,?\s*D\.C\.)' then 'USA'
      else null
    end as inferred_country
  from public.asset_master asset
  left join public.asset_location_normalization existing using (asset_id)
  where asset.is_physical is true
    and asset.asset_kind = 'physical_asset'
    and existing.asset_id is null
)
insert into public.asset_location_normalization (
  asset_id, asset_code, canonical_name, portfolio_region, location_subject_type,
  raw_country, raw_city, raw_address, normalized_country_name,
  country_code_alpha2, country_code_alpha3, normalized_city, normalized_admin1,
  normalized_postcode, latitude, longitude, coordinate_source,
  coordinate_precision, match_method, confidence, review_status,
  is_map_eligible, review_note, source_system, source_record_id,
  geocoder_place_id, classifier_version, geocoder_version,
  candidate_fingerprint, evidence, normalized_at, updated_at
)
select
  asset_id,
  asset_code,
  canonical_name,
  portfolio_region,
  inferred_subject,
  nullif(trim(country_code), ''),
  nullif(trim(city), ''),
  nullif(trim(address_text), ''),
  case inferred_country when 'KOR' then '대한민국' when 'USA' then 'United States' when 'CAN' then 'Canada' when 'POL' then 'Poland' end,
  case inferred_country when 'KOR' then 'KR' when 'USA' then 'US' when 'CAN' then 'CA' when 'POL' then 'PL' end,
  inferred_country,
  coalesce(
    nullif(trim(city), ''),
    case
      when canonical_name ilike '%Bell%' then 'Montreal'
      when canonical_name ilike '%Booster Zabrze%' then 'Zabrze'
      when canonical_name ilike '%KPMG Plaza%' then 'Dallas'
      when canonical_name ilike '%Wilshire Grand%' then 'Los Angeles'
      when canonical_name ilike '%Courvoisier%' then 'Miami'
      when canonical_name ilike '%787 Seventh%' or canonical_name ilike '%85 Tenth%' or canonical_name ilike '%285 Madison%' then 'New York'
      when canonical_name ilike '%OJP%' or canonical_name ilike '%Atlantic Building%' then 'Washington'
      when canonical_name ilike '%Spring Creek%' then 'Brooklyn'
      when canonical_name ilike '%Chauncey Square%' then 'West Lafayette'
      when canonical_name ilike '%Toronto The One%' then 'Toronto'
      when inferred_country = 'KOR' then nullif(split_part(trim(address_text), ' ', 1), '')
    end
  ),
  case when inferred_country = 'KOR' then nullif(split_part(trim(address_text), ' ', 1), '') end,
  null,
  null,
  null,
  null,
  'unknown',
  case when inferred_subject = 'single_site' then 'source_address_without_coordinate' else 'subject_classification_only' end,
  0,
  case when inferred_subject in ('multi_site_portfolio', 'non_physical_vehicle') then 'not_single_site'
       when inferred_subject = 'single_site' then 'review_required'
       else 'unresolved' end,
  false,
  case when inferred_subject = 'single_site' then '원천 주소는 보존했으나 검증 좌표가 없어 지도 포인트에서 제외함'
       else '단일 물리 위치 여부를 분류함' end,
  'asset_master',
  coalesce(nullif(trim(asset_code), ''), asset_id),
  null,
  'global-coverage-subject-v1',
  'not-geocoded',
  md5(concat_ws('|', asset_id, asset_code, canonical_name, inferred_subject)) ||
    md5(concat_ws('|', address_text, city, inferred_country, 'not-geocoded')),
  jsonb_build_object(
    'coverage_migration', '2026-09-10',
    'coordinate_origin', 'none',
    'country_inference', inferred_country,
    'external_request_made', false
  ),
  now(),
  now()
from remaining
on conflict (asset_id) do nothing;

-- Publicly identifiable underlying buildings are promoted only when the
-- published address and a public map coordinate describe the same property.
-- Loan/facility wording is retained in the source name, but the location row
-- represents the collateral building, not the financial instrument itself.
with public_verification (
  asset_code, canonical_name_pattern, country_name, alpha2, alpha3, city_name,
  admin1_name, public_address, latitude, longitude, coordinate_source,
  address_source, evidence_label
) as (
  values
    ('A112718001', '%Wilshire Grand%', 'United States', 'US', 'USA', 'Los Angeles', 'California',
      '900 Wilshire Blvd, Los Angeles, CA 90017', 34.0501900, -118.2604100,
      'https://mapcarta.com/W496246723', 'https://wilshiregrandcenter.com/contact/', 'Wilshire Grand Center'),
    ('A112523001', '%Wilshire Grand%', 'United States', 'US', 'USA', 'Los Angeles', 'California',
      '900 Wilshire Blvd, Los Angeles, CA 90017', 34.0501900, -118.2604100,
      'https://mapcarta.com/W496246723', 'https://wilshiregrandcenter.com/contact/', 'Wilshire Grand Center'),
    ('A112073001', '%KPMG Plaza%', 'United States', 'US', 'USA', 'Dallas', 'Texas',
      '2323 Ross Avenue, Dallas, TX 75201', 32.7893220, -96.7973360,
      'https://www.crexi.com/property-records/99180215330000000-DALLAS-TX-75201-2726/8efa24d5d59c4d7279904c62a2a08ed480cf3bab',
      'https://kpmg.com/us/en/how-we-work/locations/dallas.html', 'KPMG Plaza at Hall Arts'),
    ('A112065001', '%Courvoisier%', 'United States', 'US', 'USA', 'Miami', 'Florida',
      '501 Brickell Key Drive, Miami, FL 33131', 25.7663445, -80.1856992,
      'https://www.whereorg.com/swire-brickell-three-inc-3816839',
      'https://www.cbre.com/properties/properties-for-lease/office/details/US-SMPL-84685/brickell-key-centre-501-brickell-key-drive-miami-fl-33131',
      'Brickell Key Centre / Courvoisier Centre'),
    ('A112068001', '%787 Seventh%', 'United States', 'US', 'USA', 'New York', 'New York',
      '787 Seventh Avenue, New York, NY 10019', 40.7617330, -73.9818020,
      'https://wiki.arcsnet.dev/content/wikipedia_en_all_maxi_2026-02/Axa_Equitable_Center',
      'https://www.skyscrapercenter.com/building/787-seventh-avenue/1118', '787 Seventh Avenue'),
    ('A112077001', '%Atlantic Building%', 'United States', 'US', 'USA', 'Washington', 'District of Columbia',
      '950 F Street NW, Washington, DC 20004', 38.8974500, -77.0256500,
      'https://www.waymarking.com/waymarks/WMDEGP_1887_Atlantic_Building_F_Street_NW_Washington_DC',
      'https://www.waymarking.com/waymarks/WMDEGP_1887_Atlantic_Building_F_Street_NW_Washington_DC',
      'Atlantic Building facade at 950 F Street NW'),
    ('A200028001', '%285 Madison%', 'United States', 'US', 'USA', 'New York', 'New York',
      '285 Madison Avenue, New York, NY 10017', 40.7516360, -73.9799764,
      'https://nominatim.openstreetmap.org/ui/search.html?q=285%20Madison%20Avenue%2C%20New%20York%2C%20NY',
      'https://a836-pts-access.nyc.gov/care/datalets/datalet.aspx?LMparent=20&UseSearch=no&jur=65&mode=asmt_fin_2027&pin=1012750023&taxyr=2025',
      '285 Madison Avenue'),
    ('A112036003', '%OJP%', 'United States', 'US', 'USA', 'Washington', 'District of Columbia',
      '810 7th Street NW, Washington, DC 20001', 38.9000187, -77.0220210,
      'https://nominatim.openstreetmap.org/ui/search.html?q=810%207th%20Street%20NW%2C%20Washington%2C%20DC',
      'https://www.govinfo.gov/content/pkg/CDIR-2006-09-01/pdf/CDIR-2006-09-01-DEPARTMENTS-6.pdf',
      'Office of Justice Programs headquarters'),
    ('A112035003', '%OJP%', 'United States', 'US', 'USA', 'Washington', 'District of Columbia',
      '810 7th Street NW, Washington, DC 20001', 38.9000187, -77.0220210,
      'https://nominatim.openstreetmap.org/ui/search.html?q=810%207th%20Street%20NW%2C%20Washington%2C%20DC',
      'https://www.govinfo.gov/content/pkg/CDIR-2006-09-01/pdf/CDIR-2006-09-01-DEPARTMENTS-6.pdf',
      'Office of Justice Programs headquarters'),
    ('A112355001', '%Toronto The One%', 'Canada', 'CA', 'CAN', 'Toronto', 'Ontario',
      '1 Bloor Street West, Toronto, ON', 43.6698000, -79.3869700,
      'https://mapcarta.com/W1384489351',
      'https://www.toronto.ca/legdocs/mmis/2023/te/bgrd/backgroundfile-235364.pdf', 'One Bloor West / The One'),
    ('A112588001', '%Toronto The One%', 'Canada', 'CA', 'CAN', 'Toronto', 'Ontario',
      '1 Bloor Street West, Toronto, ON', 43.6698000, -79.3869700,
      'https://mapcarta.com/W1384489351',
      'https://www.toronto.ca/legdocs/mmis/2023/te/bgrd/backgroundfile-235364.pdf', 'One Bloor West / The One'),
    ('A200008001', '%Toronto The One%', 'Canada', 'CA', 'CAN', 'Toronto', 'Ontario',
      '1 Bloor Street West, Toronto, ON', 43.6698000, -79.3869700,
      'https://mapcarta.com/W1384489351',
      'https://www.toronto.ca/legdocs/mmis/2023/te/bgrd/backgroundfile-235364.pdf', 'One Bloor West / The One'),
    ('A20000801', '%Toronto The One%', 'Canada', 'CA', 'CAN', 'Toronto', 'Ontario',
      '1 Bloor Street West, Toronto, ON', 43.6698000, -79.3869700,
      'https://mapcarta.com/W1384489351',
      'https://www.toronto.ca/legdocs/mmis/2023/te/bgrd/backgroundfile-235364.pdf', 'One Bloor West / The One'),
    ('A112095001', '%85 Tenth Avenue%', 'United States', 'US', 'USA', 'New York', 'New York',
      '85 10th Avenue, New York, NY 10011', 40.7434020, -74.0074120,
      'https://nominatim.openstreetmap.org/ui/search.html?q=85%2010th%20Avenue%2C%20New%20York%2C%20NY%2010011',
      'https://www.related.com/our-company/properties/85-tenth-avenue', '85 Tenth Avenue'),
    ('A112036002', '%Bell 본사%', 'Canada', 'CA', 'CAN', 'Montreal', 'Quebec',
      '1 Carrefour Alexander-Graham-Bell, Verdun, QC H3E 3B3', 45.4724323, -73.5413437,
      'https://nominatim.openstreetmap.org/ui/search.html?q=1%20Carrefour%20Alexander-Graham-Bell%20Verdun%20Quebec%20H3E%203B3',
      'https://www.bce.ca/contact-us/general-information', 'Bell Canada corporate headquarters'),
    ('A112042001', '%신라스테이서대문%', '대한민국', 'KR', 'KOR', '서울특별시', '서울특별시',
      '서울특별시 서대문구 충정로 76', 37.5651500, 126.9668000,
      'https://mapcarta.com/32950702',
      'https://www.shillahotels.com/ko/shillastay/seodaemun/accommodation/index.do', '신라스테이 서대문'),
    ('A112101001', '%마제스타시티타워1%', '대한민국', 'KR', 'KOR', '서울특별시', '서울특별시',
      '서울특별시 서초구 서초대로38길 12', 37.4903600, 127.0057800,
      'https://mapcarta.com/W589463700',
      'https://property.jll.co.kr/listings/majestar-city-tower-1-1501-1-seocho-dong', '마제스타시티 타워1'),
    ('A112246001', '%GIDC 광명역%', '대한민국', 'KR', 'KOR', '광명시', '경기도',
      '경기도 광명시 일직로 43', 37.4227400, 126.8867500,
      'https://mapcarta.com/W675752012',
      'https://www.giupsos.or.kr/portal/lay1/bbs/S122T158C160/F/13/view.do?article_seq=4073', 'GIDC 광명역 지식산업센터'),
    ('A112314001', '%돈의문3구역 게이트타워%', '대한민국', 'KR', 'KOR', '서울특별시', '서울특별시',
      '서울특별시 종로구 통일로 134', 37.5667937, 126.9662598,
      'https://findby.co.kr/details/03181-111103000008-st-652c0c54f27008be2c55dc88',
      'https://www.mastern.co.kr/assets/download/%5BKor%5D%20Mastern%20Investment%202024%20Intergrated%20Report_Part2.pdf', '디타워 돈의문')
), matched_verification as (
  select location.asset_id, verification.*
  from public.asset_location_normalization location
  join public_verification verification
    on location.asset_code = verification.asset_code
   and location.canonical_name ilike verification.canonical_name_pattern
)
update public.asset_location_normalization location
set
  location_subject_type = 'single_site',
  raw_country = coalesce(location.raw_country, matched.country_name),
  raw_city = coalesce(location.raw_city, matched.city_name),
  raw_address = coalesce(nullif(trim(location.raw_address), ''), matched.public_address),
  normalized_country_name = matched.country_name,
  country_code_alpha2 = matched.alpha2,
  country_code_alpha3 = matched.alpha3,
  normalized_city = matched.city_name,
  normalized_admin1 = matched.admin1_name,
  latitude = matched.latitude,
  longitude = matched.longitude,
  coordinate_source = matched.coordinate_source,
  coordinate_precision = 'building',
  match_method = 'public_address_coordinate_crosscheck',
  confidence = 0.98,
  review_status = 'manually_verified',
  is_map_eligible = true,
  review_note = concat('공개 주소와 지도 좌표 교차검증: ', matched.evidence_label),
  classifier_version = 'global-coverage-public-verification-v1',
  geocoder_version = 'public-web-crosscheck-2026-09-10',
  candidate_fingerprint = md5(concat_ws('|', location.asset_id, matched.public_address, matched.latitude, matched.longitude)) ||
    md5(concat_ws('|', matched.coordinate_source, matched.address_source, 'manually_verified')),
  evidence = coalesce(location.evidence, '{}'::jsonb) || jsonb_build_object(
    'public_verification', true,
    'verified_label', matched.evidence_label,
    'verified_address', matched.public_address,
    'address_source', matched.address_source,
    'coordinate_source', matched.coordinate_source,
    'external_request_made', true,
    'verified_on', '2026-09-10'
  ),
  reviewed_at = now(),
  updated_at = now()
from matched_verification matched
where location.asset_id = matched.asset_id
  and location.review_status <> 'manually_verified';

-- The strict map-ready view now includes domestic assets as well. The
-- progressive view already exposes every normalization state via the Edge API.
create or replace view public.asset_map_location_current_v1
with (security_invoker = true)
as
select
  asset.asset_id,
  asset.asset_code,
  asset.canonical_name,
  asset.asset_type,
  asset.asset_kind,
  asset.portfolio_region,
  asset.business_stage,
  location.normalized_country_name,
  location.country_code_alpha2,
  location.country_code_alpha3,
  location.normalized_city,
  location.normalized_admin1,
  location.raw_address,
  location.latitude,
  location.longitude,
  location.coordinate_precision,
  location.confidence as coordinate_confidence,
  location.coordinate_source,
  location.review_status as location_review_status,
  location.updated_at as location_updated_at
from public.asset_master asset
join public.asset_location_normalization location using (asset_id)
where asset.is_physical is true
  and asset.asset_kind = 'physical_asset'
  and location.location_subject_type = 'single_site'
  and location.is_map_eligible is true;

revoke all on public.asset_map_location_current_v1 from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from public.asset_master asset
    left join public.asset_location_normalization location using (asset_id)
    where asset.is_physical is true
      and asset.asset_kind = 'physical_asset'
      and location.asset_id is null
  ) then
    raise exception 'Global map coverage migration left physical assets without normalization rows';
  end if;

  if exists (
    select 1
    from public.asset_location_normalization
    where is_map_eligible is true
      and (latitude is null or longitude is null or location_subject_type <> 'single_site')
  ) then
    raise exception 'Global map coverage migration produced an invalid map-eligible row';
  end if;

  if not exists (
    select 1
    from public.asset_location_normalization
    where country_code_alpha3 = 'KOR'
      and is_map_eligible is true
  ) then
    raise exception 'Global map coverage migration did not include Korean map points';
  end if;
end $$;

comment on view public.asset_map_location_current_v1 is
  'Service-role-only map-ready global physical asset locations, including Korea; excludes vehicles, multi-site aggregates and unresolved coordinates.';

commit;
