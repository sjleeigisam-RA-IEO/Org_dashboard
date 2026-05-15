-- Separate review/new-project candidates from official projects.
-- Run this in Supabase SQL Editor before deploying JS that joins review_projects.

CREATE TABLE IF NOT EXISTS public.review_projects (
    review_project_id TEXT PRIMARY KEY,
    notion_id TEXT UNIQUE,
    source_project_id TEXT UNIQUE REFERENCES public.projects(project_id) ON DELETE SET NULL,
    project_name TEXT NOT NULL,
    review_status TEXT,
    source_status TEXT,
    source_system TEXT NOT NULL DEFAULT 'review_project_migration',
    created_from TEXT NOT NULL DEFAULT 'projects',
    created_by_staff_id TEXT REFERENCES public.staff(staff_id),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS review_projects_name_idx
    ON public.review_projects(project_name);
CREATE INDEX IF NOT EXISTS review_projects_notion_idx
    ON public.review_projects(notion_id);
CREATE INDEX IF NOT EXISTS review_projects_source_project_idx
    ON public.review_projects(source_project_id);
CREATE INDEX IF NOT EXISTS review_projects_status_idx
    ON public.review_projects(review_status);

ALTER TABLE public.t5t_form_items
ADD COLUMN IF NOT EXISTS matched_review_project_id TEXT REFERENCES public.review_projects(review_project_id);

CREATE INDEX IF NOT EXISTS t5t_form_items_review_project_idx
    ON public.t5t_form_items(matched_review_project_id);

-- Initial migration candidates:
-- - Rows imported from the Notion "신규" / project-mission source.
-- - Only early/review-stage project-like rows are copied.
-- - Already-set / operating official projects stay in public.projects.
WITH review_candidates AS (
    SELECT
        p.project_id,
        p.notion_id,
        p.project_name,
        p.status,
        p.source_system,
        p.metadata
    FROM public.projects p
    WHERE p.source_system = 't5t_project_mission'
      AND COALESCE(p.project_type, 'Project') <> 'Mission'
      AND COALESCE(p.status, '') <> '설정 후'
      AND p.project_name IS NOT NULL
      AND btrim(p.project_name) <> ''
)
INSERT INTO public.review_projects (
    review_project_id,
    notion_id,
    source_project_id,
    project_name,
    review_status,
    source_status,
    source_system,
    created_from,
    metadata,
    created_at,
    updated_at
)
SELECT
    'review_' || replace(rc.project_id, 'project_', ''),
    rc.notion_id,
    rc.project_id,
    rc.project_name,
    CASE
        WHEN rc.status IS NULL OR rc.status = '' THEN 'reviewing'
        WHEN rc.status LIKE '%신규%' THEN 'new_review'
        WHEN rc.status LIKE '%시작 전%' THEN 'pre_start'
        WHEN rc.status LIKE '%설정 전%' THEN 'pre_setup'
        ELSE 'reviewing'
    END,
    rc.status,
    rc.source_system,
    'projects_migration',
    jsonb_build_object(
        'migrated_from', 'projects',
        'source_project_id', rc.project_id,
        'source_metadata', rc.metadata
    ),
    NOW(),
    NOW()
FROM review_candidates rc
ON CONFLICT (review_project_id) DO UPDATE SET
    notion_id = EXCLUDED.notion_id,
    source_project_id = EXCLUDED.source_project_id,
    project_name = EXCLUDED.project_name,
    review_status = EXCLUDED.review_status,
    source_status = EXCLUDED.source_status,
    source_system = EXCLUDED.source_system,
    metadata = public.review_projects.metadata || EXCLUDED.metadata,
    updated_at = NOW();

-- Preserve existing T5T connections by moving early-stage migrated links to
-- matched_review_project_id while leaving the original projects rows in place.
UPDATE public.t5t_form_items item
SET matched_review_project_id = rp.review_project_id,
    matched_project_id = NULL,
    metadata = COALESCE(item.metadata, '{}'::jsonb) || jsonb_build_object(
        'review_project_migrated_at', NOW(),
        'previous_matched_project_id', item.matched_project_id
    )
FROM public.review_projects rp
WHERE item.matched_project_id = rp.source_project_id
  AND item.matched_review_project_id IS NULL;

COMMENT ON TABLE public.review_projects IS
    'Review/new-project candidates separated from official projects. Notion 신규 DB rows and T5T-created pending candidates should live here until promoted.';
COMMENT ON COLUMN public.t5t_form_items.matched_review_project_id IS
    'Links a T5T item to a review/new-project candidate instead of an official project.';
