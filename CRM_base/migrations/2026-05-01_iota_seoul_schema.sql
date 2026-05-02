-- IOTA Seoul pilot tables exposed through the public Supabase REST schema.
--
-- Earlier drafts used a dedicated iota_seoul schema, but the browser pilot
-- pages use Supabase JS against the public REST schema. Keep the pilot in
-- public tables and isolate it with explicit project/source identifiers.

CREATE TABLE IF NOT EXISTS public.iota_seoul_master_data (
    record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proj_id TEXT NOT NULL,
    ws_code TEXT NOT NULL,
    classification TEXT,
    item_name TEXT,
    content TEXT,
    raw_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.iota_seoul_logs (
    log_id TEXT PRIMARY KEY,
    writer_staff_id TEXT REFERENCES public.staff(staff_id),
    writer_name TEXT,
    work_date DATE,
    raw_text TEXT NOT NULL,
    summary TEXT,
    input_status TEXT NOT NULL DEFAULT 'submitted',
    source_system TEXT NOT NULL DEFAULT 'pilot_direct_form',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.iota_seoul_log_links (
    link_id TEXT PRIMARY KEY,
    log_id TEXT NOT NULL REFERENCES public.iota_seoul_logs(log_id) ON DELETE CASCADE,
    proj_id TEXT NOT NULL,
    relation_type TEXT NOT NULL DEFAULT 'direct_input',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.iota_seoul_log_stakeholders (
    sh_id TEXT PRIMARY KEY,
    log_id TEXT NOT NULL REFERENCES public.iota_seoul_logs(log_id) ON DELETE CASCADE,
    sh_name TEXT NOT NULL,
    role_category TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS iota_seoul_master_data_proj_idx
    ON public.iota_seoul_master_data(proj_id);
CREATE INDEX IF NOT EXISTS iota_seoul_master_data_ws_idx
    ON public.iota_seoul_master_data(ws_code);
CREATE INDEX IF NOT EXISTS iota_seoul_logs_work_date_idx
    ON public.iota_seoul_logs(work_date);
CREATE INDEX IF NOT EXISTS iota_seoul_logs_writer_idx
    ON public.iota_seoul_logs(writer_staff_id);
CREATE INDEX IF NOT EXISTS iota_seoul_log_links_log_idx
    ON public.iota_seoul_log_links(log_id);
CREATE INDEX IF NOT EXISTS iota_seoul_log_links_proj_idx
    ON public.iota_seoul_log_links(proj_id);
CREATE INDEX IF NOT EXISTS iota_seoul_log_stakeholders_log_idx
    ON public.iota_seoul_log_stakeholders(log_id);

INSERT INTO public.projects (
    project_id,
    project_name,
    parent_project_id,
    project_type,
    status,
    source_system,
    metadata
) VALUES
('iota-seoul', '이오타서울 (IOTA Seoul)', NULL, 'Parent Project', 'active', 'pilot_setup', '{"aliases":["IOTA Seoul"]}'::jsonb),
('iota-427', '와이디427', 'iota-seoul', 'Child Project', 'active', 'pilot_setup', '{"aliases":["IOTA427","P00030"]}'::jsonb),
('iota-816', '와이드816', 'iota-seoul', 'Child Project', 'active', 'pilot_setup', '{"aliases":["IOTA816","와이드816","P00037"]}'::jsonb),
('iota-421f', '421호펀드', 'iota-seoul', 'Child Project', 'active', 'pilot_setup', '{"aliases":["421호","112614"]}'::jsonb)
ON CONFLICT (project_id) DO UPDATE SET
    project_name = EXCLUDED.project_name,
    parent_project_id = EXCLUDED.parent_project_id,
    project_type = EXCLUDED.project_type,
    status = EXCLUDED.status,
    source_system = EXCLUDED.source_system,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();

COMMENT ON TABLE public.iota_seoul_master_data IS
    'IOTA Seoul pilot workspace master/status data. Kept in public schema for Supabase JS access.';
COMMENT ON TABLE public.iota_seoul_logs IS
    'IOTA Seoul pilot direct input logs. Long-term merge target can be t5t_logs after the pilot stabilizes.';
