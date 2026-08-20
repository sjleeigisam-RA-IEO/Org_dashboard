-- Add three IOTA-aware T5T writers to the IOTA log copy contract.
-- This backfills only the newly-added writers and keeps t5t_logs unchanged.

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
              'hyungsuk.woo@igisam.com',
              'gwansik.yoon@igisam.com',
              'jmjung@igisam.com'
          )
          OR log.writer_staff_id IN (
              'staff_10238',
              'staff_ext_000054',
              'staff_10145'
          )
          OR trim(split_part(COALESCE(staff.name, log.writer_name), '/', 1)) IN (
              U&'\C6B0\D615\C11D',
              U&'\C724\AD00\C2DD',
              U&'\C815\C870\BBFC'
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
        WHEN writer_staff_id = 'staff_10238' OR lower(coalesce(staff_email, '')) = 'hyungsuk.woo@igisam.com' THEN U&'\C6B0\D615\C11D'
        WHEN writer_staff_id = 'staff_ext_000054' OR lower(coalesce(staff_email, '')) = 'gwansik.yoon@igisam.com' THEN U&'\C724\AD00\C2DD'
        WHEN writer_staff_id = 'staff_10145' OR lower(coalesce(staff_email, '')) = 'jmjung@igisam.com' THEN U&'\C815\C870\BBFC'
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
    't5t_logs_iota_copy_added_writers_20260706',
    jsonb_build_object(
        'copy_source', 'migration_backfill_added_writers_20260706',
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
