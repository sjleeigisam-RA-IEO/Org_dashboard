-- Register three executive portal users with pre-provisioned credentials.
-- Password material is stored only as PBKDF2-SHA256 hashes and salts.

begin;

with incoming as (
    select *
    from (values
        (
            'staff_exec_bc9abc0728a8',
            U&'\C870\AC11\C8FC',
            'kabjoo.cho@igisam.com',
            U&'\D68C\C7A5',
            jsonb_build_object(
                'is_main', true,
                'division_scope', 'RA',
                'orgDashboardHidden', false,
                'added_reason', 'executive portal direct login access requested',
                'identity_source', 'kabjoo.cho@igisam.com',
                'direct_password_login', true,
                'password_policy', 'executive_direct_v1',
                'access_scope', jsonb_build_array(
                    'portal', 't5t', 'construction_source_status', 'rent_map'
                )
            )
        ),
        (
            'staff_exec_0e5cc3d3d9bd',
            U&'\C774\CCA0\C2B9',
            'ethan.lee@igisam.com',
            U&'\BD80\BB38\B300\D45C',
            jsonb_build_object(
                'is_main', true,
                'division_scope', 'RA',
                'orgDashboardHidden', false,
                'added_reason', 'executive portal direct login access requested',
                'identity_source', 'ethan.lee@igisam.com',
                'direct_password_login', true,
                'password_policy', 'executive_direct_v1',
                'access_scope', jsonb_build_array(
                    'portal', 't5t', 'construction_source_status', 'rent_map'
                )
            )
        ),
        (
            'staff_exec_29a963021b5b',
            U&'\C2E0\D76C\C0C1',
            'hshin@igisam.com',
            U&'\ACBD\C601\B300\D45C',
            jsonb_build_object(
                'is_main', true,
                'division_scope', 'RA',
                'orgDashboardHidden', false,
                'added_reason', 'executive portal direct login access requested',
                'identity_source', 'hshin@igisam.com',
                'direct_password_login', true,
                'password_policy', 'executive_direct_v1',
                'access_scope', jsonb_build_array(
                    'portal', 't5t', 'construction_source_status', 'rent_map'
                )
            )
        )
    ) as v(staff_id, name, email, position, metadata)
), updated as (
    update public.staff s
    set
        name = i.name,
        email = lower(i.email),
        position = i.position,
        status = 'active',
        metadata = coalesce(s.metadata, '{}'::jsonb) || i.metadata,
        updated_at = now()
    from incoming i
    where lower(s.email) = lower(i.email)
    returning s.staff_id
)
insert into public.staff (
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
select
    i.staff_id,
    null,
    i.name,
    null,
    lower(i.email),
    null,
    null,
    i.position,
    null,
    null,
    null,
    'active',
    null,
    null,
    false,
    null,
    null,
    'portal_login_manual_add',
    i.metadata,
    now()
from incoming i
where not exists (
    select 1
    from public.staff s
    where lower(s.email) = lower(i.email)
       or s.staff_id = i.staff_id
)
on conflict (staff_id) do update set
    name = excluded.name,
    email = excluded.email,
    position = excluded.position,
    status = 'active',
    metadata = coalesce(public.staff.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with credential_values as (
    select *
    from (values
        ('kabjoo.cho@igisam.com', 'S6DPd89SzgWBO4tmMa3GUCf0guiKaFsR', 'II550JIW44/y47Umqpt3L/sbmUC+Qd/xbYRC1CSUN0s='),
        ('ethan.lee@igisam.com', '6BO_dhReKPbo49zEn2j4eYf7eeOjxBCb', 'OebgrnjoSpOFMadC6sEAnc2QbTtAyg7nEcS3e6ZKypE='),
        ('hshin@igisam.com', 'LaKpB3p94KoCsluaJCKJiqPjZoemAspI', 'lKKvYE16lxT2EH+/MVMGKHCTyNhFylyw1wqFNphLrxc=')
    ) as v(email, password_salt, password_hash)
)
insert into public.ra_user_credentials (
    staff_id,
    email,
    password_hash,
    password_salt,
    hash_algo,
    hash_iterations,
    password_set_at,
    updated_at
)
select
    s.staff_id,
    lower(s.email),
    cv.password_hash,
    cv.password_salt,
    'PBKDF2-SHA256',
    210000,
    now(),
    now()
from credential_values cv
join public.staff s on lower(s.email) = lower(cv.email)
on conflict (staff_id) do update set
    email = excluded.email,
    password_hash = excluded.password_hash,
    password_salt = excluded.password_salt,
    hash_algo = excluded.hash_algo,
    hash_iterations = excluded.hash_iterations,
    password_set_at = excluded.password_set_at,
    updated_at = excluded.updated_at;

do $$
declare
    active_count integer;
    credential_count integer;
begin
    select count(*) into active_count
    from public.staff
    where lower(email) in (
        'kabjoo.cho@igisam.com',
        'ethan.lee@igisam.com',
        'hshin@igisam.com'
    )
      and status = 'active';

    select count(*) into credential_count
    from public.ra_user_credentials
    where lower(email) in (
        'kabjoo.cho@igisam.com',
        'ethan.lee@igisam.com',
        'hshin@igisam.com'
    )
      and hash_algo = 'PBKDF2-SHA256'
      and hash_iterations = 210000;

    if active_count <> 3 or credential_count <> 3 then
        raise exception 'Executive portal login provisioning failed: active=%, credentials=%',
            active_count,
            credential_count;
    end if;
end $$;

commit;
