-- Asset canonical master model.
-- Keep fund_assets as the source/snapshot table and add a canonical asset layer.

create table if not exists asset_master (
    asset_id text primary key,
    canonical_name text not null,
    asset_type text,
    country_code text,
    city text,
    address_text text,
    latitude numeric,
    longitude numeric,
    pnu text,
    asset_code text,
    source_confidence numeric not null default 0,
    review_status text not null default 'auto_created'
        check (review_status in ('auto_created', 'needs_review', 'verified', 'split_required', 'merged', 'archived')),
    representative_source text,
    representative_fund_id text references funds(fund_id) on delete set null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists asset_identifiers (
    id bigserial primary key,
    asset_id text not null references asset_master(asset_id) on delete cascade,
    identifier_type text not null,
    identifier_value text not null,
    source_table text,
    source_id text,
    is_primary boolean not null default false,
    confidence numeric not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (asset_id, identifier_type, identifier_value)
);

create table if not exists asset_aliases (
    id bigserial primary key,
    asset_id text not null references asset_master(asset_id) on delete cascade,
    alias_name text not null,
    alias_type text not null default 'source_name',
    source_table text,
    source_id text,
    confidence numeric not null default 0,
    is_primary boolean not null default false,
    created_at timestamptz not null default now()
);

create unique index if not exists uq_asset_aliases_asset_alias_lower
on asset_aliases(asset_id, lower(alias_name), alias_type);

create table if not exists asset_fund_links (
    asset_id text not null references asset_master(asset_id) on delete cascade,
    fund_id text not null references funds(fund_id) on delete cascade,
    relation_type text not null default 'underlying_asset',
    source_table text,
    source_id text,
    confidence numeric not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    primary key (asset_id, fund_id, relation_type)
);

create table if not exists asset_project_links (
    asset_id text not null references asset_master(asset_id) on delete cascade,
    project_id text not null,
    relation_type text not null default 'related_project',
    source_table text,
    source_id text,
    confidence numeric not null default 0,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    primary key (asset_id, project_id, relation_type)
);

create table if not exists asset_review_queue (
    review_id bigserial primary key,
    asset_id text references asset_master(asset_id) on delete cascade,
    review_reason text not null,
    current_value jsonb not null default '{}'::jsonb,
    suggested_action text,
    review_status text not null default 'needs_review'
        check (review_status in ('needs_review', 'in_review', 'resolved', 'ignored')),
    reviewer_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_asset_master_pnu on asset_master(pnu);
create index if not exists idx_asset_master_asset_code on asset_master(asset_code);
create index if not exists idx_asset_master_canonical_name on asset_master(canonical_name);
create index if not exists idx_asset_identifiers_value on asset_identifiers(identifier_type, identifier_value);
create index if not exists idx_asset_fund_links_fund_id on asset_fund_links(fund_id);
create index if not exists idx_asset_project_links_project_id on asset_project_links(project_id);
