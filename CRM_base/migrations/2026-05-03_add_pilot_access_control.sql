-- IOTA pilot access control.
-- Run this in Supabase after enabling Email/Password auth for pilot users.

create table if not exists pilot_access_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email text not null unique,
    display_name text not null,
    staff_id text,
    staff_name text,
    role_code text not null default 'viewer',
    access_level text not null default 'internal'
        check (access_level in ('public', 'internal', 'restricted', 'confidential')),
    allowed_project_ids text[] not null default '{}',
    default_workspace_code text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table iota_seoul_logs
    add column if not exists created_by_user_id uuid references auth.users(id),
    add column if not exists visibility_level text not null default 'internal'
        check (visibility_level in ('public', 'internal', 'restricted', 'confidential')),
    add column if not exists access_tags jsonb not null default '{}'::jsonb;

create or replace function pilot_access_rank(level text)
returns int
language sql
immutable
as $$
    select case level
        when 'public' then 0
        when 'internal' then 1
        when 'restricted' then 2
        when 'confidential' then 3
        else 1
    end
$$;

alter table pilot_access_profiles enable row level security;
alter table iota_seoul_logs enable row level security;
alter table iota_seoul_log_links enable row level security;
alter table iota_seoul_log_stakeholders enable row level security;

drop policy if exists "pilot profiles read own" on pilot_access_profiles;
create policy "pilot profiles read own"
on pilot_access_profiles
for select
to authenticated
using (user_id = auth.uid() and is_active = true);

drop policy if exists "pilot logs insert own" on iota_seoul_logs;
create policy "pilot logs insert own"
on iota_seoul_logs
for insert
to authenticated
with check (created_by_user_id = auth.uid());

drop policy if exists "pilot logs read by access" on iota_seoul_logs;
create policy "pilot logs read by access"
on iota_seoul_logs
for select
to authenticated
using (
    exists (
        select 1
        from pilot_access_profiles p
        where p.user_id = auth.uid()
          and p.is_active = true
          and pilot_access_rank(p.access_level) >= pilot_access_rank(iota_seoul_logs.visibility_level)
          and (
              cardinality(p.allowed_project_ids) = 0
              or exists (
                  select 1
                  from iota_seoul_log_links l
                  where l.log_id = iota_seoul_logs.log_id
                    and l.proj_id = any(p.allowed_project_ids)
              )
          )
    )
);

drop policy if exists "pilot logs read own" on iota_seoul_logs;
create policy "pilot logs read own"
on iota_seoul_logs
for select
to authenticated
using (created_by_user_id = auth.uid());

drop policy if exists "pilot log links insert for own logs" on iota_seoul_log_links;
create policy "pilot log links insert for own logs"
on iota_seoul_log_links
for insert
to authenticated
with check (
    exists (
        select 1
        from iota_seoul_logs l
        where l.log_id = iota_seoul_log_links.log_id
          and l.created_by_user_id = auth.uid()
    )
);

drop policy if exists "pilot log links read by access" on iota_seoul_log_links;
create policy "pilot log links read by access"
on iota_seoul_log_links
for select
to authenticated
using (
    exists (
        select 1
        from pilot_access_profiles p
        join iota_seoul_logs l on l.log_id = iota_seoul_log_links.log_id
        where p.user_id = auth.uid()
          and p.is_active = true
          and pilot_access_rank(p.access_level) >= pilot_access_rank(l.visibility_level)
          and (
              cardinality(p.allowed_project_ids) = 0
              or iota_seoul_log_links.proj_id = any(p.allowed_project_ids)
          )
    )
);

drop policy if exists "pilot stakeholders insert for own logs" on iota_seoul_log_stakeholders;
create policy "pilot stakeholders insert for own logs"
on iota_seoul_log_stakeholders
for insert
to authenticated
with check (
    exists (
        select 1
        from iota_seoul_logs l
        where l.log_id = iota_seoul_log_stakeholders.log_id
          and l.created_by_user_id = auth.uid()
    )
);

drop policy if exists "pilot stakeholders read by access" on iota_seoul_log_stakeholders;
create policy "pilot stakeholders read by access"
on iota_seoul_log_stakeholders
for select
to authenticated
using (
    exists (
        select 1
        from pilot_access_profiles p
        join iota_seoul_logs l on l.log_id = iota_seoul_log_stakeholders.log_id
        where p.user_id = auth.uid()
          and p.is_active = true
          and pilot_access_rank(p.access_level) >= pilot_access_rank(l.visibility_level)
    )
);

-- Example profile inserts after creating users in Supabase Auth:
-- insert into pilot_access_profiles
--   (user_id, email, display_name, staff_id, staff_name, role_code, access_level, allowed_project_ids, default_workspace_code)
-- values
--   ('<auth-user-uuid>', 'po@example.com', 'PO', 'staff_emp_10171', 'PO', 'owner', 'confidential', '{}', 'WS_PM'),
--   ('<auth-user-uuid>', 'pm427@example.com', '427 PM', 'staff_emp_10268', 'Co-PM 사업1파트', 'project_member', 'restricted', array['P00030'], 'WS_PM');
