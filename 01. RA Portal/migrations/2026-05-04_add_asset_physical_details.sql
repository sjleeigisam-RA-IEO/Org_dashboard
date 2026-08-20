-- Add physical/geospatial detail columns and building ledger source table.
-- asset_master keeps representative searchable fields.
-- asset_building_ledger keeps parsed building-register source details.

alter table asset_master
    add column if not exists site_area numeric,
    add column if not exists gross_floor_area numeric,
    add column if not exists scr numeric,
    add column if not exists far numeric,
    add column if not exists main_usage text,
    add column if not exists structure text,
    add column if not exists floors_up integer,
    add column if not exists floors_down integer,
    add column if not exists elevators integer,
    add column if not exists parking text,
    add column if not exists height numeric,
    add column if not exists completion_date date,
    add column if not exists geocode_source text,
    add column if not exists building_ledger_source text;

create table if not exists asset_building_ledger (
    asset_id text primary key references asset_master(asset_id) on delete cascade,
    pnu text,
    site_area numeric,
    gross_floor_area numeric,
    scr numeric,
    far numeric,
    main_usage text,
    structure text,
    floors_up integer,
    floors_down integer,
    elevators integer,
    parking text,
    height numeric,
    completion_date date,
    raw_ledger jsonb not null default '{}'::jsonb,
    source_table text,
    source_id text,
    confidence numeric not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_asset_building_ledger_pnu on asset_building_ledger(pnu);
create index if not exists idx_asset_master_main_usage on asset_master(main_usage);
