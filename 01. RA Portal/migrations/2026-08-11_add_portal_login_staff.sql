-- Register portal dashboard login users requested on 2026-08-11.
-- The shared RA auth function grants portal access to active staff rows by email.

WITH incoming AS (
    SELECT *
    FROM (VALUES
        (
            'staff_new_21d5c32fbfe0',
            NULL::text,
            U&'\B0A8\BBFC\D638',
            'Nam Min Ho',
            'minho@igisam.com',
            'portal_login_manual_add',
            jsonb_build_object(
                'is_main', TRUE,
                'division_scope', 'RA',
                'orgDashboardHidden', FALSE,
                'added_reason', 'portal dashboard login access requested',
                'identity_source', 'minho@igisam.com',
                'access_scope', jsonb_build_array(
                    'portal',
                    't5t',
                    'construction_source_status',
                    'rent_map'
                )
            )
        ),
        (
            'staff_new_b2117b87e40d',
            NULL::text,
            U&'\AE40\D604\C9C4',
            'Kim Hyeon Jin',
            'patioblue@igisam.com',
            'portal_login_manual_add',
            jsonb_build_object(
                'is_main', TRUE,
                'division_scope', 'RA',
                'orgDashboardHidden', FALSE,
                'added_reason', 'portal dashboard login access requested',
                'identity_source', 'patioblue@igisam.com',
                'access_scope', jsonb_build_array(
                    'portal',
                    't5t',
                    'construction_source_status',
                    'rent_map'
                )
            )
        )
    ) AS v(staff_id, employee_no, name, eng_name, email, source_system, metadata)
), updated AS (
    UPDATE public.staff s
    SET
        name = i.name,
        eng_name = COALESCE(NULLIF(s.eng_name, ''), i.eng_name),
        email = lower(i.email),
        status = 'active',
        source_system = COALESCE(NULLIF(s.source_system, ''), i.source_system),
        metadata = COALESCE(s.metadata, '{}'::jsonb) || i.metadata,
        updated_at = NOW()
    FROM incoming i
    WHERE lower(s.email) = lower(i.email)
    RETURNING s.email
)
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
SELECT
    i.staff_id,
    i.employee_no,
    i.name,
    i.eng_name,
    lower(i.email),
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'active',
    NULL,
    NULL,
    FALSE,
    NULL,
    NULL,
    i.source_system,
    i.metadata,
    NOW()
FROM incoming i
WHERE NOT EXISTS (
    SELECT 1
    FROM public.staff s
    WHERE lower(s.email) = lower(i.email)
       OR s.staff_id = i.staff_id
)
ON CONFLICT (staff_id) DO UPDATE SET
    name = EXCLUDED.name,
    eng_name = COALESCE(NULLIF(public.staff.eng_name, ''), EXCLUDED.eng_name),
    email = EXCLUDED.email,
    status = 'active',
    source_system = COALESCE(NULLIF(public.staff.source_system, ''), EXCLUDED.source_system),
    metadata = COALESCE(public.staff.metadata, '{}'::jsonb) || EXCLUDED.metadata,
    updated_at = NOW();
