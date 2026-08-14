-- Optimize the clean party-exposure contract without changing its public columns.
-- The source view remains available only in the internal schema for controlled refreshes.
begin;
set local statement_timeout = 0;
set local lock_timeout = '10s';

create schema if not exists ra_internal;

do $party_fact_cache$
declare
  source_definition text;
begin
  if to_regclass('ra_internal.party_exposure_fact_source') is null then
    select pg_get_viewdef('public.party_exposure_fact'::regclass, true)
      into source_definition;
    execute 'create view ra_internal.party_exposure_fact_source as ' || source_definition;
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'ra_internal'
      and relation.relname = 'party_exposure_fact_cache'
      and relation.relkind = 'm'
  ) then
    execute 'create materialized view ra_internal.party_exposure_fact_cache '
         || 'as select * from ra_internal.party_exposure_fact_source with no data';
  end if;
end;
$party_fact_cache$;

refresh materialized view ra_internal.party_exposure_fact_cache;

create unique index if not exists party_exposure_fact_cache_uid_uq
  on ra_internal.party_exposure_fact_cache (exposure_uid);
create index if not exists party_exposure_fact_cache_role_fund_date_idx
  on ra_internal.party_exposure_fact_cache (role_type, fund_id, base_date);
create index if not exists party_exposure_fact_cache_role_party_date_idx
  on ra_internal.party_exposure_fact_cache (role_type, party_id, base_date);
create index if not exists party_exposure_fact_cache_role_date_idx
  on ra_internal.party_exposure_fact_cache (role_type, base_date);

create or replace view public.party_exposure_fact as
select * from ra_internal.party_exposure_fact_cache;

create or replace function public.refresh_party_exposure_surfaces()
returns void
language plpgsql
security definer
set search_path = public, ra_internal
set statement_timeout = 0
as $$
begin
  refresh materialized view ra_internal.party_exposure_fact_cache;
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

revoke all on function public.refresh_party_exposure_surfaces() from public;
grant execute on function public.refresh_party_exposure_surfaces() to service_role;

do $verify_party_fact_cache$
declare
  source_rows bigint;
  cache_rows bigint;
begin
  select count(*) into source_rows from ra_internal.party_exposure_fact_source;
  select count(*) into cache_rows from ra_internal.party_exposure_fact_cache;
  if source_rows <> cache_rows then
    raise exception 'party exposure cache row mismatch: source %, cache %', source_rows, cache_rows;
  end if;
end;
$verify_party_fact_cache$;

notify pgrst, 'reload schema';
commit;
