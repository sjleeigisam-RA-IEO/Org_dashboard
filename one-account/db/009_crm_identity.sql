-- Mailbox verification for CRM detail access and mutations. No credentials or
-- customer fixtures belong here. Apply after 008; policy starts DISABLED.
begin;

create table one_account.crm_identity_policy (
  singleton boolean primary key default true check(singleton),
  mode text not null default 'disabled' check(mode in ('disabled','all_verified','allowlist')),
  updated_at timestamptz not null default clock_timestamp()
);
insert into one_account.crm_identity_policy(singleton) values(true);
create table one_account.crm_identity_allowlist (
  email text primary key check(length(email)<=254 and email ~ '^[a-z0-9._%+-]+@igisam[.]com$'),
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp()
);
create table one_account.crm_identity_challenges (
  challenge_id uuid primary key,
  email text not null check(length(email)<=254 and email ~ '^[a-z0-9._%+-]+@igisam[.]com$'),
  session_binding text not null check(session_binding ~ '^[a-f0-9]{64}$'),
  ip_digest text not null check(ip_digest ~ '^[a-f0-9]{64}$'),
  code_digest text not null check(code_digest ~ '^[a-f0-9]{64}$'),
  parent_expires_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','sent','cancelled','consumed','locked','expired')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  sent_at timestamptz, completed_at timestamptz,
  check(expires_at>created_at and expires_at<=created_at+interval '10 minutes' and expires_at<=parent_expires_at),
  check(status not in ('sent','consumed') or sent_at is not null),
  check(status<>'locked' or attempts=5)
);
create index crm_identity_challenge_email_time on one_account.crm_identity_challenges(email,created_at);
create index crm_identity_challenge_binding_time on one_account.crm_identity_challenges(session_binding,created_at);
create index crm_identity_challenge_ip_time on one_account.crm_identity_challenges(ip_digest,created_at);
create table one_account.crm_identity_proofs (
  proof_digest text primary key check(proof_digest ~ '^[a-f0-9]{64}$'),
  challenge_id uuid not null unique references one_account.crm_identity_challenges,
  email text not null check(length(email)<=254 and email ~ '^[a-z0-9._%+-]+@igisam[.]com$'),
  session_binding text not null check(session_binding ~ '^[a-f0-9]{64}$'),
  auth_method text not null default 'email_otp' check(auth_method='email_otp'),
  verified_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null, parent_expires_at timestamptz not null, revoked_at timestamptz,
  check(expires_at>verified_at and expires_at<=verified_at+interval '8 hours' and expires_at<=parent_expires_at)
);
create index crm_identity_proof_binding on one_account.crm_identity_proofs(session_binding);
-- Original mutation provenance, separate from a later replay's access event.
create table one_account.crm_commit_verifications (
  request_id uuid primary key references one_account.crm_commit_requests,
  audit_id bigint unique references one_account.crm_audit,
  proof_digest text not null references one_account.crm_identity_proofs,
  actor_email text not null, verified_at timestamptz not null,
  auth_method text not null check(auth_method='email_otp'),
  created_at timestamptz not null default clock_timestamp()
);
create table one_account.crm_identity_access_audit (
  access_id bigint generated always as identity primary key,
  proof_digest text not null references one_account.crm_identity_proofs,
  actor_email text not null, verified_at timestamptz not null,
  auth_method text not null check(auth_method='email_otp'),
  action text not null check(action in ('person_read','commit')),
  entity_type text not null, entity_id text not null, request_id uuid,
  result_status text not null check(result_status in ('ok','committed','noop','replayed','conflict')),
  created_at timestamptz not null default clock_timestamp()
);
create index crm_identity_access_entity on one_account.crm_identity_access_audit(entity_type,entity_id,created_at);
create index crm_identity_access_actor on one_account.crm_identity_access_audit(actor_email,created_at);

create function one_account._crm_identity_allowed(p_email text)
returns boolean language plpgsql set search_path='' as $$
declare v_mode text;
begin
  if p_email is null or length(p_email)>254 or p_email !~ '^[a-z0-9._%+-]+@igisam[.]com$' then return false; end if;
  -- Hold the policy/allowlist grant for the whole read or mutation transaction.
  select mode into v_mode from one_account.crm_identity_policy where singleton for share;
  if v_mode='all_verified' then return true; end if;
  if v_mode='allowlist' then
    perform 1 from one_account.crm_identity_allowlist where email=p_email and enabled for share;
    return found;
  end if;
  return false;
end $$;

create function one_account._crm_require_identity(p_proof_digest text,p_session_binding text)
returns one_account.crm_identity_proofs language plpgsql set search_path='' as $$
declare v_proof one_account.crm_identity_proofs;
begin
  if p_proof_digest is null or p_proof_digest !~ '^[a-f0-9]{64}$'
    or p_session_binding is null or p_session_binding !~ '^[a-f0-9]{64}$' then
    raise exception 'CRM identity verification required' using errcode='42501';
  end if;
  -- This row lock makes revocation and a verified operation mutually ordered.
  select * into v_proof from one_account.crm_identity_proofs where proof_digest=p_proof_digest for update;
  if not found or v_proof.session_binding<>p_session_binding or v_proof.revoked_at is not null
    or v_proof.expires_at<=clock_timestamp() or v_proof.parent_expires_at<=clock_timestamp() then
    raise exception 'CRM identity verification required' using errcode='42501';
  end if;
  if not one_account._crm_identity_allowed(v_proof.email) then
    raise exception 'CRM identity verification required' using errcode='42501';
  end if;
  return v_proof;
end $$;

-- Only the server invokes this RPC. Codes are server-HMAC digests; proofs are
-- hashes of independent random tokens. Neither plaintext ever enters this DB.
create function public.oa_crm_identity(p_action text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_keys text[]; v_key text; v_now timestamptz; v_parent timestamptz;
  v_challenge_id uuid; v_email text; v_binding text; v_code text; v_ip text; v_digest text;
  v_challenge one_account.crm_identity_challenges; v_proof one_account.crm_identity_proofs;
  v_count bigint; v_first timestamptz; v_last timestamptz; v_retry integer:=0; v_expiry timestamptz;
begin
  if p_action is null or p_action not in ('start','mark_sent','cancel','verify','status','revoke')
    or jsonb_typeof(p_args) is distinct from 'object' or octet_length(p_args::text)>4096 then
    raise exception 'Invalid CRM identity request' using errcode='22023';
  end if;
  v_keys:=case p_action
    when 'start' then array['challenge_id','email','session_binding','ip_digest','code_digest','parent_expires_at']
    when 'verify' then array['challenge_id','session_binding','code_digest','proof_digest']
    when 'mark_sent' then array['challenge_id','session_binding']
    when 'cancel' then array['challenge_id','session_binding']
    else array['proof_digest','session_binding'] end;
  if exists(select 1 from jsonb_object_keys(p_args) k where not k=any(v_keys)) then
    raise exception 'Unsupported CRM identity field' using errcode='22023';
  end if;
  foreach v_key in array v_keys loop
    if jsonb_typeof(p_args->v_key) is distinct from 'string' then
      raise exception 'Invalid CRM identity field' using errcode='22023';
    end if;
  end loop;
  v_binding:=p_args->>'session_binding';
  if v_binding !~ '^[a-f0-9]{64}$' then raise exception 'Invalid CRM identity binding' using errcode='22023'; end if;
  if p_action in ('start','mark_sent','cancel','verify') then
    if p_args->>'challenge_id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
      raise exception 'Invalid CRM challenge' using errcode='22023';
    end if;
    v_challenge_id:=(p_args->>'challenge_id')::uuid;
  end if;
  if p_action in ('start','verify') then
    v_code:=p_args->>'code_digest';
    if v_code !~ '^[a-f0-9]{64}$' then raise exception 'Invalid CRM code digest' using errcode='22023'; end if;
  end if;
  if p_action in ('verify','status','revoke') then
    v_digest:=p_args->>'proof_digest';
    if v_digest !~ '^[a-f0-9]{64}$' then raise exception 'Invalid CRM proof digest' using errcode='22023'; end if;
  end if;

  if p_action='start' then
    v_email:=p_args->>'email'; v_ip:=p_args->>'ip_digest';
    if length(v_email)>254 or v_email !~ '^[a-z0-9._%+-]+@igisam[.]com$' or v_ip !~ '^[a-f0-9]{64}$' then
      raise exception 'Invalid CRM identity recipient' using errcode='22023';
    end if;
    begin v_parent:=(p_args->>'parent_expires_at')::timestamptz;
    exception when others then raise exception 'Invalid CRM session expiry' using errcode='22023'; end;
    -- A single short distributed reservation lock avoids cross-key races and
    -- deadlocks. SMTP happens only AFTER this transaction has committed.
    perform pg_advisory_xact_lock(hashtextextended('crm_identity_send_reservation',0));
    v_now:=clock_timestamp();
    if not isfinite(v_parent) or v_parent<=v_now or v_parent>v_now+interval '30 days' then
      raise exception 'Invalid CRM session expiry' using errcode='22023';
    end if;
    if not one_account._crm_identity_allowed(v_email) then return jsonb_build_object('status','denied'); end if;
    if exists(select 1 from one_account.crm_identity_challenges where challenge_id=v_challenge_id) then
      return jsonb_build_object('status','duplicate');
    end if;
    -- Failed SMTP, cancelled, superseded and consumed challenges still count.
    select count(*),min(created_at),max(created_at) into v_count,v_first,v_last
      from one_account.crm_identity_challenges where email=v_email and created_at>v_now-interval '1 hour';
    if v_last>v_now-interval '60 seconds' then v_retry:=greatest(v_retry,ceil(extract(epoch from v_last+interval '60 seconds'-v_now))::integer); end if;
    if v_count>=5 then v_retry:=greatest(v_retry,ceil(extract(epoch from v_first+interval '1 hour'-v_now))::integer); end if;
    select count(*),min(created_at) into v_count,v_first from one_account.crm_identity_challenges
      where session_binding=v_binding and created_at>v_now-interval '1 hour';
    if v_count>=5 then v_retry:=greatest(v_retry,ceil(extract(epoch from v_first+interval '1 hour'-v_now))::integer); end if;
    select count(*),min(created_at) into v_count,v_first from one_account.crm_identity_challenges
      where ip_digest=v_ip and created_at>v_now-interval '1 hour';
    if v_count>=25 then v_retry:=greatest(v_retry,ceil(extract(epoch from v_first+interval '1 hour'-v_now))::integer); end if;
    if v_retry>0 then return jsonb_build_object('status','rate_limited','retry_after',v_retry); end if;
    update one_account.crm_identity_challenges set status='cancelled',completed_at=v_now
      where session_binding=v_binding and status in ('pending','sent');
    v_expiry:=least(v_now+interval '10 minutes',v_parent);
    insert into one_account.crm_identity_challenges(challenge_id,email,session_binding,ip_digest,code_digest,parent_expires_at,created_at,expires_at)
      values(v_challenge_id,v_email,v_binding,v_ip,v_code,v_parent,v_now,v_expiry);
    return jsonb_build_object('status','pending','challenge_id',v_challenge_id,'expires_at',v_expiry,'retry_after',60);
  elsif p_action='status' then
    begin v_proof:=one_account._crm_require_identity(v_digest,v_binding);
    exception when insufficient_privilege then return jsonb_build_object('status','unverified'); end;
    return jsonb_build_object('status','verified','email',v_proof.email,'expires_at',v_proof.expires_at,'auth_method',v_proof.auth_method);
  elsif p_action='revoke' then
    update one_account.crm_identity_proofs set revoked_at=clock_timestamp()
      where proof_digest=v_digest and session_binding=v_binding and revoked_at is null;
    return jsonb_build_object('status','unverified');
  end if;

  select * into v_challenge from one_account.crm_identity_challenges where challenge_id=v_challenge_id for update;
  if not found or v_challenge.session_binding<>v_binding then return jsonb_build_object('status','invalid'); end if;
  v_now:=clock_timestamp();
  if p_action='cancel' then
    update one_account.crm_identity_challenges set status='cancelled',completed_at=v_now
      where challenge_id=v_challenge_id and status in ('pending','sent');
    return jsonb_build_object('status','cancelled');
  end if;
  if v_challenge.status not in ('pending','sent') then return jsonb_build_object('status','inactive'); end if;
  if v_challenge.expires_at<=v_now or v_challenge.parent_expires_at<=v_now then
    update one_account.crm_identity_challenges set status='expired',completed_at=v_now where challenge_id=v_challenge_id;
    return jsonb_build_object('status','expired');
  end if;
  if p_action='mark_sent' then
    update one_account.crm_identity_challenges set status='sent',sent_at=coalesce(sent_at,v_now) where challenge_id=v_challenge_id;
    return jsonb_build_object('status','sent','challenge_id',v_challenge_id,'expires_at',v_challenge.expires_at);
  end if;
  if v_challenge.status<>'sent' then return jsonb_build_object('status','invalid'); end if;
  if not one_account._crm_identity_allowed(v_challenge.email) then return jsonb_build_object('status','denied'); end if;
  if v_challenge.code_digest<>v_code then
    update one_account.crm_identity_challenges set attempts=attempts+1,
      status=case when attempts+1>=5 then 'locked' else status end,
      completed_at=case when attempts+1>=5 then v_now else completed_at end
      where challenge_id=v_challenge_id returning * into v_challenge;
    return jsonb_build_object('status',case when v_challenge.attempts>=5 then 'locked' else 'invalid_code' end,'attempts_remaining',5-v_challenge.attempts);
  end if;
  if exists(select 1 from one_account.crm_identity_proofs where proof_digest=v_digest) then return jsonb_build_object('status','invalid'); end if;
  update one_account.crm_identity_challenges set status='consumed',completed_at=v_now where challenge_id=v_challenge_id;
  update one_account.crm_identity_proofs set revoked_at=v_now where session_binding=v_binding and revoked_at is null;
  v_expiry:=least(v_now+interval '8 hours',v_challenge.parent_expires_at);
  insert into one_account.crm_identity_proofs(proof_digest,challenge_id,email,session_binding,verified_at,expires_at,parent_expires_at)
    values(v_digest,v_challenge_id,v_challenge.email,v_binding,v_now,v_expiry,v_challenge.parent_expires_at);
  return jsonb_build_object('status','verified','email',v_challenge.email,'expires_at',v_expiry,'auth_method','email_otp');
end $$;

create function public.oa_crm_verified_commit(p_action text,p_entity text,p_id text,p_expected_revision bigint,p_patch jsonb,p_request_id uuid,p_proof_digest text,p_session_binding text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_proof one_account.crm_identity_proofs; v_result jsonb; v_audit_id bigint;
begin
  v_proof:=one_account._crm_require_identity(p_proof_digest,p_session_binding);
  v_result:=public.oa_crm_commit(p_action,p_entity,p_id,p_expected_revision,p_patch,v_proof.email,p_request_id);
  if v_result->>'status' in ('committed','noop') then
    if v_result->>'status'='committed' then
      select audit_id into strict v_audit_id from one_account.crm_audit
        where request_id=p_request_id and actor_email=v_proof.email and entity_type=p_entity and entity_id=p_id;
    end if;
    insert into one_account.crm_commit_verifications(request_id,audit_id,proof_digest,actor_email,verified_at,auth_method)
      values(p_request_id,v_audit_id,v_proof.proof_digest,v_proof.email,v_proof.verified_at,v_proof.auth_method);
  end if;
  -- A replay's current authentication is an ACCESS event, not retroactive
  -- authentication of an older mutation that lacked verification provenance.
  insert into one_account.crm_identity_access_audit(proof_digest,actor_email,verified_at,auth_method,action,entity_type,entity_id,request_id,result_status)
    values(v_proof.proof_digest,v_proof.email,v_proof.verified_at,v_proof.auth_method,'commit',p_entity,p_id,p_request_id,v_result->>'status');
  return v_result;
end $$;

create function public.oa_crm_verified_read(p_action text,p_id text,p_query text,p_limit integer,p_proof_digest text,p_session_binding text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_proof one_account.crm_identity_proofs; v_result jsonb; v_audit jsonb;
begin
  if p_action is distinct from 'person' or p_id is null or length(p_id) not between 1 and 200 or p_query is not null
    or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'Invalid verified CRM detail request' using errcode='22023';
  end if;
  v_proof:=one_account._crm_require_identity(p_proof_digest,p_session_binding);
  v_result:=public.oa_crm_read(p_action,p_id,p_query,p_limit);
  -- Use typed identity pairs, including life events, not an untyped ID union.
  with scope(entity_type,entity_id) as (
    select 'person',p_id
    union all select 'affiliation',affiliation_id from one_account.crm_affiliations where person_id=p_id
    union all select 'contact_point',contact_point_id from one_account.crm_contact_points where person_id=p_id
    union all select 'preference',preference_id from one_account.crm_receiving_preferences where person_id=p_id
    union all select 'gift_recipient',recipient_id from one_account.crm_gift_recipients where person_id=p_id
    union all select 'life_event',event_id from one_account.crm_life_events where person_id=p_id
  ), selected as (
    select a.*,case when v.request_id is null then null else jsonb_build_object(
      'actor_email',v.actor_email,'verified_at',v.verified_at,'auth_method',v.auth_method) end verification
    from one_account.crm_audit a join scope s using(entity_type,entity_id)
    left join one_account.crm_commit_verifications v on v.audit_id=a.audit_id
    order by a.created_at desc,a.audit_id desc limit 100
  ) select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc,s.audit_id desc),'[]'::jsonb) into v_audit from selected s;
  v_result:=v_result||jsonb_build_object('audit',v_audit,
    'campaigns',(select coalesce(jsonb_agg(to_jsonb(c) order by c.year desc,c.campaign_id),'[]'::jsonb) from one_account.crm_gift_campaigns c),
    'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.name,i.item_id),'[]'::jsonb) from one_account.crm_gift_items i));
  insert into one_account.crm_identity_access_audit(proof_digest,actor_email,verified_at,auth_method,action,entity_type,entity_id,result_status)
    values(v_proof.proof_digest,v_proof.email,v_proof.verified_at,v_proof.auth_method,'person_read','person',p_id,'ok');
  return v_result;
end $$;

do $$ declare t text; begin
  foreach t in array array['crm_identity_policy','crm_identity_allowlist','crm_identity_challenges','crm_identity_proofs','crm_commit_verifications','crm_identity_access_audit'] loop
    execute format('alter table one_account.%I enable row level security',t);
    execute format('revoke all on table one_account.%I from public,anon,authenticated,service_role',t);
  end loop;
  foreach t in array array['crm_commit_verifications','crm_identity_access_audit'] loop
    execute format('create trigger immutable before update or delete on one_account.%I for each row execute function one_account._reject_history_mutation()',t);
  end loop;
end $$;
revoke all on sequence one_account.crm_identity_access_audit_access_id_seq from public,anon,authenticated,service_role;
revoke all on function one_account._crm_identity_allowed(text) from public,anon,authenticated,service_role;
revoke all on function one_account._crm_require_identity(text,text) from public,anon,authenticated,service_role;
revoke all on function public.oa_crm_identity(text,jsonb) from public,anon,authenticated;
revoke all on function public.oa_crm_verified_read(text,text,text,integer,text,text) from public,anon,authenticated;
revoke all on function public.oa_crm_verified_commit(text,text,text,bigint,jsonb,uuid,text,text) from public,anon,authenticated;
-- The legacy function remains an internal primitive; app writes cannot bypass proof checks.
revoke all on function public.oa_crm_commit(text,text,text,bigint,jsonb,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.oa_crm_identity(text,jsonb) to service_role;
grant execute on function public.oa_crm_verified_read(text,text,text,integer,text,text) to service_role;
grant execute on function public.oa_crm_verified_commit(text,text,text,bigint,jsonb,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
