-- Read-only dashboard view for the 2026-06-30 development-project snapshot.
-- The dashboard reads only this view, keeping the dev_project_* base tables RLS-protected.

create or replace view public.dev_project_34_dashboard_flat as
select
    dpl.list_no,
    dpl.dev_project_id,
    dpl.source_category,
    dpl.project_name,
    dpl.vehicle_text,
    dpl.inclusion_basis,
    dpl.match_status,
    dpl.review_note,
    dpl.source_asof_date,
    coalesce(projects.linked_project_count, 0) as linked_project_count,
    coalesce(funds.linked_fund_count, 0) as linked_fund_count,
    coalesce(assets.linked_asset_count, 0) as linked_asset_count,
    coalesce(flags.review_flags, array[]::text[]) as review_flags,
    projects.project_ids,
    projects.project_names,
    projects.project_codes,
    projects.project_types,
    projects.project_statuses,
    projects.project_notion_ids,
    projects.project_primary_asset_ids,
    projects.project_relation_roles,
    projects.project_match_methods,
    projects.project_match_confidences,
    projects.project_link_notes,
    funds.fund_ids,
    funds.fund_short_names,
    funds.fund_names,
    funds.fund_statuses,
    funds.fund_types,
    funds.legal_forms,
    funds.is_development_values,
    funds.notion_vehicle_classes,
    funds.notion_business_stage_classes,
    funds.notion_holding_type_classes,
    funds.fund_primary_asset_ids,
    funds.fund_depts,
    funds.fund_managers,
    funds.fund_vehicle_roles,
    funds.fund_match_methods,
    funds.fund_match_confidences,
    funds.fund_link_notes,
    funds.benchmark_aum_total,
    funds.invested_aum_total,
    assets.asset_ids,
    assets.asset_names,
    assets.asset_types,
    assets.asset_kinds,
    assets.business_stages,
    assets.address_texts,
    assets.pnus,
    assets.latitudes,
    assets.longitudes,
    assets.main_usages,
    assets.site_areas,
    assets.gross_floor_areas,
    assets.scrs,
    assets.fars,
    assets.completion_dates,
    assets.asset_roles,
    assets.asset_link_sources,
    assets.asset_match_methods,
    assets.asset_match_confidences,
    assets.asset_link_notes,
    funds.setup_dates,
    funds.sort_setup_date
from public.dev_project_list dpl
left join lateral (
    select
        count(distinct project_id) as linked_project_count,
        array_remove(array_agg(distinct project_id), null) as project_ids,
        array_remove(array_agg(distinct project_name), null) as project_names,
        array_remove(array_agg(distinct project_code), null) as project_codes,
        array_remove(array_agg(distinct project_type), null) as project_types,
        array_remove(array_agg(distinct status), null) as project_statuses,
        array_remove(array_agg(distinct notion_id), null) as project_notion_ids,
        array_remove(array_agg(distinct primary_asset_id), null) as project_primary_asset_ids,
        array_remove(array_agg(distinct relation_role), null) as project_relation_roles,
        array_remove(array_agg(distinct match_method), null) as project_match_methods,
        array_remove(array_agg(distinct match_confidence::text), null) as project_match_confidences,
        array_remove(array_agg(distinct notes), null) as project_link_notes
    from (
        select
            dppl.project_id,
            dppl.relation_role,
            dppl.is_primary,
            dppl.match_method,
            dppl.match_confidence,
            dppl.notes,
            p.project_name,
            p.project_code,
            p.project_type,
            p.status,
            p.notion_id,
            p.primary_asset_id
        from public.dev_project_project_links dppl
        join public.projects p
            on p.project_id = dppl.project_id
        where dppl.dev_project_id = dpl.dev_project_id
    ) project_rows
) projects on true
left join lateral (
    select
        count(distinct fund_id) as linked_fund_count,
        array_remove(array_agg(distinct fund_id), null) as fund_ids,
        array_remove(array_agg(distinct short_name), null) as fund_short_names,
        array_remove(array_agg(distinct fund_name), null) as fund_names,
        array_remove(array_agg(distinct status), null) as fund_statuses,
        array_remove(array_agg(distinct setup_date::text order by setup_date::text), null) as setup_dates,
        coalesce(min(setup_date) filter (where is_primary), min(setup_date)) as sort_setup_date,
        array_remove(array_agg(distinct fund_type), null) as fund_types,
        array_remove(array_agg(distinct legal_form), null) as legal_forms,
        array_remove(array_agg(distinct is_development::text), null) as is_development_values,
        array_remove(array_agg(distinct notion_vehicle_class), null) as notion_vehicle_classes,
        array_remove(array_agg(distinct notion_business_stage_class), null) as notion_business_stage_classes,
        array_remove(array_agg(distinct notion_holding_type_class), null) as notion_holding_type_classes,
        array_remove(array_agg(distinct primary_asset_id), null) as fund_primary_asset_ids,
        array_remove(array_agg(distinct dept_resolved), null) as fund_depts,
        array_remove(array_agg(distinct manager_resolved), null) as fund_managers,
        array_remove(array_agg(distinct vehicle_role), null) as fund_vehicle_roles,
        array_remove(array_agg(distinct match_method), null) as fund_match_methods,
        array_remove(array_agg(distinct match_confidence::text), null) as fund_match_confidences,
        array_remove(array_agg(distinct notes), null) as fund_link_notes,
        sum(benchmark_aum) as benchmark_aum_total,
        sum(invested_aum) as invested_aum_total
    from (
        select
            dpfl.fund_id,
            dpfl.vehicle_role,
            dpfl.is_primary,
            dpfl.match_method,
            dpfl.match_confidence,
            dpfl.notes,
            f.short_name,
            f.fund_name,
            f.status,
            f.setup_date,
            f.fund_type,
            f.legal_form,
            f.is_development,
            f.notion_vehicle_class,
            f.notion_business_stage_class,
            f.notion_holding_type_class,
            f.primary_asset_id,
            f.dept_resolved,
            f.manager_resolved,
            f.benchmark_aum,
            f.invested_aum
        from public.dev_project_fund_links dpfl
        join public.v_funds_enriched f
            on f.fund_id = dpfl.fund_id
        where dpfl.dev_project_id = dpl.dev_project_id
    ) fund_rows
) funds on true
left join lateral (
    select
        count(distinct asset_id) as linked_asset_count,
        array_remove(array_agg(distinct asset_id), null) as asset_ids,
        array_remove(array_agg(distinct canonical_name), null) as asset_names,
        array_remove(array_agg(distinct asset_type), null) as asset_types,
        array_remove(array_agg(distinct asset_kind), null) as asset_kinds,
        array_remove(array_agg(distinct business_stage), null) as business_stages,
        array_remove(array_agg(distinct address_text), null) as address_texts,
        array_remove(array_agg(distinct pnu), null) as pnus,
        array_remove(array_agg(distinct latitude::text), null) as latitudes,
        array_remove(array_agg(distinct longitude::text), null) as longitudes,
        array_remove(array_agg(distinct main_usage), null) as main_usages,
        array_remove(array_agg(distinct site_area::text), null) as site_areas,
        array_remove(array_agg(distinct gross_floor_area::text), null) as gross_floor_areas,
        array_remove(array_agg(distinct scr::text), null) as scrs,
        array_remove(array_agg(distinct far::text), null) as fars,
        array_remove(array_agg(distinct completion_date::text), null) as completion_dates,
        array_remove(array_agg(distinct asset_role), null) as asset_roles,
        array_remove(array_agg(distinct link_source), null) as asset_link_sources,
        array_remove(array_agg(distinct match_method), null) as asset_match_methods,
        array_remove(array_agg(distinct match_confidence::text), null) as asset_match_confidences,
        array_remove(array_agg(distinct notes), null) as asset_link_notes
    from (
        select
            dpal.asset_id,
            dpal.asset_role,
            dpal.is_primary,
            dpal.link_source,
            dpal.match_method,
            dpal.match_confidence,
            dpal.notes,
            am.canonical_name,
            am.asset_type,
            am.asset_kind,
            am.business_stage,
            am.address_text,
            am.pnu,
            am.latitude,
            am.longitude,
            am.main_usage,
            am.site_area,
            am.gross_floor_area,
            am.scr,
            am.far,
            am.completion_date
        from public.dev_project_asset_links dpal
        join public.asset_master am
            on am.asset_id = dpal.asset_id
        where dpal.dev_project_id = dpl.dev_project_id
    ) asset_rows
) assets on true
left join lateral (
    select review_flags
    from public.dev_project_34_review_flags rf
    where rf.dev_project_id = dpl.dev_project_id
) flags on true;

comment on view public.dev_project_34_dashboard_flat is
    'Browser-readable flat/aggregated dashboard view for the 34 development-project snapshot.';
