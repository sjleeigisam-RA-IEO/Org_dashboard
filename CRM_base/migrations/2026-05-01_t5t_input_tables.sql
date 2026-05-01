-- T5T input foundation tables.
-- These tables prepare the DB for a future dashboard input form where people
-- choose themselves and projects from server-provided masters.

CREATE TABLE IF NOT EXISTS public.projects (
    project_id TEXT PRIMARY KEY,
    notion_id TEXT UNIQUE,
    project_code TEXT,
    project_name TEXT NOT NULL,
    project_type TEXT,
    status TEXT,
    priority TEXT,
    health TEXT,
    lead_org_text TEXT,
    lead_staff_id TEXT REFERENCES public.staff(staff_id),
    start_date DATE,
    target_date DATE,
    next_check_date DATE,
    source_system TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS projects_name_idx ON public.projects(project_name);
CREATE INDEX IF NOT EXISTS projects_notion_idx ON public.projects(notion_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON public.projects(status);

CREATE TABLE IF NOT EXISTS public.project_staff_links (
    link_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES public.projects(project_id) ON DELETE CASCADE,
    staff_id TEXT REFERENCES public.staff(staff_id),
    notion_staff_id TEXT,
    role TEXT NOT NULL,
    source_system TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_staff_links_project_idx
    ON public.project_staff_links(project_id);
CREATE INDEX IF NOT EXISTS project_staff_links_staff_idx
    ON public.project_staff_links(staff_id);

CREATE TABLE IF NOT EXISTS public.t5t_logs (
    t5t_log_id TEXT PRIMARY KEY,
    notion_id TEXT UNIQUE,
    writer_staff_id TEXT REFERENCES public.staff(staff_id),
    writer_name TEXT,
    line TEXT,
    work_date DATE,
    week_key TEXT,
    week_end_date DATE,
    task_type TEXT,
    log_title TEXT,
    summary TEXT,
    raw_text TEXT,
    source_url TEXT,
    matching_status TEXT,
    matching_basis TEXT,
    needs_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
    classification_summary TEXT,
    classification_tokens TEXT,
    input_status TEXT NOT NULL DEFAULT 'synced',
    source_system TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS t5t_logs_writer_idx ON public.t5t_logs(writer_staff_id);
CREATE INDEX IF NOT EXISTS t5t_logs_work_date_idx ON public.t5t_logs(work_date);
CREATE INDEX IF NOT EXISTS t5t_logs_week_idx ON public.t5t_logs(week_key);

CREATE TABLE IF NOT EXISTS public.t5t_log_project_links (
    link_id TEXT PRIMARY KEY,
    t5t_log_id TEXT NOT NULL REFERENCES public.t5t_logs(t5t_log_id) ON DELETE CASCADE,
    project_id TEXT REFERENCES public.projects(project_id),
    notion_project_id TEXT,
    relation_type TEXT NOT NULL DEFAULT 'mentioned',
    match_status TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS t5t_log_project_links_log_idx
    ON public.t5t_log_project_links(t5t_log_id);
CREATE INDEX IF NOT EXISTS t5t_log_project_links_project_idx
    ON public.t5t_log_project_links(project_id);

CREATE TABLE IF NOT EXISTS public.t5t_input_drafts (
    draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    writer_staff_id TEXT NOT NULL REFERENCES public.staff(staff_id),
    work_date DATE NOT NULL,
    task_type TEXT,
    summary TEXT NOT NULL,
    raw_text TEXT,
    selected_project_ids TEXT[] NOT NULL DEFAULT '{}',
    selected_fund_ids TEXT[] NOT NULL DEFAULT '{}',
    input_status TEXT NOT NULL DEFAULT 'draft',
    submitted_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS t5t_input_drafts_writer_idx
    ON public.t5t_input_drafts(writer_staff_id);
CREATE INDEX IF NOT EXISTS t5t_input_drafts_status_idx
    ON public.t5t_input_drafts(input_status);

COMMENT ON TABLE public.projects IS
    'Project master for future T5T input selection and dashboard grouping.';
COMMENT ON TABLE public.t5t_logs IS
    'Normalized T5T logs. Synced Notion rows and future dashboard input rows share this table.';
COMMENT ON TABLE public.t5t_input_drafts IS
    'Future dashboard input staging table. UI can write drafts/submissions here before Notion sync is decided.';

CREATE TABLE IF NOT EXISTS public.t5t_form_submissions (
    submission_id TEXT PRIMARY KEY,
    respondent_id TEXT,
    submitted_at TIMESTAMPTZ,
    writer_staff_id TEXT REFERENCES public.staff(staff_id),
    writer_name TEXT,
    writer_email TEXT,
    position TEXT,
    work_date DATE,
    line TEXT,
    attachment_url TEXT,
    source_file TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS t5t_form_submissions_writer_idx
    ON public.t5t_form_submissions(writer_staff_id);
CREATE INDEX IF NOT EXISTS t5t_form_submissions_work_date_idx
    ON public.t5t_form_submissions(work_date);
CREATE INDEX IF NOT EXISTS t5t_form_submissions_email_idx
    ON public.t5t_form_submissions(writer_email);

CREATE TABLE IF NOT EXISTS public.t5t_form_items (
    form_item_id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES public.t5t_form_submissions(submission_id) ON DELETE CASCADE,
    item_no INTEGER NOT NULL,
    writer_staff_id TEXT REFERENCES public.staff(staff_id),
    work_date DATE,
    line TEXT,
    raw_text TEXT NOT NULL,
    project_text TEXT,
    stakeholder_text TEXT,
    matched_project_id TEXT REFERENCES public.projects(project_id),
    match_status TEXT NOT NULL DEFAULT 'raw_unmatched',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (submission_id, item_no)
);

CREATE INDEX IF NOT EXISTS t5t_form_items_submission_idx
    ON public.t5t_form_items(submission_id);
CREATE INDEX IF NOT EXISTS t5t_form_items_writer_idx
    ON public.t5t_form_items(writer_staff_id);
CREATE INDEX IF NOT EXISTS t5t_form_items_work_date_idx
    ON public.t5t_form_items(work_date);
CREATE INDEX IF NOT EXISTS t5t_form_items_project_idx
    ON public.t5t_form_items(matched_project_id);

COMMENT ON TABLE public.t5t_form_submissions IS
    'Raw T5T form submissions exported from the actual T5T form before Notion processing.';
COMMENT ON TABLE public.t5t_form_items IS
    'Raw T5T item-level rows split from T5T-1 through T5T-5 fields.';
