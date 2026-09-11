-- Synthetic fixtures only. This transaction is always rolled back.
begin;
insert into one_account.datasets
  (dataset_id, snapshot_id, baseline_sha256, baseline_assignments, catalogs)
values ('oa-regression-fixture', 'synthetic-fixture', repeat('a', 64),
  '{"A":{"primaryRmId":"R1","backupRmId":"R2","sponsorRmId":"R4","updatedAtByRole":{"primary":"2026-01-01T00:00:00.000Z","backup":"2026-01-01T00:00:00.000Z","sponsor":"2026-01-01T00:00:00.000Z"}}}'::jsonb,
  '{"accounts":{"A":"Synthetic Account A","B":"Synthetic Account B"},"rms":{"R1":{"name":"Synthetic RM1","roles":["primary","backup"]},"R2":{"name":"Synthetic RM2","roles":["primary","backup"]},"R3":{"name":"Synthetic RM3","roles":["backup"]},"R4":{"name":"Synthetic RM4","roles":["sponsor"]}}}'::jsonb);
insert into one_account.versions (dataset_id, revision, actor_email, action, assignments)
select dataset_id, 1, 'sjlee@igisam.com', 'baseline', baseline_assignments
from one_account.datasets where dataset_id = 'oa-regression-fixture';
insert into one_account.current_state (dataset_id, revision, assignments, updated_at, actor_email)
select dataset_id, revision, assignments, created_at, actor_email
from one_account.versions where dataset_id = 'oa-regression-fixture';

do $$
declare
  v_result jsonb;
  v_saved jsonb;
  v_baseline jsonb;
  v_payload jsonb := '{"A":{"primaryRmId":"R2","backupRmId":"R1","sponsorRmId":"R4","updatedAtByRole":{"primary":"FORGED","backup":"FORGED","sponsor":"FORGED"}}}';
  v_catalogs jsonb;
  v_rejected boolean;
  v_count integer;
begin
  v_baseline := public.oa_get_state('oa-regression-fixture');
  if (v_baseline ->> 'revision')::bigint <> 1 then raise exception 'initial revision'; end if;
  select catalogs into v_catalogs from one_account.datasets where dataset_id = 'oa-regression-fixture';

  v_rejected := false;
  begin
    perform one_account._normalise_assignments(v_catalogs,
      '{"X":{"primaryRmId":"R1","backupRmId":"","sponsorRmId":""}}');
  exception when sqlstate '22023' then v_rejected := true; end;
  if not v_rejected then raise exception 'unknown account accepted'; end if;
  v_rejected := false;
  begin
    perform one_account._normalise_assignments(v_catalogs,
      '{"A":{"primaryRmId":"R3","backupRmId":"","sponsorRmId":""}}');
  exception when sqlstate '22023' then v_rejected := true; end;
  if not v_rejected then raise exception 'wrong role cohort accepted'; end if;
  v_rejected := false;
  begin
    perform one_account._normalise_assignments(v_catalogs,
      '{"A":{"primaryRmId":"R1","backupRmId":"R1","sponsorRmId":""}}');
  exception when sqlstate '22023' then v_rejected := true; end;
  if not v_rejected then raise exception 'duplicate person accepted'; end if;
  v_rejected := false;
  begin
    perform one_account._normalise_assignments(v_catalogs,
      '{"A":{"primaryRmId":"R1","backupRmId":"","sponsorRmId":"","extra":true}}');
  exception when sqlstate '22023' then v_rejected := true; end;
  if not v_rejected then raise exception 'unknown field accepted'; end if;
  v_rejected := false;
  begin
    perform one_account._normalise_assignments(v_catalogs,
      '{"A":{"primaryRmId":null,"backupRmId":"","sponsorRmId":""}}');
  exception when sqlstate '22023' then v_rejected := true; end;
  if not v_rejected then raise exception 'null role accepted'; end if;
  v_rejected := false;
  begin
    perform public.oa_commit_state('oa-regression-fixture', 1, v_payload,
      'attacker@igisam.com.evil', '00000000-0000-4000-8000-000000000099', '', null);
  exception when sqlstate '22023' then v_rejected := true; end;
  if not v_rejected then raise exception 'wrong company domain accepted'; end if;

  v_result := public.oa_commit_state('oa-regression-fixture', 1, v_payload,
    'sjlee@igisam.com', '00000000-0000-4000-8000-000000000001', 'Synthetic swap', null);
  if v_result ->> 'status' <> 'committed' or (v_result ->> 'revision')::bigint <> 2
    or (v_result ->> 'current_revision')::bigint <> 2 then raise exception 'commit result'; end if;
  v_saved := v_result -> 'assignments';
  if v_saved #>> '{A,updatedAtByRole,primary}' = 'FORGED'
     or v_saved #>> '{A,updatedAtByRole,backup}' = 'FORGED'
     or v_saved #>> '{A,updatedAtByRole,sponsor}' <> '2026-01-01T00:00:00.000Z' then
    raise exception 'server role timestamps';
  end if;
  select count(*) into v_count from one_account.version_changes
  where dataset_id = 'oa-regression-fixture' and revision = 2;
  if v_count <> 2 then raise exception 'exact role changes'; end if;

  v_result := public.oa_commit_state('oa-regression-fixture', 1, v_payload,
    'sjlee@igisam.com', '00000000-0000-4000-8000-000000000001', 'Synthetic swap', null);
  if v_result ->> 'status' <> 'replayed' or (v_result ->> 'revision')::bigint <> 2 then raise exception 'committed retry'; end if;
  v_rejected := false;
  begin
    perform public.oa_commit_state('oa-regression-fixture', 1, v_payload,
      'other@igisam.com', '00000000-0000-4000-8000-000000000001', 'Synthetic swap', null);
  exception when sqlstate '22023' then v_rejected := true; end;
  if not v_rejected then raise exception 'idempotency actor mismatch'; end if;
  v_rejected := false;
  begin
    perform public.oa_commit_state('oa-regression-fixture', 1, '{}'::jsonb,
      'sjlee@igisam.com', '00000000-0000-4000-8000-000000000001', 'Synthetic swap', null);
  exception when sqlstate '22023' then v_rejected := true; end;
  if not v_rejected then raise exception 'idempotency payload mismatch'; end if;

  v_result := public.oa_commit_state('oa-regression-fixture', 1, '{}'::jsonb,
    'other@igisam.com', '00000000-0000-4000-8000-000000000002', 'Stale save', null);
  if v_result ->> 'status' <> 'conflict' or (v_result ->> 'revision')::bigint <> 2 then raise exception 'stale conflict'; end if;
  if exists (select 1 from one_account.commit_requests where dataset_id = 'oa-regression-fixture'
    and request_id = '00000000-0000-4000-8000-000000000002') then raise exception 'conflict incorrectly accepted'; end if;

  v_result := public.oa_commit_state('oa-regression-fixture', 2, v_payload,
    'sjlee@igisam.com', '00000000-0000-4000-8000-000000000003', 'No-op', null);
  if v_result ->> 'status' <> 'noop' or (v_result ->> 'revision')::bigint <> 2
    or v_result -> 'assignments' <> v_saved then raise exception 'timestamp-only save created changes'; end if;

  v_result := public.oa_commit_state('oa-regression-fixture', 2, '{}'::jsonb,
    'other@igisam.com', '00000000-0000-4000-8000-000000000004', 'Clear roles', null);
  if (v_result ->> 'revision')::bigint <> 3 or v_result -> 'assignments' <> '{}'::jsonb then raise exception 'role clear'; end if;
  select count(*) into v_count from one_account.version_changes
  where dataset_id = 'oa-regression-fixture' and revision = 3 and before_rm_id is not null and after_rm_id is null;
  if v_count <> 3 then raise exception 'clear changes'; end if;

  v_result := public.oa_commit_state('oa-regression-fixture', 2, v_payload,
    'sjlee@igisam.com', '00000000-0000-4000-8000-000000000003', 'No-op', null);
  if v_result ->> 'status' <> 'replayed' or v_result ->> 'original_status' <> 'noop'
    or (v_result ->> 'revision')::bigint <> 2 or (v_result ->> 'current_revision')::bigint <> 3 then raise exception 'no-op retry after another save'; end if;
  v_result := public.oa_get_state('oa-regression-fixture', 1);
  if v_result -> 'assignments' <> v_baseline -> 'assignments'
    or (v_result ->> 'current_revision')::bigint <> 3 then raise exception 'historical preview'; end if;

  v_result := public.oa_commit_state('oa-regression-fixture', 3, null,
    'sjlee@igisam.com', '00000000-0000-4000-8000-000000000005', 'Restore baseline', 1);
  if (v_result ->> 'revision')::bigint <> 4 or v_result #>> '{assignments,A,primaryRmId}' <> 'R1'
    or v_result #>> '{assignments,A,updatedAtByRole,primary}' = '2026-01-01T00:00:00.000Z' then raise exception 'restore new revision'; end if;
  v_result := public.oa_commit_state('oa-regression-fixture', 4, null,
    'sjlee@igisam.com', '00000000-0000-4000-8000-000000000006', 'Same content restore', 4);
  if v_result ->> 'status' <> 'committed' or (v_result ->> 'revision')::bigint <> 5 then raise exception 'same-content restore must append'; end if;

  v_result := public.oa_get_history('oa-regression-fixture', 2);
  if jsonb_array_length(v_result -> 'versions') <> 2
    or (v_result #>> '{versions,0,revision}')::bigint <> 5
    or (v_result ->> 'next_before_revision')::bigint <> 4
    or v_result #>> '{versions,1,changes,0,account_name}' <> 'Synthetic Account A' then raise exception 'history first page'; end if;
  v_result := public.oa_get_history('oa-regression-fixture', 100, 4);
  if jsonb_array_length(v_result -> 'versions') <> 3 or v_result ->> 'next_before_revision' is not null then raise exception 'history final page'; end if;

  v_rejected := false;
  begin
    update one_account.versions set note = 'overwrite' where dataset_id = 'oa-regression-fixture' and revision = 1;
  exception when sqlstate '55000' then v_rejected := true; end;
  if not v_rejected then raise exception 'history update allowed'; end if;
  v_rejected := false;
  begin
    delete from one_account.version_changes where dataset_id = 'oa-regression-fixture' and revision = 2;
  exception when sqlstate '55000' then v_rejected := true; end;
  if not v_rejected then raise exception 'history delete allowed'; end if;

  if has_schema_privilege('anon', 'one_account', 'USAGE')
     or has_schema_privilege('authenticated', 'one_account', 'USAGE')
     or has_table_privilege('service_role', 'one_account.current_state', 'SELECT')
     or has_function_privilege('anon', 'public.oa_get_state(text,bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.oa_commit_state(text,bigint,jsonb,text,uuid,text,bigint)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.oa_get_history(text,integer,bigint)', 'EXECUTE') then
    raise exception 'RPC privilege boundary';
  end if;
end;
$$;

-- Test the actual SECURITY DEFINER route as the runtime role.
set local role service_role;
do $$
declare v_result jsonb;
begin
  v_result := public.oa_get_state('oa-regression-fixture');
  if (v_result ->> 'revision')::bigint <> 5 then raise exception 'service role RPC'; end if;
end;
$$;
reset role;
rollback;
