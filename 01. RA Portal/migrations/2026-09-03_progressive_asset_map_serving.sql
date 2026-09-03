-- Session-protected progressive asset-map projection.
-- No browser role receives direct access; the ra-asset-map Edge Function
-- reads this view with the service role after validating the RA session.

create or replace view public.asset_map_location_progressive_v1
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
  location.location_subject_type,
  location.normalized_country_name,
  location.country_code_alpha2,
  location.country_code_alpha3,
  location.normalized_city,
  location.normalized_admin1,
  location.raw_city,
  location.latitude,
  location.longitude,
  location.coordinate_precision,
  location.confidence as coordinate_confidence,
  location.coordinate_source,
  location.review_status,
  location.is_map_eligible,
  case
    when location.location_subject_type in ('multi_site_portfolio', 'non_physical_vehicle')
      then 'aggregate_only'
    when location.location_subject_type = 'single_site'
      and location.latitude is not null and location.longitude is not null
      and location.is_map_eligible is true
      and location.review_status in ('auto_verified', 'manually_verified')
      then 'verified'
    when location.location_subject_type = 'single_site'
      and location.latitude is not null and location.longitude is not null
      and location.review_status = 'review_required'
      and location.coordinate_precision in ('address_point', 'building')
      then 'candidate_asset'
    when location.location_subject_type = 'single_site'
      and location.latitude is not null and location.longitude is not null
      and location.review_status = 'review_required'
      and location.coordinate_precision in ('street', 'district')
      then 'local_area'
    when location.location_subject_type = 'single_site'
      and location.latitude is not null and location.longitude is not null
      and location.review_status = 'review_required'
      then 'uncertain_point'
    when location.location_subject_type = 'single_site'
      and coalesce(location.normalized_city, location.raw_city) is not null
      then 'city_text'
    else 'insufficient'
  end as location_tier,
  case
    when location.is_map_eligible is true then '검증된 위치'
    when location.coordinate_precision in ('address_point', 'building') then '주소 또는 건물 후보 · 검토 필요'
    when location.coordinate_precision in ('street', 'district') then '도로 또는 구역 수준 · 대략 위치'
    when location.latitude is not null and location.longitude is not null then '좌표 후보 · 정밀도 확인 필요'
    when location.location_subject_type = 'single_site' and coalesce(location.normalized_city, location.raw_city) is not null then '도시 정보만 확인'
    when location.location_subject_type in ('multi_site_portfolio', 'non_physical_vehicle') then '단일 위치 대상 아님'
    else '위치 근거 부족'
  end as location_status_label,
  location.updated_at as location_updated_at
from public.asset_master asset
join public.asset_location_normalization location using (asset_id);

revoke all on public.asset_map_location_progressive_v1 from public, anon, authenticated;

comment on view public.asset_map_location_progressive_v1 is
  'Service-role-only progressive global map projection. Preserves all normalization subjects while excluding raw address, evidence and lineage internals.';