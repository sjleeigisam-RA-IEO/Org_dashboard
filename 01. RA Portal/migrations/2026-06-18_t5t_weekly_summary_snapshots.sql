-- Weekly T5T summary snapshots.
-- Stores the generated weekly_summary.json payload per reporting week so the
-- dashboard can browse historical summaries instead of only the latest file.

CREATE TABLE IF NOT EXISTS public.t5t_weekly_summary_snapshots (
    week_key TEXT PRIMARY KEY,
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    total_logs INTEGER NOT NULL DEFAULT 0,
    summary_json JSONB NOT NULL,
    source TEXT NOT NULL DEFAULT 'generate_t5t_weekly_summary',
    generated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS t5t_weekly_summary_snapshots_week_end_idx
    ON public.t5t_weekly_summary_snapshots(week_end DESC);

COMMENT ON TABLE public.t5t_weekly_summary_snapshots IS
    'Generated T5T weekly summary JSON snapshots by reporting week.';
