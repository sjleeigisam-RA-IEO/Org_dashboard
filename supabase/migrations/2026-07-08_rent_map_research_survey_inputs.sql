create extension if not exists pgcrypto with schema extensions;

create table if not exists public.rent_map_research_survey_inputs (
  id uuid primary key default extensions.gen_random_uuid(),
  dataset_version text not null,
  asset_event text not null,
  payload jsonb not null default '{}'::jsonb,
  client_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rent_map_research_survey_inputs_dataset_check
    check (dataset_version = 'research_target_20260707'),
  constraint rent_map_research_survey_inputs_asset_event_check
    check (length(btrim(asset_event)) between 1 and 160),
  constraint rent_map_research_survey_inputs_payload_object_check
    check (jsonb_typeof(payload) = 'object')
);

create unique index if not exists ux_rent_map_research_survey_inputs_asset
  on public.rent_map_research_survey_inputs (dataset_version, asset_event);

create index if not exists idx_rent_map_research_survey_inputs_updated
  on public.rent_map_research_survey_inputs (dataset_version, updated_at desc);

alter table public.rent_map_research_survey_inputs enable row level security;

drop policy if exists rent_map_research_survey_inputs_public_select
  on public.rent_map_research_survey_inputs;
create policy rent_map_research_survey_inputs_public_select
  on public.rent_map_research_survey_inputs
  for select
  to anon, authenticated
  using (dataset_version = 'research_target_20260707');

drop policy if exists rent_map_research_survey_inputs_public_insert
  on public.rent_map_research_survey_inputs;
create policy rent_map_research_survey_inputs_public_insert
  on public.rent_map_research_survey_inputs
  for insert
  to anon, authenticated
  with check (
    dataset_version = 'research_target_20260707'
    and length(btrim(asset_event)) between 1 and 160
    and jsonb_typeof(payload) = 'object'
  );

drop policy if exists rent_map_research_survey_inputs_public_update
  on public.rent_map_research_survey_inputs;
create policy rent_map_research_survey_inputs_public_update
  on public.rent_map_research_survey_inputs
  for update
  to anon, authenticated
  using (dataset_version = 'research_target_20260707')
  with check (
    dataset_version = 'research_target_20260707'
    and length(btrim(asset_event)) between 1 and 160
    and jsonb_typeof(payload) = 'object'
  );

grant select, insert, update on public.rent_map_research_survey_inputs to anon, authenticated;
