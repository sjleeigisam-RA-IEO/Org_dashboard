-- Promote canonical asset relationships into existing source tables.
-- Link tables remain the full many-to-many relationship source.

alter table fund_assets
    add column if not exists asset_id text references asset_master(asset_id) on delete set null;

alter table funds
    add column if not exists primary_asset_id text references asset_master(asset_id) on delete set null;

alter table projects
    add column if not exists primary_asset_id text references asset_master(asset_id) on delete set null;

create index if not exists idx_fund_assets_asset_id on fund_assets(asset_id);
create index if not exists idx_funds_primary_asset_id on funds(primary_asset_id);
create index if not exists idx_projects_primary_asset_id on projects(primary_asset_id);

create or replace view fund_asset_relationships as
select
    afl.asset_id,
    am.canonical_name,
    am.address_text,
    am.latitude,
    am.longitude,
    am.pnu,
    am.asset_code,
    am.review_status,
    afl.fund_id,
    f.fund_name,
    f.short_name,
    f.project_mission_name,
    f.status as fund_status,
    afl.relation_type,
    afl.confidence,
    afl.source_table,
    afl.source_id
from asset_fund_links afl
join asset_master am on am.asset_id = afl.asset_id
left join funds f on f.fund_id = afl.fund_id;

create or replace view project_asset_relationships as
select
    apl.asset_id,
    am.canonical_name,
    am.address_text,
    am.latitude,
    am.longitude,
    am.pnu,
    am.asset_code,
    am.review_status,
    apl.project_id,
    coalesce(p.project_name, f.project_mission_name, f.fund_name) as project_name,
    p.project_type,
    p.status as project_status,
    apl.relation_type,
    apl.confidence,
    apl.source_table,
    apl.source_id
from asset_project_links apl
join asset_master am on am.asset_id = apl.asset_id
left join projects p on p.project_id = apl.project_id
left join funds f on f.fund_id = apl.project_id;

create or replace view asset_relationship_summary as
select
    am.asset_id,
    am.canonical_name,
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
    array_remove(array_agg(distinct apl.project_id), null) as project_ids
from asset_master am
left join asset_fund_links afl on afl.asset_id = am.asset_id
left join asset_project_links apl on apl.asset_id = am.asset_id
group by am.asset_id;
