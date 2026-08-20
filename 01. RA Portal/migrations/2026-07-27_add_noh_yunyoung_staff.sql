-- Register a new hire discovered through the Notion T5T submission feed.
-- Organization and personnel fields stay null until the authoritative roster supplies them.

INSERT INTO public.staff (
    staff_id,
    employee_no,
    name,
    eng_name,
    email,
    title,
    level,
    position,
    org_id,
    line_code,
    line_label,
    status,
    join_date,
    leave_date,
    is_dual_role,
    cohort,
    notion_id,
    source_system,
    metadata,
    updated_at
)
VALUES (
    'staff_new_d469a2a26647',
    NULL,
    U&'\B178\C724\C601',
    NULL,
    'yvette.noh@igisam.com',
    NULL,
    NULL,
    NULL,
    NULL,
    'E',
    'E Line',
    'active',
    NULL,
    NULL,
    FALSE,
    NULL,
    NULL,
    'notion_t5t_new_hire',
    jsonb_build_object(
        'is_main', TRUE,
        'division_scope', 'RA',
        'orgDashboardHidden', FALSE,
        'added_reason', 'new hire identified from Notion T5T submission',
        'identity_source', 'yvette.noh@igisam.com'
    ),
    NOW()
)
ON CONFLICT (staff_id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    line_code = COALESCE(public.staff.line_code, EXCLUDED.line_code),
    line_label = COALESCE(public.staff.line_label, EXCLUDED.line_label),
    status = 'active',
    source_system = EXCLUDED.source_system,
    metadata = COALESCE(public.staff.metadata, '{}'::jsonb) || EXCLUDED.metadata,
    updated_at = NOW();
