-- One Account RM assignments. Apply using the Supabase database administrator.
-- No company data, passwords, API keys, or public bootstrap endpoint live here.
-- Seed contract is documented in db/README.md. Runtime access is RPC-only.
begin;

create schema if not exists one_account;
revoke all on schema one_account from public, anon, authenticated, service_role;

create table one_account.datasets (
  dataset_id text primary key check (dataset_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$'),
  snapshot_id text not null check (length(snapshot_id) between 1 and 200),
  baseline_sha256 text not null check (baseline_sha256 ~ '^[a-f0-9]{64}$'),
  baseline_assignments jsonb not null check (jsonb_typeof(baseline_assignments) = 'object'),
  catalogs jsonb not null check (
    jsonb_typeof(catalogs) = 'object'
    and catalogs ?& array['accounts', 'rms']
    and jsonb_typeof(catalogs -> 'accounts') = 'object'
    and jsonb_typeof(catalogs -> 'rms') = 'object'
  ),
  created_at timestamptz not null default transaction_timestamp()
);

create table one_account.versions (
  dataset_id text not null references one_account.datasets(dataset_id),
  revision bigint not null check (revision >= 1),
  parent_revision bigint,
  created_at timestamptz not null default transaction_timestamp(),
  actor_email text not null check (
    length(actor_email) <= 254
    and actor_email = lower(actor_email)
    and actor_email ~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+([.][a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@igisam[.]com$'
  ),
  action text not null check (action in ('baseline', 'save', 'restore')),
  note text not null default '' check (length(note) <= 500),
  restored_from_revision bigint,
  assignments jsonb not null check (jsonb_typeof(assignments) = 'object'),
  request_id uuid,
  primary key (dataset_id, revision),
  unique (dataset_id, request_id),
  foreign key (dataset_id, parent_revision)
    references one_account.versions(dataset_id, revision),
  foreign key (dataset_id, restored_from_revision)
    references one_account.versions(dataset_id, revision),
  check (
    (revision = 1 and parent_revision is null and action = 'baseline' and request_id is null)
    or (revision > 1 and parent_revision = revision - 1 and action in ('save', 'restore') and request_id is not null)
  ),
  check ((action = 'restore') = (restored_from_revision is not null)),
  check (restored_from_revision is null or restored_from_revision < revision)
);

create table one_account.current_state (
  dataset_id text primary key references one_account.datasets(dataset_id),
  revision bigint not null,
  assignments jsonb not null check (jsonb_typeof(assignments) = 'object'),
  updated_at timestamptz not null,
  actor_email text not null,
  foreign key (dataset_id, revision) references one_account.versions(dataset_id, revision)
);

create table one_account.version_changes (
  dataset_id text not null,
  revision bigint not null,
  account_id text not null,
  account_name text not null,
  role text not null check (role in ('primary', 'backup', 'sponsor')),
  before_rm_id text,
  after_rm_id text,
  before_rm_name text,
  after_rm_name text,
  primary key (dataset_id, revision, account_id, role),
  foreign key (dataset_id, revision) references one_account.versions(dataset_id, revision),
  check (before_rm_id is distinct from after_rm_id),
  check (before_rm_id is null or length(before_rm_id) > 0),
  check (after_rm_id is null or length(after_rm_id) > 0)
);

-- Accepted no-op requests also have an idempotency record. Retrying the same
-- request returns its original result, even if another editor has since saved.
create table one_account.commit_requests (
  dataset_id text not null,
  request_id uuid not null,
  actor_email text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result_revision bigint not null,
  result_status text not null check (result_status in ('committed', 'noop')),
  created_at timestamptz not null default transaction_timestamp(),
  primary key (dataset_id, request_id),
  foreign key (dataset_id, result_revision) references one_account.versions(dataset_id, revision)
);

alter table one_account.datasets enable row level security;
alter table one_account.versions enable row level security;
alter table one_account.current_state enable row level security;
alter table one_account.version_changes enable row level security;
alter table one_account.commit_requests enable row level security;
revoke all on all tables in schema one_account from public, anon, authenticated, service_role;

create function one_account._reject_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'One Account history and baseline are immutable' using errcode = '55000';
end;
$$;
create trigger datasets_immutable before update or delete on one_account.datasets
  for each row execute function one_account._reject_history_mutation();
create trigger versions_append_only before update or delete on one_account.versions
  for each row execute function one_account._reject_history_mutation();
create trigger changes_append_only before update or delete on one_account.version_changes
  for each row execute function one_account._reject_history_mutation();
create trigger requests_append_only before update or delete on one_account.commit_requests
  for each row execute function one_account._reject_history_mutation();

-- Validate independently of the web server. Only RM identities are returned:
-- client timestamps cannot create a version or forge a role's modification date.
create function one_account._normalise_assignments(p_catalogs jsonb, p_assignments jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_account text;
  v_team jsonb;
  v_role text;
  v_field text;
  v_rm text;
  v_seen text[];
  v_record jsonb;
  v_result jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_assignments) is distinct from 'object'
     or octet_length(p_assignments::text) > 2000000 then
    raise exception 'Invalid assignments object' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_assignments)) > 5000 then
    raise exception 'Too many assignments' using errcode = '22023';
  end if;
  for v_account, v_team in select key, value from jsonb_each(p_assignments) loop
    if not coalesce((p_catalogs -> 'accounts') ? v_account, false)
       or jsonb_typeof(v_team) is distinct from 'object' then
      raise exception 'Unknown account or invalid team' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_object_keys(v_team) as k(key)
               where k.key not in ('primaryRmId', 'backupRmId', 'sponsorRmId', 'updatedAtByRole')) then
      raise exception 'Unsupported team field' using errcode = '22023';
    end if;
    if v_team ? 'updatedAtByRole' then
      if jsonb_typeof(v_team -> 'updatedAtByRole') is distinct from 'object' then
        raise exception 'Invalid role timestamps' using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_each(v_team -> 'updatedAtByRole') as t(key, value)
                 where t.key not in ('primary', 'backup', 'sponsor')
                    or jsonb_typeof(t.value) is distinct from 'string'
                    or length(t.value #>> '{}') > 64) then
        raise exception 'Invalid role timestamps' using errcode = '22023';
      end if;
    end if;
    v_seen := array[]::text[];
    v_record := '{}'::jsonb;
    foreach v_role in array array['primary', 'backup', 'sponsor'] loop
      v_field := v_role || 'RmId';
      if jsonb_typeof(v_team -> v_field) is distinct from 'string' then
        raise exception 'Each RM role must be a string' using errcode = '22023';
      end if;
      v_rm := v_team ->> v_field;
      if v_rm <> '' then
        if length(v_rm) > 200
           or not coalesce((p_catalogs -> 'rms') ? v_rm, false)
           or jsonb_typeof(p_catalogs -> 'rms' -> v_rm -> 'roles') is distinct from 'array'
           or not coalesce((p_catalogs -> 'rms' -> v_rm -> 'roles') ? v_role, false) then
          raise exception 'RM is not a candidate for this role' using errcode = '22023';
        end if;
        if v_rm = any(v_seen) then
          raise exception 'An account cannot assign one person to multiple roles' using errcode = '22023';
        end if;
        v_seen := array_append(v_seen, v_rm);
      end if;
      v_record := v_record || jsonb_build_object(v_field, v_rm);
    end loop;
    -- The empty team and an omitted account have identical meaning.
    if cardinality(v_seen) > 0 then
      v_result := v_result || jsonb_build_object(v_account, v_record);
    end if;
  end loop;
  return v_result;
end;
$$;

create function one_account._version_state(p_dataset_id text, p_revision bigint)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'dataset_id', d.dataset_id,
    'revision', v.revision,
    'current_revision', c.revision,
    'assignments', v.assignments,
    'baseline_sha256', d.baseline_sha256,
    'snapshot_id', d.snapshot_id,
    'updated_at', v.created_at,
    'actor_email', v.actor_email
  )
  from one_account.datasets d
  join one_account.versions v on v.dataset_id = d.dataset_id and v.revision = p_revision
  join one_account.current_state c on c.dataset_id = d.dataset_id
  where d.dataset_id = p_dataset_id;
$$;

create function public.oa_get_state(p_dataset_id text, p_revision bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if p_revision is not null and p_revision < 1 then
    raise exception 'Invalid state revision' using errcode = '22023';
  end if;
  select one_account._version_state(c.dataset_id, coalesce(p_revision, c.revision)) into v_result
  from one_account.current_state c where c.dataset_id = p_dataset_id;
  if v_result is null then
    raise exception 'Unknown One Account dataset or revision' using errcode = 'P0002';
  end if;
  return jsonb_build_object('status', 'ok') || v_result;
end;
$$;

create function public.oa_commit_state(
  p_dataset_id text,
  p_expected_revision bigint,
  p_assignments jsonb,
  p_actor_email text,
  p_request_id uuid,
  p_note text,
  p_restore_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_dataset one_account.datasets%rowtype;
  v_current one_account.current_state%rowtype;
  v_request one_account.commit_requests%rowtype;
  v_roles jsonb;
  v_old_roles jsonb;
  v_source jsonb;
  v_new_assignments jsonb := '{}'::jsonb;
  v_record jsonb;
  v_times jsonb;
  v_account text;
  v_team jsonb;
  v_role text;
  v_field text;
  v_before text;
  v_after text;
  v_timestamp text;
  v_now timestamptz;
  v_next bigint;
  v_request_hash text;
  v_note text := coalesce(p_note, '');
begin
  if p_expected_revision is null or p_expected_revision < 1 or p_request_id is null
     or p_actor_email is null or length(p_actor_email) > 254
     or p_actor_email <> lower(p_actor_email)
     or p_actor_email !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+([.][a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@igisam[.]com$'
     or length(v_note) > 500
     or (p_restore_revision is not null and p_restore_revision < 1) then
    raise exception 'Invalid commit metadata' using errcode = '22023';
  end if;

  -- Serialise every write per dataset. Checking the expected revision after
  -- this lock makes two editors at the same base revision conflict safely.
  select * into v_current from one_account.current_state
  where dataset_id = p_dataset_id for update;
  if not found then
    raise exception 'Unknown One Account dataset' using errcode = 'P0002';
  end if;
  select * into strict v_dataset from one_account.datasets where dataset_id = p_dataset_id;
  if p_restore_revision is null then
    v_source := p_assignments;
  else
    select assignments into v_source from one_account.versions
    where dataset_id = p_dataset_id and revision = p_restore_revision;
    if not found then
      raise exception 'Unknown restore revision' using errcode = 'P0002';
    end if;
  end if;
  v_roles := one_account._normalise_assignments(v_dataset.catalogs, v_source);
  v_request_hash := encode(sha256(convert_to(jsonb_build_object(
    'actor', p_actor_email, 'expected_revision', p_expected_revision,
    'assignments', v_roles, 'note', v_note, 'restore_revision', p_restore_revision
  )::text, 'UTF8')), 'hex');

  select * into v_request from one_account.commit_requests
  where dataset_id = p_dataset_id and request_id = p_request_id;
  if found then
    if v_request.actor_email <> p_actor_email or v_request.request_hash <> v_request_hash then
      raise exception 'Request id was already used for another operation' using errcode = '22023';
    end if;
    return jsonb_build_object('status', 'replayed', 'original_status', v_request.result_status)
      || one_account._version_state(p_dataset_id, v_request.result_revision);
  end if;
  if v_current.revision <> p_expected_revision then
    return jsonb_build_object('status', 'conflict')
      || one_account._version_state(p_dataset_id, v_current.revision);
  end if;
  v_old_roles := one_account._normalise_assignments(v_dataset.catalogs, v_current.assignments);
  if v_roles = v_old_roles and p_restore_revision is null then
    insert into one_account.commit_requests
      (dataset_id, request_id, actor_email, request_hash, result_revision, result_status)
    values (p_dataset_id, p_request_id, p_actor_email, v_request_hash, v_current.revision, 'noop');
    return jsonb_build_object('status', 'noop')
      || one_account._version_state(p_dataset_id, v_current.revision);
  end if;

  v_now := clock_timestamp();
  v_timestamp := to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_next := v_current.revision + 1;
  for v_account, v_team in select key, value from jsonb_each(v_roles) loop
    v_record := v_team;
    v_times := '{}'::jsonb;
    foreach v_role in array array['primary', 'backup', 'sponsor'] loop
      v_field := v_role || 'RmId';
      v_before := coalesce(v_old_roles -> v_account ->> v_field, '');
      v_after := v_team ->> v_field;
      if v_after <> '' then
        if v_before = v_after and jsonb_typeof(v_current.assignments -> v_account -> 'updatedAtByRole' -> v_role) = 'string' then
          v_times := v_times || jsonb_build_object(v_role, v_current.assignments -> v_account -> 'updatedAtByRole' -> v_role);
        else
          v_times := v_times || jsonb_build_object(v_role, v_timestamp);
        end if;
      end if;
    end loop;
    v_record := v_record || jsonb_build_object('updatedAtByRole', v_times);
    v_new_assignments := v_new_assignments || jsonb_build_object(v_account, v_record);
  end loop;

  insert into one_account.versions
    (dataset_id, revision, parent_revision, created_at, actor_email, action, note,
     restored_from_revision, assignments, request_id)
  values (p_dataset_id, v_next, v_current.revision, v_now, p_actor_email,
    case when p_restore_revision is null then 'save' else 'restore' end, v_note,
    p_restore_revision, v_new_assignments, p_request_id);

  for v_account in
    select key from jsonb_object_keys(v_old_roles) as old_keys(key)
    union select key from jsonb_object_keys(v_roles) as new_keys(key)
  loop
    foreach v_role in array array['primary', 'backup', 'sponsor'] loop
      v_field := v_role || 'RmId';
      v_before := nullif(v_old_roles -> v_account ->> v_field, '');
      v_after := nullif(v_roles -> v_account ->> v_field, '');
      if v_before is distinct from v_after then
        insert into one_account.version_changes
          (dataset_id, revision, account_id, account_name, role, before_rm_id, after_rm_id, before_rm_name, after_rm_name)
        values (p_dataset_id, v_next, v_account, v_dataset.catalogs -> 'accounts' ->> v_account,
          v_role, v_before, v_after,
          v_dataset.catalogs -> 'rms' -> v_before ->> 'name',
          v_dataset.catalogs -> 'rms' -> v_after ->> 'name');
      end if;
    end loop;
  end loop;
  update one_account.current_state
  set revision = v_next, assignments = v_new_assignments, updated_at = v_now, actor_email = p_actor_email
  where dataset_id = p_dataset_id;
  insert into one_account.commit_requests
    (dataset_id, request_id, actor_email, request_hash, result_revision, result_status, created_at)
  values (p_dataset_id, p_request_id, p_actor_email, v_request_hash, v_next, 'committed', v_now);
  return jsonb_build_object('status', 'committed') || one_account._version_state(p_dataset_id, v_next);
end;
$$;

create function public.oa_get_history(p_dataset_id text, p_limit integer, p_before_revision bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_versions jsonb;
  v_last bigint;
  v_more boolean;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or (p_before_revision is not null and p_before_revision < 1) then
    raise exception 'Invalid history page' using errcode = '22023';
  end if;
  if not exists (select 1 from one_account.current_state where dataset_id = p_dataset_id) then
    raise exception 'Unknown One Account dataset' using errcode = 'P0002';
  end if;
  with page as (
    select v.* from one_account.versions v
    where v.dataset_id = p_dataset_id and (p_before_revision is null or v.revision < p_before_revision)
    order by v.revision desc limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'revision', p.revision, 'parent_revision', p.parent_revision, 'created_at', p.created_at,
    'actor_email', p.actor_email, 'action', p.action, 'note', p.note,
    'restored_from_revision', p.restored_from_revision,
    'changes', coalesce((select jsonb_agg(jsonb_build_object(
      'account_id', ch.account_id, 'account_name', ch.account_name, 'role', ch.role,
      'before_rm_id', ch.before_rm_id, 'after_rm_id', ch.after_rm_id,
      'before_rm_name', ch.before_rm_name, 'after_rm_name', ch.after_rm_name
    ) order by ch.account_id, ch.role) from one_account.version_changes ch
      where ch.dataset_id = p.dataset_id and ch.revision = p.revision), '[]'::jsonb)
  ) order by p.revision desc), '[]'::jsonb), min(p.revision)
  into v_versions, v_last from page p;
  select exists (select 1 from one_account.versions where dataset_id = p_dataset_id and revision < v_last) into v_more;
  return jsonb_build_object('dataset_id', p_dataset_id, 'versions', v_versions,
    'next_before_revision', case when v_more then v_last else null end);
end;
$$;

revoke all on all functions in schema one_account from public, anon, authenticated, service_role;
revoke all on function public.oa_get_state(text, bigint) from public, anon, authenticated;
revoke all on function public.oa_commit_state(text, bigint, jsonb, text, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.oa_get_history(text, integer, bigint) from public, anon, authenticated;
grant execute on function public.oa_get_state(text, bigint) to service_role;
grant execute on function public.oa_commit_state(text, bigint, jsonb, text, uuid, text, bigint) to service_role;
grant execute on function public.oa_get_history(text, integer, bigint) to service_role;

notify pgrst, 'reload schema';
commit;
