-- Presentation-only dashboard view.
-- This intentionally excludes technical ids, match metadata, link sources, PNU, and coordinates.

create or replace view public.dev_project_34_dashboard_info as
select
    list_no,
    project_name,
    source_category,
    vehicle_text,
    project_statuses,
    fund_short_names,
    fund_names,
    fund_statuses,
    legal_forms,
    notion_vehicle_classes,
    notion_business_stage_classes,
    notion_holding_type_classes,
    fund_depts,
    fund_managers,
    benchmark_aum_total,
    invested_aum_total,
    asset_names,
    asset_types,
    address_texts,
    main_usages,
    site_areas,
    gross_floor_areas,
    scrs,
    fars,
    completion_dates,
    setup_dates,
    sort_setup_date
from public.dev_project_34_dashboard_flat;

comment on view public.dev_project_34_dashboard_info is
    'Presentation-only read view for the development-project dashboard. Excludes ids and relationship audit metadata.';
