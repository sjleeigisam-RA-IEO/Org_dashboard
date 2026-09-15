-- Synthetic fixtures only. Owner execution after 010, always ROLLBACK.
-- To test unapplied 010, concatenate the interiors into ONE BEGIN/ROLLBACK.
begin;
do $$
declare
  r jsonb; first_result jsonb; second_result jsonb; cleared jsonb; saved jsonb;
  failed boolean; n bigint; before_sources bigint; before_claims bigint; original_states jsonb;
  ds text:='workspace-fixture'; a text:='workspace-fixture-a'; b text:='workspace-fixture-b';
  email text:='workspace-fixture@igisam.com'; proof text:=repeat('7',64); binding text:=repeat('8',64);
  rid uuid:='a1000000-0000-4000-8000-000000000001';
  create_rid uuid:='a1000000-0000-4000-8000-000000000030';
  cid uuid:='a1000000-0000-4000-8000-000000000020';
begin
  if exists(select 1 from one_account.datasets where dataset_id=ds)
    or exists(select 1 from one_account.crm_accounts where account_id in(a,b))
    or exists(select 1 from one_account.crm_identity_proofs where proof_digest=proof) then raise exception 'Workspace fixture collision'; end if;
  select count(*) into before_sources from one_account.crm_source_records;
  select count(*) into before_claims from one_account.crm_field_claims;
  select coalesce(jsonb_agg(to_jsonb(s) order by dataset_id),'[]'::jsonb) into original_states from one_account.current_state s;
  insert into one_account.datasets(dataset_id,snapshot_id,baseline_sha256,baseline_assignments,catalogs)
    values(ds,'synthetic',repeat('0',64),'{}',jsonb_build_object('accounts',jsonb_build_object(a,'Synthetic A',b,'Synthetic B'),
      'rms','{"r1":{"name":"Synthetic One","roles":["primary","backup"]},"r2":{"name":"Synthetic Two","roles":["primary","backup"]},"r3":{"name":"Synthetic Three","roles":["sponsor"]}}'::jsonb));
  insert into one_account.versions(dataset_id,revision,parent_revision,actor_email,action,assignments) values(ds,1,null,email,'baseline','{}');
  insert into one_account.current_state(dataset_id,revision,assignments,updated_at,actor_email) values(ds,1,'{}',clock_timestamp(),email);
  insert into one_account.crm_accounts(account_id,name,piscfh,is_existing,notes) values(a,'Synthetic A','C',true,'Synthetic private note'),(b,'Synthetic B','C',false,'');
  r:=public.oa_account_read('team',a,ds);
  if r->>'accountRevision'<>'1' or r->'team'->>'primaryRmId'<>'' or jsonb_array_length(r->'candidates')<>3 then raise exception 'Empty team contract failed'; end if;
  first_result:=public.oa_account_save_team(ds,a,1,'{"primaryRmId":"r1"}','Synthetic save',rid,email);
  if first_result->>'status'<>'committed' or first_result->>'accountRevision'<>'2' then raise exception 'First team save failed'; end if;
  second_result:=public.oa_account_save_team(ds,b,1,'{"primaryRmId":"r2"}','','a1000000-0000-4000-8000-000000000002',email);
  if second_result->>'status'<>'committed' or second_result->>'currentRevision'<>'3' then raise exception 'Independent account could not save'; end if;
  r:=public.oa_account_save_team(ds,a,1,'{"primaryRmId":"r1"}','Synthetic save',rid,email);
  if r->>'status'<>'replayed' or r-'status'-'originalStatus'<>first_result-'status' then raise exception 'Replay changed after another account save'; end if;
  r:=public.oa_account_save_team(ds,a,1,'{"backupRmId":"r2"}','','a1000000-0000-4000-8000-000000000003',email);
  if r->>'status'<>'conflict' or r->>'accountRevision'<>'2' then raise exception 'Stale same-account edit did not conflict'; end if;
  r:=public.oa_account_save_team(ds,a,2,'{"backupRmId":"r2"}','','a1000000-0000-4000-8000-000000000004',email);
  if r->>'status'<>'committed' or r->>'accountRevision'<>'4' or r->'team'->>'primaryRmId'<>'r1'
    or r->'team'->'updatedAtByRole'->>'primary'<>first_result->'team'->'updatedAtByRole'->>'primary'
    or (select assignments->b->>'primaryRmId' from one_account.current_state where dataset_id=ds)<>'r2' then raise exception 'Patch lost current assignments or unchanged timestamp'; end if;
  foreach saved in array array['{"primaryRmId":"r2"}'::jsonb,'{"primaryRmId":"r3"}'::jsonb,'{"sponsorRmId":"unknown"}'::jsonb,'{"updatedAtByRole":{}}'::jsonb] loop
    failed:=false;
    begin perform public.oa_account_save_team(ds,a,4,saved,'','a1000000-0000-4000-8000-000000000005',email); exception when sqlstate '22023' then failed:=true; end;
    if not failed then raise exception 'Invalid duplicate, role, candidate or timestamp accepted'; end if;
  end loop;
  failed:=false;
  begin perform public.oa_account_save_team(ds,b,1,'{"primaryRmId":"r1"}','Synthetic save',rid,email); exception when sqlstate '22023' then failed:=true; end;
  if not failed then raise exception 'Request id changed account'; end if;
  cleared:=public.oa_account_save_team(ds,a,4,'{"primaryRmId":"","backupRmId":"","sponsorRmId":""}','','a1000000-0000-4000-8000-000000000006',email);
  if cleared->>'accountRevision'<>'5' or cleared->'team'->>'primaryRmId'<>'' or (select assignments ? a from one_account.current_state where dataset_id=ds) then raise exception 'Full clear lost account revision'; end if;
  r:=public.oa_commit_state(ds,5,null,email,'a1000000-0000-4000-8000-000000000007','Synthetic restore',1);
  if r->>'status'<>'committed' then raise exception 'Global restore failed'; end if;
  r:=public.oa_account_read('team',b,ds);
  if r->>'accountRevision'<>'6' or r->'team'->>'primaryRmId'<>'' then raise exception 'Global restore not reflected in account revision'; end if;
  r:=public.oa_commit_state(ds,6,jsonb_build_object(a,'{"primaryRmId":"","backupRmId":"","sponsorRmId":"r3"}'::jsonb),email,'a1000000-0000-4000-8000-000000000008','Synthetic global save',null);
  r:=public.oa_account_save_team(ds,a,5,'{"primaryRmId":"r1"}','','a1000000-0000-4000-8000-000000000009',email);
  if r->>'status'<>'conflict' or r->>'accountRevision'<>'7' then raise exception 'Global save bypassed account conflict'; end if;
  first_result:=public.oa_account_save_team(ds,a,7,'{"sponsorRmId":"r3"}','','a1000000-0000-4000-8000-000000000010',email);
  if first_result->>'status'<>'noop' then raise exception 'No-op created a revision'; end if;
  perform public.oa_account_save_team(ds,b,6,'{"primaryRmId":"r1"}','','a1000000-0000-4000-8000-000000000011',email);
  r:=public.oa_account_save_team(ds,a,7,'{"sponsorRmId":"r3"}','','a1000000-0000-4000-8000-000000000010',email);
  if r->>'status'<>'replayed' or r->>'originalStatus'<>'noop' or r->>'currentRevision'<>first_result->>'currentRevision' then raise exception 'No-op replay drifted'; end if;

  r:=public.oa_account_read('metadata',a,ds);
  if r->'account'->>'notes'<>'' or r->'account'->>'notesMasked'<>'*' or r->'privacy'->>'identityVerified'<>'false' then raise exception 'Locked metadata exposed notes'; end if;
  failed:=false;
  begin perform public.oa_account_verified_commit('update-account',a,1,'{"name":"Forbidden"}',cid,proof,binding); exception when sqlstate '42501' then failed:=true; end;
  if not failed then raise exception 'Missing proof accepted'; end if;
  -- Synthetic DB proof fixture; policy change exists only inside this rollback.
  update one_account.crm_identity_policy set mode='all_verified' where singleton;
  insert into one_account.crm_identity_challenges(challenge_id,email,session_binding,ip_digest,code_digest,parent_expires_at,status,expires_at,sent_at,completed_at)
    values(cid,email,binding,repeat('9',64),repeat('a',64),clock_timestamp()+interval '2 hours','consumed',clock_timestamp()+interval '5 minutes',clock_timestamp(),clock_timestamp());
  insert into one_account.crm_identity_proofs(proof_digest,challenge_id,email,session_binding,expires_at,parent_expires_at)
    values(proof,cid,email,binding,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours');
  r:=public.oa_account_verified_read(a,proof,binding);
  if r->'account'->>'notes'<>'Synthetic private note' or r->'privacy'->>'identityVerified'<>'true' then raise exception 'Verified note missing'; end if;
  first_result:=public.oa_account_verified_commit('update-account',a,1,'{"name":"Renamed Synthetic A","piscfh":"I"}','a1000000-0000-4000-8000-000000000021',proof,binding);
  if first_result->>'status'<>'committed' or first_result->'account'->>'revision'<>'2'
    or first_result->'account'->>'profileRevision'<>'1' or not first_result->'account'->'aliases' ? 'Synthetic A'
    or first_result->'account'->>'isExisting'<>'true'
    or (select classification_review->>'rule_version' from one_account.crm_accounts where account_id=a)<>'account-workspace-v1' then raise exception 'Metadata identity/source/review preservation failed'; end if;
  r:=public.oa_account_verified_commit('update-account',a,1,'{"name":"Stale"}','a1000000-0000-4000-8000-000000000022',proof,binding);
  if r->>'status'<>'conflict' or r->'account'->>'name'<>'Renamed Synthetic A' then raise exception 'Metadata stale edit not rejected'; end if;
  perform public.oa_account_verified_commit('update-account',a,2,'{"notes":"Second synthetic note"}','a1000000-0000-4000-8000-000000000023',proof,binding);
  r:=public.oa_account_verified_commit('update-account',a,1,'{"name":"Renamed Synthetic A","piscfh":"I"}','a1000000-0000-4000-8000-000000000021',proof,binding);
  if r->>'status'<>'replayed' or r-'status'-'originalStatus'<>first_result-'status' then raise exception 'Metadata replay changed'; end if;
  failed:=false;
  begin perform public.oa_account_verified_commit('update-account',a,3,'{"is_existing":false}','a1000000-0000-4000-8000-000000000024',proof,binding); exception when sqlstate '22023' then failed:=true; end;
  if not failed then raise exception 'Source identity changed'; end if;
  first_result:=public.oa_account_verified_commit('create-person',a,0,'{"name":"Synthetic New Person"}',create_rid,proof,binding);
  if first_result->>'status'<>'committed' or first_result->'affiliation'->>'employment_status'<>'unknown'
    or first_result->'affiliation'->'started_on'<>'null'::jsonb or first_result->'affiliation'->>'department'<>''
    or first_result->'person'->>'identity_status'<>'unverified' then raise exception 'New person inferred unrecorded facts'; end if;
  r:=public.oa_account_verified_commit('create-person',a,0,'{"name":"Synthetic New Person"}',create_rid,proof,binding);
  if r->>'status'<>'replayed' or r->>'personId'<>first_result->>'personId' then raise exception 'Person retry duplicated identity'; end if;
  select count(*) into n from one_account.crm_audit where request_id=create_rid;
  if n<>2 or (select count(*) from one_account.account_workspace_verifications where request_id=create_rid)<>2 then raise exception 'Atomic person audit/proof incomplete'; end if;
  r:=public.oa_crm_verified_read('person',first_result->>'personId',null,100,proof,binding);
  if exists(select 1 from jsonb_array_elements(r->'audit') x where x->>'entity_type' in ('person','affiliation') and x->'verification'='null'::jsonb) then raise exception 'Person detail lost workspace proof provenance'; end if;
  r:=public.oa_account_read('metadata',a,ds);
  if exists(select 1 from jsonb_array_elements(r->'history') x where x ?| array['before_record','after_record','notes','person','affiliation'])
    or r::text like '%Synthetic New Person%' or r::text like '%Second synthetic note%' then raise exception 'Metadata history leaked private payload'; end if;
  -- Force affiliation insertion to fail after person INSERT. The function call's
  -- subtransaction must remove that person and every command/audit record.
  insert into one_account.crm_affiliations(affiliation_id,person_id,account_id)
    values('AFF-a1000000-0000-4000-8000-000000000031',first_result->>'personId',a);
  failed:=false;
  begin perform public.oa_account_verified_commit('create-person',a,0,'{"name":"Must Roll Back"}','a1000000-0000-4000-8000-000000000031',proof,binding); exception when unique_violation then failed:=true; end;
  if not failed or exists(select 1 from one_account.crm_persons where person_id='PERSON-a1000000-0000-4000-8000-000000000031')
    or exists(select 1 from one_account.crm_commit_requests where request_id='a1000000-0000-4000-8000-000000000031') then raise exception 'Partial person create persisted'; end if;
  update one_account.crm_identity_proofs set revoked_at=clock_timestamp() where proof_digest=proof;
  failed:=false;
  begin perform public.oa_account_verified_commit('create-person',a,0,'{"name":"Synthetic New Person"}',create_rid,proof,binding); exception when sqlstate '42501' then failed:=true; end;
  if not failed then raise exception 'Revoked proof replay accepted'; end if;
  if has_table_privilege('service_role','one_account.account_team_requests','SELECT')
    or has_table_privilege('service_role','one_account.account_workspace_verifications','SELECT')
    or has_function_privilege('anon','public.oa_account_read(text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','public.oa_account_save_team(text,text,bigint,jsonb,text,uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.oa_account_verified_commit(text,text,bigint,jsonb,uuid,text,text)','EXECUTE') then raise exception 'Workspace privileges widened'; end if;
  if (select count(*) from one_account.crm_source_records)<>before_sources or (select count(*) from one_account.crm_field_claims)<>before_claims
    or (select coalesce(jsonb_agg(to_jsonb(s) order by dataset_id),'[]'::jsonb) from one_account.current_state s where dataset_id<>ds)<>original_states then raise exception 'Existing source claims or RM states changed'; end if;
end $$;
select 'WORKSPACE_REGRESSION_PASS' as result;
rollback;
