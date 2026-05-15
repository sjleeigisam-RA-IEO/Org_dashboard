-- Remove work-log/reporting rows that were mistakenly migrated as review projects.
-- These are not project candidates; they should be handled as General/Mission text work.

WITH worklike_review_projects AS (
    SELECT review_project_id
    FROM public.review_projects
    WHERE btrim(project_name) LIKE '''%'
       OR project_name ILIKE '%보고서%'
       OR project_name ILIKE '%보고자료%'
       OR project_name ILIKE '%보고회%'
       OR project_name ILIKE '%위탁운용%'
       OR project_name ILIKE '%IM작성%'
       OR project_name ILIKE '%시장전망%'
       OR project_name ILIKE '%투자자 세미나%'
       OR project_name ILIKE '%마켓 DB%'
       OR project_name ILIKE '%DB 관리%'
       OR project_name ILIKE '%작성 지원%'
       OR project_name ILIKE '%수익자%'
),
cleared_items AS (
    UPDATE public.t5t_form_items item
    SET matched_review_project_id = NULL,
        metadata = COALESCE(item.metadata, '{}'::jsonb) || jsonb_build_object(
            'review_project_cleanup_at', NOW(),
            'removed_review_project_id', item.matched_review_project_id
        )
    FROM worklike_review_projects wrp
    WHERE item.matched_review_project_id = wrp.review_project_id
    RETURNING item.form_item_id
)
DELETE FROM public.review_projects rp
USING worklike_review_projects wrp
WHERE rp.review_project_id = wrp.review_project_id;
