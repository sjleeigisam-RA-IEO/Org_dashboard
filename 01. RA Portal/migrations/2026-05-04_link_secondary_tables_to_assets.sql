-- Add direct asset references to secondary/domain tables.
-- These columns are denormalized convenience FKs derived from project/fund relationships.

alter table iota_seoul_log_links
    add column if not exists asset_id text references asset_master(asset_id) on delete set null;

alter table risk_management_points
    add column if not exists asset_id text references asset_master(asset_id) on delete set null;

alter table lender_exposures
    add column if not exists asset_id text references asset_master(asset_id) on delete set null;

alter table beneficiary_exposures
    add column if not exists asset_id text references asset_master(asset_id) on delete set null;

create index if not exists idx_iota_seoul_log_links_asset_id on iota_seoul_log_links(asset_id);
create index if not exists idx_risk_management_points_asset_id on risk_management_points(asset_id);
create index if not exists idx_lender_exposures_asset_id on lender_exposures(asset_id);
create index if not exists idx_beneficiary_exposures_asset_id on beneficiary_exposures(asset_id);

create or replace view iota_asset_log_relationships as
select
    l.log_id,
    lg.work_date,
    lg.writer_name,
    lg.summary,
    l.proj_id,
    l.relation_type,
    l.asset_id,
    am.canonical_name,
    am.address_text,
    am.latitude,
    am.longitude,
    am.pnu,
    am.asset_code
from iota_seoul_log_links l
join iota_seoul_logs lg on lg.log_id = l.log_id
left join asset_master am on am.asset_id = l.asset_id;

create or replace view asset_exposure_summary as
select
    am.asset_id,
    am.canonical_name,
    am.address_text,
    coalesce(sum(le.committed_amt), 0) as lender_committed_amt,
    coalesce(sum(le.drawn_amt), 0) as lender_drawn_amt,
    coalesce(sum(be.committed_amt), 0) as beneficiary_committed_amt,
    coalesce(sum(be.invested_amt), 0) as beneficiary_invested_amt,
    count(distinct le.id) as lender_exposure_count,
    count(distinct be.id) as beneficiary_exposure_count
from asset_master am
left join lender_exposures le on le.asset_id = am.asset_id
left join beneficiary_exposures be on be.asset_id = am.asset_id
group by am.asset_id;
