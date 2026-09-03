-- Auditable global location normalization for physical map assets.
-- Raw address/city/country are preserved; only reviewed or high-confidence
-- single-site coordinates are eligible for the map serving surface.

create table if not exists public.asset_location_normalization (
  asset_id text primary key references public.asset_master(asset_id) on delete cascade,
  asset_code text,
  canonical_name text not null,
  portfolio_region text,
  location_subject_type text not null check (location_subject_type in (
    'single_site', 'multi_site_portfolio', 'non_physical_vehicle', 'unresolved_subject'
  )),
  raw_country text,
  raw_city text,
  raw_address text,
  normalized_country_name text,
  country_code_alpha2 text check (country_code_alpha2 is null or country_code_alpha2 ~ '^[A-Z]{2}$'),
  country_code_alpha3 text check (country_code_alpha3 is null or country_code_alpha3 ~ '^[A-Z]{3}$'),
  normalized_city text,
  normalized_admin1 text,
  normalized_postcode text,
  latitude numeric check (latitude is null or latitude between -90 and 90),
  longitude numeric check (longitude is null or longitude between -180 and 180),
  coordinate_source text,
  coordinate_precision text not null check (coordinate_precision in (
    'address_point', 'building', 'street', 'district', 'city', 'region', 'country', 'unknown'
  )),
  match_method text,
  confidence numeric not null check (confidence between 0 and 1),
  review_status text not null check (review_status in (
    'auto_verified', 'manually_verified', 'manually_rejected', 'review_required', 'unresolved', 'not_single_site'
  )),
  is_map_eligible boolean not null default false,
  review_note text,
  source_system text not null,
  source_record_id text,
  geocoder_place_id text,
  classifier_version text,
  geocoder_version text,
  candidate_fingerprint text,
  evidence jsonb not null default '{}'::jsonb,
  normalized_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (not is_map_eligible or (
    location_subject_type = 'single_site'
    and review_status in ('auto_verified', 'manually_verified')
    and latitude is not null
    and longitude is not null
    and country_code_alpha2 is not null
    and country_code_alpha3 is not null
    and classifier_version is not null
    and geocoder_version is not null
    and candidate_fingerprint is not null
  ))
);

-- Additive hardening for databases where the table predates this migration revision.
alter table public.asset_location_normalization add column if not exists classifier_version text;
alter table public.asset_location_normalization add column if not exists geocoder_version text;
alter table public.asset_location_normalization add column if not exists candidate_fingerprint text;
update public.asset_location_normalization
set classifier_version=coalesce(classifier_version, 'manual-review-v1'),
    geocoder_version=coalesce(geocoder_version, 'manual-review'),
    candidate_fingerprint=coalesce(
      candidate_fingerprint,
      md5(concat_ws('|',asset_id,review_status,country_code_alpha2,normalized_city,latitude::text,longitude::text,coordinate_source,review_note)) ||
      md5(concat_ws('|','manual',asset_id,review_status,country_code_alpha3,normalized_admin1,normalized_postcode))
    )
where review_status in ('manually_verified','manually_rejected')
  and (classifier_version is null or geocoder_version is null or candidate_fingerprint is null);
alter table public.asset_location_normalization drop constraint if exists asset_location_normalization_review_status_check;
alter table public.asset_location_normalization add constraint asset_location_normalization_review_status_check
  check (review_status in ('auto_verified', 'manually_verified', 'manually_rejected', 'review_required', 'unresolved', 'not_single_site'));
alter table public.asset_location_normalization drop constraint if exists asset_location_normalization_check;
alter table public.asset_location_normalization drop constraint if exists asset_location_normalization_map_eligibility_check;
alter table public.asset_location_normalization add constraint asset_location_normalization_map_eligibility_check
  check (not is_map_eligible or (
    location_subject_type = 'single_site'
    and review_status in ('auto_verified', 'manually_verified')
    and latitude is not null
    and longitude is not null
    and country_code_alpha2 is not null
    and country_code_alpha3 is not null
    and classifier_version is not null
    and geocoder_version is not null
    and candidate_fingerprint is not null
  ));

alter table public.asset_location_normalization enable row level security;
revoke all on public.asset_location_normalization from anon, authenticated;

create index if not exists idx_asset_location_normalization_country_city
  on public.asset_location_normalization(country_code_alpha2, normalized_city);
create index if not exists idx_asset_location_normalization_review
  on public.asset_location_normalization(review_status, is_map_eligible);

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
  and asset.portfolio_region in ('북미', '유럽', '아시아', '글로벌')
  and location.location_subject_type = 'single_site'
  and location.is_map_eligible is true;

revoke all on public.asset_map_location_current_v1 from anon, authenticated;

comment on table public.asset_location_normalization is
  'Source-preserving country, city and coordinate normalization. Candidate coordinates remain non-serving until auto-verified or manually approved.';
comment on view public.asset_map_location_current_v1 is
  'Service-role-only map-ready physical asset locations; no fund, vehicle, multi-site aggregate or unresolved coordinate is exposed.';
