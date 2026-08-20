-- Core tables for migrating org_dashboard, t5t-dashboard, and CRM analytics
-- into Supabase while keeping the current dashboards on their existing JSON/API
-- data sources during the migration period.

CREATE TABLE IF NOT EXISTS public.orgs (
    org_id TEXT PRIMARY KEY,
    org_name TEXT NOT NULL,
    org_type TEXT NOT NULL,
    parent_org_id TEXT REFERENCES public.orgs(org_id),
    section TEXT,
    group_name TEXT,
    part_name TEXT,
    team_name TEXT,
    org_path TEXT,
    source_system TEXT NOT NULL DEFAULT 'org_dashboard',
    source_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.staff (
    staff_id TEXT PRIMARY KEY,
    employee_no TEXT,
    name TEXT NOT NULL,
    eng_name TEXT,
    email TEXT,
    title TEXT,
    level TEXT,
    position TEXT,
    org_id TEXT REFERENCES public.orgs(org_id),
    line_code TEXT,
    line_label TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    join_date DATE,
    leave_date DATE,
    is_dual_role BOOLEAN NOT NULL DEFAULT FALSE,
    cohort TEXT,
    notion_id TEXT,
    source_system TEXT NOT NULL DEFAULT 'merged_seed',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_employee_no_uidx
    ON public.staff(employee_no)
    WHERE employee_no IS NOT NULL AND employee_no <> '';

CREATE INDEX IF NOT EXISTS staff_name_idx ON public.staff(name);
CREATE INDEX IF NOT EXISTS staff_org_id_idx ON public.staff(org_id);
CREATE INDEX IF NOT EXISTS staff_notion_id_idx ON public.staff(notion_id);

CREATE TABLE IF NOT EXISTS public.staff_org_assignments (
    assignment_id TEXT PRIMARY KEY,
    staff_id TEXT NOT NULL REFERENCES public.staff(staff_id) ON DELETE CASCADE,
    org_id TEXT REFERENCES public.orgs(org_id),
    role TEXT,
    raw_name TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    is_dual_role BOOLEAN NOT NULL DEFAULT FALSE,
    source_system TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS staff_org_assignments_staff_idx
    ON public.staff_org_assignments(staff_id);
CREATE INDEX IF NOT EXISTS staff_org_assignments_org_idx
    ON public.staff_org_assignments(org_id);

CREATE TABLE IF NOT EXISTS public.seats (
    seat_id TEXT PRIMARY KEY,
    scenario TEXT NOT NULL DEFAULT 'current',
    seat_code TEXT NOT NULL,
    building TEXT,
    floor TEXT NOT NULL,
    seat_label TEXT,
    seat_type TEXT NOT NULL DEFAULT 'normal',
    x NUMERIC,
    y NUMERIC,
    w NUMERIC,
    h NUMERIC,
    source_cell TEXT,
    sheet_name TEXT,
    staff_id TEXT REFERENCES public.staff(staff_id),
    person_name TEXT,
    org_id TEXT REFERENCES public.orgs(org_id),
    source_team_org_id TEXT,
    origin_floor_code TEXT,
    origin_seat_code TEXT,
    is_moving BOOLEAN NOT NULL DEFAULT FALSE,
    is_external_division BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (scenario, seat_code)
);

CREATE INDEX IF NOT EXISTS seats_staff_idx ON public.seats(staff_id);
CREATE INDEX IF NOT EXISTS seats_floor_idx ON public.seats(floor);
CREATE INDEX IF NOT EXISTS seats_source_team_org_idx ON public.seats(source_team_org_id);

CREATE TABLE IF NOT EXISTS public.seat_layout_shapes (
    shape_id TEXT PRIMARY KEY,
    floor TEXT NOT NULL,
    building TEXT,
    shape_type TEXT,
    label TEXT,
    x NUMERIC,
    y NUMERIC,
    w NUMERIC,
    h NUMERIC,
    source_cell TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.aum_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    fund_id TEXT,
    snapshot_date DATE,
    snapshot_year INTEGER,
    region TEXT,
    sector TEXT,
    aum BIGINT,
    loan BIGINT,
    equity BIGINT,
    deposit BIGINT,
    is_liquidated BOOLEAN NOT NULL DEFAULT FALSE,
    source_system TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS aum_snapshots_fund_idx ON public.aum_snapshots(fund_id);
CREATE INDEX IF NOT EXISTS aum_snapshots_date_idx ON public.aum_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS aum_snapshots_year_idx ON public.aum_snapshots(snapshot_year);

CREATE TABLE IF NOT EXISTS public.fund_lifecycle (
    fund_id TEXT PRIMARY KEY,
    op_status TEXT,
    setup_date DATE,
    maturity_date DATE,
    liquidation_date DATE,
    is_aum_target BOOLEAN,
    aum_base BIGINT,
    aum_base_date DATE,
    short_name TEXT,
    fund_name TEXT,
    sector TEXT,
    asset_name TEXT,
    source_system TEXT NOT NULL DEFAULT 'current_aum_snapshot',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.funds
    ADD COLUMN IF NOT EXISTS manager_staff_id TEXT REFERENCES public.staff(staff_id),
    ADD COLUMN IF NOT EXISTS dept_org_id TEXT REFERENCES public.orgs(org_id);

ALTER TABLE public.fund_assets
    ADD COLUMN IF NOT EXISTS managing_org_id TEXT REFERENCES public.orgs(org_id);

COMMENT ON TABLE public.orgs IS
    'Common organization master migrated from org_dashboard and later enriched from t5t/CRM.';
COMMENT ON TABLE public.staff IS
    'Common staff master. t5t staff_master is the primary source; org_dashboard and seats fill gaps.';
COMMENT ON TABLE public.seats IS
    'Seat assignments by scenario. Dashboards continue to use local JSON until the DB is verified.';
COMMENT ON TABLE public.aum_snapshots IS
    'AUM time series migrated from portfolio-analysis JSON and current AUM snapshots.';
COMMENT ON TABLE public.fund_lifecycle IS
    'Fund lifecycle/status fields derived from current AUM snapshot and later fund management sources.';
