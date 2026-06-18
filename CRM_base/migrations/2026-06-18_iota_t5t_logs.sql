-- T5T-derived IOTA Seoul log mart.
-- This table is for downstream platforms, not for the current T5T dashboard UI.
-- The source t5t_logs table remains unchanged; qualifying rows are copied here.

CREATE TABLE IF NOT EXISTS public.iota_t5t_logs (
    iota_log_id TEXT PRIMARY KEY,
    source_t5t_log_id TEXT UNIQUE,
    source_form_item_id TEXT,
    source_submission_id TEXT,
    writer_staff_id TEXT REFERENCES public.staff(staff_id),
    writer_name TEXT,
    writer_email TEXT,
    line TEXT,
    work_date DATE,
    week_key TEXT,
    week_end_date DATE,
    task_type TEXT,
    log_title TEXT,
    summary TEXT,
    raw_text TEXT,
    body_text TEXT,
    source_url TEXT,
    matching_status TEXT,
    matching_basis TEXT,
    needs_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
    classification_summary TEXT,
    classification_tokens JSONB NOT NULL DEFAULT '[]'::jsonb,
    match_terms JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_system TEXT NOT NULL DEFAULT 't5t_logs_iota_copy',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS iota_t5t_logs_work_date_idx
    ON public.iota_t5t_logs(work_date);
CREATE INDEX IF NOT EXISTS iota_t5t_logs_writer_idx
    ON public.iota_t5t_logs(writer_staff_id);
CREATE INDEX IF NOT EXISTS iota_t5t_logs_terms_gin_idx
    ON public.iota_t5t_logs USING GIN (match_terms);
CREATE INDEX IF NOT EXISTS iota_t5t_logs_source_form_item_idx
    ON public.iota_t5t_logs(source_form_item_id);

COMMENT ON TABLE public.iota_t5t_logs IS
    'Copied T5T logs for IOTA Seoul downstream platforms. Source t5t_logs remains unchanged.';
COMMENT ON COLUMN public.iota_t5t_logs.match_terms IS
    'Keyword terms that caused the row to be copied. Terms are detection aids, not row-count grain.';

WITH source_rows AS (
    SELECT
        log.*,
        staff.name AS staff_name,
        staff.email AS staff_email,
        concat_ws(
            ' ',
            log.raw_text,
            log.log_title,
            log.summary,
            log.classification_summary
        ) AS body_text
    FROM public.t5t_logs log
    LEFT JOIN public.staff staff
        ON staff.staff_id = log.writer_staff_id
    WHERE (
          lower(coalesce(staff.email, '')) IN (
              'sykang@igisam.com',
              'ksoonil@igisam.com',
              'jghong@igisam.com',
              'junhopark@igisam.com',
              'hyunsoo.kim@igisam.com'
          )
          OR log.writer_staff_id IN (
              'staff_10268',
              'staff_ext_000007',
              'staff_ext_000111',
              'staff_ext_000037',
              'staff_ext_000027'
          )
      )
), matched AS (
    SELECT
        *,
        array_remove(ARRAY[
            CASE
                WHEN body_text ~* '(^|[^A-Za-z])I[[:space:]]*O[[:space:]]*T[[:space:]]*A([^A-Za-z]|$)'
                  OR body_text ILIKE U&'%\C774\C624\D0C0%'
                  OR body_text ILIKE U&'%\C544\C774\C624\D0C0%'
                THEN 'IOTA Seoul'
            END,
            CASE WHEN body_text ~ U&'(^|[^0-9])427[[:space:]]*(\D638)?([^0-9]|$)' THEN '427' END,
            CASE WHEN body_text ~ U&'(^|[^0-9])816[[:space:]]*(\D638)?([^0-9]|$)' THEN '816' END,
            CASE WHEN body_text ~ U&'(^|[^0-9])421[[:space:]]*(\D638)?([^0-9]|$)' THEN '421' END
        ], NULL) AS match_terms_array
    FROM source_rows
)
INSERT INTO public.iota_t5t_logs (
    iota_log_id,
    source_t5t_log_id,
    source_form_item_id,
    source_submission_id,
    writer_staff_id,
    writer_name,
    writer_email,
    line,
    work_date,
    week_key,
    week_end_date,
    task_type,
    log_title,
    summary,
    raw_text,
    body_text,
    source_url,
    matching_status,
    matching_basis,
    needs_manual_review,
    classification_summary,
    classification_tokens,
    match_terms,
    source_system,
    metadata,
    updated_at
)
SELECT
    t5t_log_id,
    t5t_log_id,
    metadata->>'source_form_item_id',
    metadata->>'source_submission_id',
    writer_staff_id,
    CASE
        WHEN writer_staff_id = 'staff_10268' OR lower(coalesce(staff_email, '')) = 'sykang@igisam.com' THEN U&'\AC15\C21C\C6A9'
        WHEN writer_staff_id = 'staff_ext_000007' OR lower(coalesce(staff_email, '')) = 'ksoonil@igisam.com' THEN U&'\AD8C\C21C\C77C'
        WHEN writer_staff_id = 'staff_ext_000111' OR lower(coalesce(staff_email, '')) = 'jghong@igisam.com' THEN U&'\D64D\C7A5\AD70'
        WHEN writer_staff_id = 'staff_ext_000037' OR lower(coalesce(staff_email, '')) = 'junhopark@igisam.com' THEN U&'\BC15\C900\D638'
        WHEN writer_staff_id = 'staff_ext_000027' OR lower(coalesce(staff_email, '')) = 'hyunsoo.kim@igisam.com' THEN U&'\AE40\D604\C218'
        ELSE trim(split_part(COALESCE(staff_name, writer_name), '/', 1))
    END,
    staff_email,
    line,
    work_date,
    week_key,
    week_end_date,
    task_type,
    log_title,
    summary,
    raw_text,
    body_text,
    source_url,
    matching_status,
    matching_basis,
    needs_manual_review,
    classification_summary,
    COALESCE(classification_tokens, '[]'::jsonb),
    to_jsonb(match_terms_array),
    't5t_logs_iota_copy',
    jsonb_build_object(
        'copy_source', 'migration_backfill',
        'copied_from', 't5t_logs',
        'source_metadata', COALESCE(metadata, '{}'::jsonb)
    ),
    NOW()
FROM matched
WHERE array_length(match_terms_array, 1) IS NOT NULL
ON CONFLICT (iota_log_id) DO UPDATE SET
    source_t5t_log_id = EXCLUDED.source_t5t_log_id,
    source_form_item_id = EXCLUDED.source_form_item_id,
    source_submission_id = EXCLUDED.source_submission_id,
    writer_staff_id = EXCLUDED.writer_staff_id,
    writer_name = EXCLUDED.writer_name,
    writer_email = EXCLUDED.writer_email,
    line = EXCLUDED.line,
    work_date = EXCLUDED.work_date,
    week_key = EXCLUDED.week_key,
    week_end_date = EXCLUDED.week_end_date,
    task_type = EXCLUDED.task_type,
    log_title = EXCLUDED.log_title,
    summary = EXCLUDED.summary,
    raw_text = EXCLUDED.raw_text,
    body_text = EXCLUDED.body_text,
    source_url = EXCLUDED.source_url,
    matching_status = EXCLUDED.matching_status,
    matching_basis = EXCLUDED.matching_basis,
    needs_manual_review = EXCLUDED.needs_manual_review,
    classification_summary = EXCLUDED.classification_summary,
    classification_tokens = EXCLUDED.classification_tokens,
    match_terms = EXCLUDED.match_terms,
    source_system = EXCLUDED.source_system,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();
