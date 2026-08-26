-- Register two approved RA Portal users for first-time password setup.
-- The plaintext setup code is intentionally not stored in Git or the database.

begin;

with incoming as (
    select *
    from (values
        ('portal-belbed1to9', U&'\C774\C815\C6B4C', 'belbed1to9@igisam.com'),
        ('portal-goonzard', U&'\BC30\C0C1\C77C', 'goonzard@igisam.com')
    ) as v(staff_id, name, email)
), updated as (
    update public.staff s
    set
        name = i.name,
        email = lower(i.email),
        status = 'active',
        source_system = 'ra_portal_approved_user',
        metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
            'portal_access', true,
            'provisioned_by', 'migration',
            'provisioned_at', '2026-08-26'
        ),
        updated_at = now()
    from incoming i
    where lower(s.email) = lower(i.email)
    returning s.staff_id
)
insert into public.staff (
    staff_id, name, email, status, is_dual_role, source_system, metadata, updated_at
)
select
    i.staff_id,
    i.name,
    lower(i.email),
    'active',
    false,
    'ra_portal_approved_user',
    jsonb_build_object(
        'portal_access', true,
        'provisioned_by', 'migration',
        'provisioned_at', '2026-08-26'
    ),
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
    status = 'active',
    source_system = excluded.source_system,
    metadata = coalesce(public.staff.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = excluded.updated_at;

insert into public.ra_setup_codes (
    label, code_hash, purpose, max_uses, use_count, expires_at
)
values (
    'onboard-lee-jeongwoon-bae-sangil-20260826',
    'c3514d30ba63459be15ac7c627a9a2a23765fef3086c8214f2c33814134d118c',
    'password_setup',
    2,
    0,
    now() + interval '30 days'
)
on conflict (code_hash) do nothing;

do $$
declare
    active_count integer;
    setup_code_count integer;
begin
    select count(*) into active_count
    from public.staff
    where lower(email) in ('belbed1to9@igisam.com', 'goonzard@igisam.com')
      and status = 'active';

    select count(*) into setup_code_count
    from public.ra_setup_codes
    where label = 'onboard-lee-jeongwoon-bae-sangil-20260826'
      and code_hash = 'c3514d30ba63459be15ac7c627a9a2a23765fef3086c8214f2c33814134d118c';

    if active_count <> 2 or setup_code_count <> 1 then
        raise exception 'RA Portal onboarding verification failed: active=%, setup_code=%',
            active_count,
            setup_code_count;
    end if;
end $$;

commit;
