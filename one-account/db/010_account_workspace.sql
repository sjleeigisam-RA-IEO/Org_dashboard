-- Account-scoped workspace. Apply after 009; contains no customer fixtures.
begin;
alter table one_account.crm_accounts add column notes text not null default '' check(length(notes)<=10000);
alter table one_account.crm_accounts add column profile_revision bigint not null default 0 check(profile_revision>=0);
alter table one_account.crm_identity_access_audit drop constraint crm_identity_access_audit_action_check;
alter table one_account.crm_identity_access_audit add constraint crm_identity_access_audit_action_check check(action in ('person_read','account_read','commit'));

create table one_account.account_team_requests (
  dataset_id text not null references one_account.datasets, request_id uuid not null,
  actor_email text not null, request_hash text not null, result jsonb not null,
  created_at timestamptz not null default clock_timestamp(), primary key(dataset_id,request_id)
);
-- One verified command may create both a person and their first affiliation.
-- Every audit row keeps the proof that authorized the original mutation.
create table one_account.account_workspace_verifications (
  audit_id bigint primary key references one_account.crm_audit,
  request_id uuid not null references one_account.crm_commit_requests,
  proof_digest text not null references one_account.crm_identity_proofs,
  actor_email text not null, verified_at timestamptz not null,
  auth_method text not null check(auth_method='email_otp'),
  created_at timestamptz not null default clock_timestamp()
);
do $$ declare t text; begin
  foreach t in array array['account_team_requests','account_workspace_verifications'] loop
    execute format('alter table one_account.%I enable row level security',t);
    execute format('revoke all on table one_account.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger immutable before update or delete on one_account.%I for each row execute function one_account._reject_history_mutation()',t);
  end loop;
end $$;

-- Preserve immutable baseline names; current CRM names win in live labels only.
create or replace function one_account._effective_catalogs(p_dataset_id text,p_catalogs jsonb)
returns jsonb language sql stable set search_path='' as $$
  select case when p_dataset_id='rm-v1.7' then jsonb_set(p_catalogs,'{accounts}',
    (p_catalogs->'accounts') || coalesce((select jsonb_object_agg(account_id,name)
      from one_account.crm_accounts),'{}'::jsonb)) else p_catalogs end;
$$;

create function one_account._account_team_view(p_dataset_id text,p_account_id text)
returns jsonb language plpgsql stable set search_path='' as $$
declare s one_account.current_state; catalogs jsonb; team jsonb; history jsonb; account_revision bigint;
begin
  select * into s from one_account.current_state where dataset_id=p_dataset_id;
  if not found then raise exception 'Unknown dataset' using errcode='P0002'; end if;
  select one_account._effective_catalogs(p_dataset_id,d.catalogs) into catalogs from one_account.datasets d where dataset_id=p_dataset_id;
  if not (catalogs->'accounts') ? p_account_id then raise exception 'Unknown account' using errcode='P0002'; end if;
  -- A removed/fully cleared team still has a revision. Existing global saves
  -- and restores write version_changes, so both APIs share the same clock.
  select coalesce(max(revision),1) into account_revision from one_account.version_changes
    where dataset_id=p_dataset_id and account_id=p_account_id;
  team:='{"primaryRmId":"","backupRmId":"","sponsorRmId":"","updatedAtByRole":{}}'::jsonb
    || coalesce(s.assignments->p_account_id,'{}'::jsonb);
  select coalesce(jsonb_agg(jsonb_build_object('revision',v.revision,'createdAt',v.created_at,
    'actorEmail',v.actor_email,'action',v.action,'note',v.note,'changes',
    (select jsonb_agg(jsonb_build_object('role',c.role,'beforeRmId',c.before_rm_id,'afterRmId',c.after_rm_id) order by c.role)
      from one_account.version_changes c where c.dataset_id=p_dataset_id and c.revision=v.revision and c.account_id=p_account_id)
  ) order by v.revision desc),'[]'::jsonb) into history from (
    select v.* from one_account.versions v where v.dataset_id=p_dataset_id and exists(
      select 1 from one_account.version_changes c where c.dataset_id=v.dataset_id and c.revision=v.revision and c.account_id=p_account_id)
    order by revision desc limit 30) v;
  return jsonb_build_object('accountId',p_account_id,'accountRevision',account_revision,'currentRevision',s.revision,
    'team',team,'history',history,'candidates',(select coalesce(jsonb_agg(jsonb_build_object(
      'rmId',r.key,'name',r.value->>'name','roles',r.value->'roles') order by r.value->>'name',r.key),'[]'::jsonb)
      from jsonb_each(catalogs->'rms') r));
end $$;

create function one_account._account_metadata(p_account_id text)
returns jsonb language plpgsql stable set search_path='' as $$
declare a one_account.crm_accounts; history jsonb;
begin
  select * into a from one_account.crm_accounts where account_id=p_account_id;
  if not found then raise exception 'Unknown account' using errcode='P0002'; end if;
  -- Account scope is typed; no before/after record, note or personal value
  -- escapes through the unauthenticated-to-mailbox metadata history.
  with scope(entity_type,entity_id) as (
    select 'account',p_account_id
    union select 'affiliation',affiliation_id from one_account.crm_affiliations where account_id=p_account_id
    union select 'person',person_id from one_account.crm_affiliations where account_id=p_account_id
    union select 'contact_point',c.contact_point_id from one_account.crm_contact_points c
      join one_account.crm_affiliations f on f.affiliation_id=c.affiliation_id where f.account_id=p_account_id
    union select 'preference',c.preference_id from one_account.crm_receiving_preferences c
      join one_account.crm_affiliations f on f.affiliation_id=c.affiliation_id where f.account_id=p_account_id
    union select 'gift_recipient',c.recipient_id from one_account.crm_gift_recipients c
      join one_account.crm_affiliations f on f.affiliation_id=c.affiliation_id where f.account_id=p_account_id
    union select 'life_event',c.event_id from one_account.crm_life_events c
      join one_account.crm_affiliations f on f.affiliation_id=c.affiliation_id where f.account_id=p_account_id
  ), selected as (
    select x.* from one_account.crm_audit x join scope s using(entity_type,entity_id)
      order by created_at desc,audit_id desc limit 50
  ) select coalesce(jsonb_agg(jsonb_build_object('auditId',x.audit_id,'revision',x.revision,
    'entityType',x.entity_type,'entityId',x.entity_id,'createdAt',x.created_at,'actorEmail',x.actor_email,'action',x.action,
    'changedFields',(select coalesce(jsonb_agg(k order by k),'[]'::jsonb) from jsonb_object_keys(x.after_record) k
      where k not in ('updated_at','created_at','revision') and x.after_record->k is distinct from x.before_record->k)
  ) order by x.created_at desc,x.audit_id desc),'[]'::jsonb) into history from selected x;
  return jsonb_build_object('account',jsonb_build_object('accountId',a.account_id,'name',a.name,'piscfh',a.piscfh,
    'aliases',(select coalesce(jsonb_agg(case when jsonb_typeof(v)='string' then v else v->'name' end),'[]'::jsonb)
      from jsonb_array_elements(a.aliases) v where jsonb_typeof(v)='string' or jsonb_typeof(v->'name')='string'),
    'notes',a.notes,'profileRevision',a.profile_revision,'revision',a.revision,'isExisting',a.is_existing,'isPlaceholder',a.is_placeholder,'accountKind',a.account_kind),'history',history);
end $$;

create function public.oa_account_read(p_action text,p_account_id text,p_dataset_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_account_id is null or length(p_account_id) not between 1 and 200 then raise exception 'Invalid account' using errcode='22023'; end if;
  if p_action='team' then return jsonb_build_object('status','ok')||one_account._account_team_view(p_dataset_id,p_account_id); end if;
  if p_action='metadata' then
    result:=one_account._account_metadata(p_account_id);
    result:=jsonb_set(result,'{account,notesMasked}',to_jsonb(case when length(btrim(result->'account'->>'notes'))>0 then '*' else '' end));
    result:=jsonb_set(result,'{account,notes}','""'::jsonb);
    return jsonb_build_object('status','ok','privacy',jsonb_build_object('detailAccess','locked','identityVerified',false,'canEdit',false))||result;
  end if;
  raise exception 'Invalid workspace read' using errcode='22023';
end $$;

create function public.oa_account_verified_read(p_account_id text,p_proof_digest text,p_session_binding text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proof one_account.crm_identity_proofs; result jsonb;
begin
  proof:=one_account._crm_require_identity(p_proof_digest,p_session_binding);
  result:=jsonb_build_object('status','ok','privacy',jsonb_build_object('detailAccess','verified','identityVerified',true,'canEdit',true))
    ||one_account._account_metadata(p_account_id);
  insert into one_account.crm_identity_access_audit(proof_digest,actor_email,verified_at,auth_method,action,entity_type,entity_id,result_status)
    values(proof.proof_digest,proof.email,proof.verified_at,proof.auth_method,'account_read','account',p_account_id,'ok');
  return result;
end $$;

create function public.oa_account_save_team(p_dataset_id text,p_account_id text,p_expected_revision bigint,
  p_patch jsonb,p_note text,p_request_id uuid,p_actor_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s one_account.current_state; prior one_account.account_team_requests; digest text;
  before_view jsonb; merged jsonb; team jsonb; result jsonb; committed jsonb;
begin
  if p_account_id is null or length(p_account_id) not between 1 and 200 or p_expected_revision is null or p_expected_revision<1
    or p_request_id is null or p_actor_email is null or length(p_actor_email)>254
    or p_actor_email !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+([.][a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@igisam[.]com$'
    or jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb or octet_length(p_patch::text)>2000
    or length(coalesce(p_note,''))>500 then raise exception 'Invalid team command' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(p_patch) p where p.key not in ('primaryRmId','backupRmId','sponsorRmId')
    or jsonb_typeof(p.value)<>'string' or length(p.value#>>'{}')>200) then raise exception 'Invalid team patch' using errcode='22023'; end if;
  digest:=encode(sha256(convert_to(jsonb_build_object('account',p_account_id,'revision',p_expected_revision,
    'patch',p_patch,'note',coalesce(p_note,''),'actor',p_actor_email)::text,'UTF8')),'hex');
  select * into s from one_account.current_state where dataset_id=p_dataset_id for update;
  if not found then raise exception 'Unknown dataset' using errcode='P0002'; end if;
  -- Check the original command before merging with today's global state.
  select * into prior from one_account.account_team_requests where dataset_id=p_dataset_id and request_id=p_request_id;
  if found then
    if prior.actor_email<>p_actor_email or prior.request_hash<>digest then raise exception 'Request id reuse' using errcode='22023'; end if;
    return prior.result||jsonb_build_object('status','replayed','originalStatus',prior.result->>'status');
  end if;
  before_view:=one_account._account_team_view(p_dataset_id,p_account_id);
  if (before_view->>'accountRevision')::bigint<>p_expected_revision then
    return jsonb_build_object('status','conflict')||before_view;
  end if;
  team:=before_view->'team'||p_patch;
  merged:=s.assignments||jsonb_build_object(p_account_id,team);
  committed:=public.oa_commit_state(p_dataset_id,s.revision,merged,p_actor_email,p_request_id,coalesce(p_note,''),null);
  if committed->>'status' not in ('committed','noop') then raise exception 'Unexpected shared commit result' using errcode='22023'; end if;
  result:=jsonb_build_object('status',committed->>'status')||one_account._account_team_view(p_dataset_id,p_account_id);
  insert into one_account.account_team_requests(dataset_id,request_id,actor_email,request_hash,result)
    values(p_dataset_id,p_request_id,p_actor_email,digest,result);
  return result;
end $$;

create function public.oa_account_verified_commit(p_action text,p_account_id text,p_expected_revision bigint,
  p_patch jsonb,p_request_id uuid,p_proof_digest text,p_session_binding text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proof one_account.crm_identity_proofs; prior one_account.crm_commit_requests;
  old_account one_account.crm_accounts; new_account one_account.crm_accounts;
  person one_account.crm_persons; affiliation one_account.crm_affiliations;
  digest text; result jsonb; person_id text; affiliation_id text; new_aliases jsonb; review jsonb;
  audit_ids bigint[]:=array[]::bigint[]; audit_id bigint; entity_type text; entity_id text;
begin
  proof:=one_account._crm_require_identity(p_proof_digest,p_session_binding);
  if p_action is null or p_action not in ('update-account','create-person') or p_account_id is null
    or length(p_account_id) not between 1 and 200 or p_request_id is null
    or jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb or octet_length(p_patch::text)>60000
    or p_expected_revision is null or (p_action='update-account' and p_expected_revision<1)
    or (p_action='create-person' and p_expected_revision<>0) then raise exception 'Invalid workspace command' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(p_patch) p where jsonb_typeof(p.value)<>'string'
    or p.key<>all(case when p_action='update-account' then array['name','piscfh','notes'] else array['name','department','title'] end)) then
    raise exception 'Unsupported workspace field' using errcode='22023'; end if;
  if (p_patch ? 'name' and (length(btrim(p_patch->>'name'))<1 or length(p_patch->>'name')>case when p_action='create-person' then 200 else 300 end))
    or (p_action='create-person' and not p_patch ? 'name') or length(p_patch->>'notes')>10000
    or length(p_patch->>'department')>1000 or length(p_patch->>'title')>1000
    or (p_patch ? 'piscfh' and p_patch->>'piscfh' not in ('P','I','S','C','F','H','미Account')) then
    raise exception 'Invalid workspace value' using errcode='22023'; end if;
  digest:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'account',p_account_id,
    'revision',p_expected_revision,'patch',p_patch,'actor',proof.email)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into prior from one_account.crm_commit_requests where request_id=p_request_id;
  if found then
    if prior.actor_email<>proof.email or prior.request_hash<>digest then raise exception 'Request id reuse' using errcode='22023'; end if;
    result:=prior.result||jsonb_build_object('status','replayed','originalStatus',prior.result->>'status');
  else
    select * into old_account from one_account.crm_accounts where account_id=p_account_id for update;
    if not found then raise exception 'Unknown account' using errcode='P0002'; end if;
    if p_action='update-account' then
      if old_account.revision<>p_expected_revision then
        result:=jsonb_build_object('status','conflict')||one_account._account_metadata(p_account_id);
      elsif to_jsonb(old_account)||p_patch=to_jsonb(old_account) then
        result:=jsonb_build_object('status','noop')||one_account._account_metadata(p_account_id);
      else
        new_aliases:=old_account.aliases;
        if p_patch ? 'name' and p_patch->>'name'<>old_account.name and not exists(
          select 1 from jsonb_array_elements(new_aliases) x where x=to_jsonb(old_account.name) or x->>'name'=old_account.name) then
          new_aliases:=new_aliases||jsonb_build_array(old_account.name);
        end if;
        review:=old_account.classification_review;
        if p_patch ? 'piscfh' and p_patch->>'piscfh'<>old_account.piscfh then
          review:=jsonb_build_object('rule_version','account-workspace-v1','previous_code',old_account.piscfh,
            'review_required',true,'source_urls','[]'::jsonb,'reason','기관 정보 화면에서 수동 변경','reviewed_at',clock_timestamp());
        end if;
        update one_account.crm_accounts set name=coalesce(p_patch->>'name',name),piscfh=coalesce(p_patch->>'piscfh',piscfh),
          notes=coalesce(p_patch->>'notes',notes),aliases=new_aliases,classification_review=review,
          revision=revision+1,profile_revision=profile_revision+1,updated_at=clock_timestamp() where account_id=p_account_id returning * into new_account;
        insert into one_account.crm_audit(entity_type,entity_id,revision,actor_email,action,before_record,after_record,request_id)
          values('account',p_account_id,new_account.revision,proof.email,'update',to_jsonb(old_account),to_jsonb(new_account),p_request_id)
          returning crm_audit.audit_id into audit_id;
        audit_ids:=array_append(audit_ids,audit_id);
        result:=jsonb_build_object('status','committed')||one_account._account_metadata(p_account_id);
      end if;
    else
      if old_account.account_kind<>'organization' or old_account.is_placeholder then raise exception 'Choose a real employer' using errcode='22023'; end if;
      person_id:='PERSON-'||p_request_id::text; affiliation_id:='AFF-'||p_request_id::text;
      -- Blank source-independent department/title are explicit empty defaults;
      -- unknown status and NULL dates do not imply current employment.
      insert into one_account.crm_persons(person_id,name) values(person_id,p_patch->>'name') returning * into person;
      insert into one_account.crm_affiliations(affiliation_id,person_id,account_id,department,title)
        values(affiliation_id,person_id,p_account_id,coalesce(p_patch->>'department',''),coalesce(p_patch->>'title','')) returning * into affiliation;
      insert into one_account.crm_audit(entity_type,entity_id,revision,actor_email,action,before_record,after_record,request_id)
        values('person',person_id,1,proof.email,'create',null,to_jsonb(person),p_request_id) returning crm_audit.audit_id into audit_id;
      audit_ids:=array_append(audit_ids,audit_id);
      insert into one_account.crm_audit(entity_type,entity_id,revision,actor_email,action,before_record,after_record,request_id)
        values('affiliation',affiliation_id,1,proof.email,'create',null,to_jsonb(affiliation),p_request_id) returning crm_audit.audit_id into audit_id;
      audit_ids:=array_append(audit_ids,audit_id);
      result:=jsonb_build_object('status','committed','accountId',p_account_id,'personId',person_id,'affiliationId',affiliation_id,'person',to_jsonb(person),'affiliation',to_jsonb(affiliation));
    end if;
    if result->>'status' in ('committed','noop') then
      insert into one_account.crm_commit_requests(request_id,actor_email,request_hash,result) values(p_request_id,proof.email,digest,result);
      foreach audit_id in array audit_ids loop
        insert into one_account.account_workspace_verifications(audit_id,request_id,proof_digest,actor_email,verified_at,auth_method)
          values(audit_id,p_request_id,proof.proof_digest,proof.email,proof.verified_at,proof.auth_method);
      end loop;
    end if;
  end if;
  entity_type:=case when p_action='update-account' then 'account' else 'person' end;
  entity_id:=case when p_action='update-account' then p_account_id else result->>'personId' end;
  insert into one_account.crm_identity_access_audit(proof_digest,actor_email,verified_at,auth_method,action,entity_type,entity_id,request_id,result_status)
    values(proof.proof_digest,proof.email,proof.verified_at,proof.auth_method,'commit',entity_type,entity_id,p_request_id,result->>'status');
  return result||jsonb_build_object('privacy',jsonb_build_object('detailAccess','verified','identityVerified',true,'canEdit',true));
end $$;

-- Existing verified person history also displays provenance for both rows of
-- atomic workspace creation. Legacy mutation proofs remain unchanged.
do $$ declare body text; needle text:='left join one_account.crm_commit_verifications v on v.audit_id=a.audit_id'; begin
  body:=pg_get_functiondef('public.oa_crm_verified_read(text,text,text,integer,text,text)'::regprocedure);
  if position(needle in body)=0 then raise exception 'Unexpected verified CRM read definition'; end if;
  body:=replace(body,needle,'left join (select audit_id,request_id,actor_email,verified_at,auth_method from one_account.crm_commit_verifications union all select audit_id,request_id,actor_email,verified_at,auth_method from one_account.account_workspace_verifications) v on v.audit_id=a.audit_id');
  execute body;
end $$;
revoke all on function one_account._account_team_view(text,text) from public,anon,authenticated,service_role;
revoke all on function one_account._account_metadata(text) from public,anon,authenticated,service_role;
revoke all on function public.oa_account_read(text,text,text) from public,anon,authenticated;
revoke all on function public.oa_account_verified_read(text,text,text) from public,anon,authenticated;
revoke all on function public.oa_account_save_team(text,text,bigint,jsonb,text,uuid,text) from public,anon,authenticated;
revoke all on function public.oa_account_verified_commit(text,text,bigint,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.oa_account_read(text,text,text) to service_role;
grant execute on function public.oa_account_verified_read(text,text,text) to service_role;
grant execute on function public.oa_account_save_team(text,text,bigint,jsonb,text,uuid,text) to service_role;
grant execute on function public.oa_account_verified_commit(text,text,bigint,jsonb,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
