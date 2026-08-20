-- Evidence staging for development-project enrichment.
-- This table stores field-level candidates from SQL, Notion, and local files.
-- It intentionally does not overwrite project/fund/asset master rows.

create table if not exists public.dev_project_source_runs (
    run_id text primary key,
    run_label text not null,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    source_scope text[] not null default array[]::text[],
    row_count integer not null default 0,
    summary jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.dev_project_field_evidence (
    evidence_hash text primary key,
    run_id text references public.dev_project_source_runs(run_id) on delete set null,
    dev_project_id text not null references public.dev_project_list(dev_project_id) on delete cascade,
    list_no integer not null,
    project_name_snapshot text not null,
    entity_type text not null,
    entity_id text,
    field_name text not null,
    field_label text not null,
    value_text text,
    value_numeric numeric,
    value_date date,
    value_json jsonb,
    unit text,
    source_system text not null,
    source_name text not null,
    source_priority integer not null default 50,
    source_record_id text,
    source_path text,
    source_updated_at timestamptz,
    match_method text not null,
    confidence numeric not null default 0.5,
    needs_review boolean not null default false,
    notes text,
    metadata jsonb not null default '{}'::jsonb,
    is_active boolean not null default true,
    captured_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists dev_project_field_evidence_project_idx
    on public.dev_project_field_evidence(dev_project_id);

create index if not exists dev_project_field_evidence_field_idx
    on public.dev_project_field_evidence(field_name);

create index if not exists dev_project_field_evidence_source_idx
    on public.dev_project_field_evidence(source_system, source_name);

create index if not exists dev_project_field_evidence_review_idx
    on public.dev_project_field_evidence(needs_review)
    where needs_review;

create or replace view public.dev_project_field_best_evidence as
with ranked as (
    select
        e.*,
        row_number() over (
            partition by e.dev_project_id, e.field_name
            order by
                e.needs_review asc,
                e.confidence desc,
                e.source_priority desc,
                e.source_updated_at desc nulls last,
                e.captured_at desc
        ) as candidate_rank
    from public.dev_project_field_evidence e
    where e.is_active
      and coalesce(e.value_text, e.value_numeric::text, e.value_date::text, e.value_json::text) is not null
)
select *
from ranked
where candidate_rank = 1;

create or replace view public.dev_project_field_evidence_summary as
select
    dpl.dev_project_id,
    dpl.list_no,
    dpl.project_name,
    dpl.source_category,
    dpl.vehicle_text,
    count(e.*) as evidence_count,
    count(distinct e.field_name) as covered_field_count,
    count(*) filter (where e.needs_review) as review_evidence_count,
    array_remove(array_agg(distinct e.field_label order by e.field_label), null) as covered_fields,
    array_remove(array_agg(distinct e.source_system || ':' || e.source_name order by e.source_system || ':' || e.source_name), null) as sources
from public.dev_project_list dpl
left join public.dev_project_field_evidence e
    on e.dev_project_id = dpl.dev_project_id
   and e.is_active
group by
    dpl.dev_project_id,
    dpl.list_no,
    dpl.project_name,
    dpl.source_category,
    dpl.vehicle_text;

create or replace view public.dev_project_34_enrichment_best_matrix as
select
    dpl.dev_project_id,
    dpl.list_no,
    dpl.project_name,
    dpl.source_category,
    dpl.vehicle_text,
    max(e.value_text) filter (where e.field_name = 'project_status') as project_status_candidate,
    max(e.value_text) filter (where e.field_name = 'setup_date') as setup_date_candidate,
    max(e.value_date) filter (where e.field_name = 'setup_date') as setup_date_value,
    max(e.value_text) filter (where e.field_name = 'maturity_date') as maturity_date_candidate,
    max(e.value_text) filter (where e.field_name = 'legal_form') as legal_form_candidate,
    max(e.value_text) filter (where e.field_name = 'vehicle_class') as vehicle_class_candidate,
    max(e.value_text) filter (where e.field_name = 'holding_type') as holding_type_candidate,
    max(e.value_text) filter (where e.field_name = 'business_stage') as business_stage_candidate,
    max(e.value_text) filter (where e.field_name = 'asset_type') as asset_type_candidate,
    max(e.value_text) filter (where e.field_name = 'asset_nature') as asset_nature_candidate,
    max(e.value_text) filter (where e.field_name = 'manager_text') as manager_candidate,
    max(e.value_text) filter (where e.field_name = 'dept_text') as dept_candidate,
    max(e.value_numeric) filter (where e.field_name = 'benchmark_aum_won') as benchmark_aum_won_candidate,
    max(e.value_numeric) filter (where e.field_name = 'invested_aum_won') as invested_aum_won_candidate,
    max(e.value_numeric) filter (where e.field_name = 'aum_won') as aum_won_candidate,
    max(e.value_text) filter (where e.field_name = 'source_asset_name') as asset_name_candidate,
    max(e.value_text) filter (where e.field_name = 'address_text') as address_text_candidate,
    max(e.value_text) filter (where e.field_name = 'main_usage') as main_usage_candidate,
    max(e.value_numeric) filter (where e.field_name = 'site_area_sqm') as site_area_sqm_candidate,
    max(e.value_numeric) filter (where e.field_name = 'gross_floor_area_sqm') as gross_floor_area_sqm_candidate,
    max(e.value_numeric) filter (where e.field_name = 'gross_floor_area_pyeong') as gross_floor_area_pyeong_candidate,
    max(e.value_numeric) filter (where e.field_name = 'scr_percent') as scr_percent_candidate,
    max(e.value_numeric) filter (where e.field_name = 'far_percent') as far_percent_candidate,
    max(e.value_text) filter (where e.field_name = 'completion_date') as completion_date_candidate,
    max(e.value_date) filter (where e.field_name = 'completion_date') as completion_date_value,
    count(e.*) as best_field_count,
    count(*) filter (where e.needs_review) as best_review_count,
    jsonb_object_agg(
        e.field_name,
        jsonb_build_object(
            'label', e.field_label,
            'value_text', e.value_text,
            'value_numeric', e.value_numeric,
            'value_date', e.value_date,
            'source_system', e.source_system,
            'source_name', e.source_name,
            'confidence', e.confidence,
            'needs_review', e.needs_review
        )
        order by e.field_name
    ) filter (where e.evidence_hash is not null) as best_evidence
from public.dev_project_list dpl
left join public.dev_project_field_best_evidence e
    on e.dev_project_id = dpl.dev_project_id
group by
    dpl.dev_project_id,
    dpl.list_no,
    dpl.project_name,
    dpl.source_category,
    dpl.vehicle_text;

comment on table public.dev_project_field_evidence is
    'Field-level enrichment candidates for the 34 development-project list. Stores provenance, match method, confidence, and review flags.';

comment on view public.dev_project_field_best_evidence is
    'Best current enrichment candidate per development project and field, ranked by review flag, confidence, source priority, and recency.';

comment on view public.dev_project_34_enrichment_best_matrix is
    'One-row-per-development-project review matrix built from dev_project_field_best_evidence. Candidate values are not approved master updates.';

alter table public.dev_project_source_runs enable row level security;
alter table public.dev_project_field_evidence enable row level security;

drop policy if exists dev_project_source_runs_service_role_all on public.dev_project_source_runs;
drop policy if exists dev_project_field_evidence_service_role_all on public.dev_project_field_evidence;

create policy dev_project_source_runs_service_role_all
    on public.dev_project_source_runs
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');

create policy dev_project_field_evidence_service_role_all
    on public.dev_project_field_evidence
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
