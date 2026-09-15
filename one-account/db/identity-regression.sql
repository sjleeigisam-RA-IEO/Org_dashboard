-- Synthetic fixtures only; run as the database owner after 009. Never commit.
-- To validate an unapplied 009, place both files' interiors in ONE outer
-- BEGIN/ROLLBACK transaction. No customer values or authentication tokens print.
begin;
do $$
declare
  r jsonb; r2 jsonb; args jsonb; saved_proof one_account.crm_identity_proofs;
  failed boolean; n bigint; before_audits bigint; before_sources bigint; before_claims bigint; before_rm jsonb;
  cid uuid:='a9000000-0000-4000-8000-000000000001';
  binding text:=repeat('a',64); code text:=repeat('b',64); proof text:=repeat('c',64);
  v_email text:='identity-fixture@igisam.com';
  parent_exp timestamptz:=clock_timestamp()+interval '2 hours';
  i integer; role_name text; table_name text; function_name text; rate_binding text; rate_ip text; rate_email text;
  legacy_request uuid:='a9000000-0000-4000-8000-000000000020';
  edit_request uuid:='a9000000-0000-4000-8000-000000000021';
  noop_request uuid:='a9000000-0000-4000-8000-000000000022';
begin
  if exists(select 1 from one_account.crm_persons where person_id='identity-fixture-person') then raise exception 'Identity fixture collision'; end if;
  select count(*) into before_sources from one_account.crm_source_records;
  select count(*) into before_claims from one_account.crm_field_claims;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.dataset_id),'[]'::jsonb) into before_rm from one_account.current_state s;
  args:=jsonb_build_object('challenge_id',cid,'email',v_email,'session_binding',binding,'ip_digest',repeat('d',64),'code_digest',code,'parent_expires_at',parent_exp);

  update one_account.crm_identity_policy set mode='disabled' where singleton;
  r:=public.oa_crm_identity('start',args);
  if r->>'status'<>'denied' or exists(select 1 from one_account.crm_identity_challenges where challenge_id=cid) then raise exception 'Disabled policy reserved challenge'; end if;
  update one_account.crm_identity_policy set mode='allowlist' where singleton;
  r:=public.oa_crm_identity('start',args);
  if r->>'status'<>'denied' then raise exception 'Missing allowlist grant accepted'; end if;
  insert into one_account.crm_identity_allowlist(email) values(v_email);
  failed:=false;
  begin perform public.oa_crm_identity('start',args||'{"actor_email":"spoof@igisam.com"}'); exception when sqlstate '22023' then failed:=true; end;
  if not failed then raise exception 'Unknown identity input accepted'; end if;
  failed:=false;
  begin perform public.oa_crm_identity('start',args||'{"email":"synthetic@example.invalid"}'); exception when sqlstate '22023' then failed:=true; end;
  if not failed then raise exception 'External mailbox accepted'; end if;
  failed:=false;
  begin perform public.oa_crm_identity('start',args||jsonb_build_object('parent_expires_at',clock_timestamp()+interval '31 days')); exception when sqlstate '22023' then failed:=true; end;
  if not failed then raise exception 'Excessive parent session accepted'; end if;

  r:=public.oa_crm_identity('start',args);
  if r->>'status'<>'pending' or (r->>'expires_at')::timestamptz>clock_timestamp()+interval '10 minutes' then raise exception 'Challenge reservation failed'; end if;
  r2:=public.oa_crm_identity('start',args);
  if r2->>'status'<>'duplicate' then raise exception 'Challenge ID replay can send twice'; end if;
  r2:=public.oa_crm_identity('verify',jsonb_build_object('challenge_id',cid,'session_binding',binding,'code_digest',code,'proof_digest',proof));
  if r2->>'status'<>'invalid' then raise exception 'Unsent challenge verified'; end if;
  r2:=public.oa_crm_identity('start',args||'{"challenge_id":"a9000000-0000-4000-8000-000000000002","session_binding":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}');
  if r2->>'status'<>'rate_limited' or (r2->>'retry_after')::int not between 1 and 60 then raise exception 'Distributed mailbox cooldown failed'; end if;
  r2:=public.oa_crm_identity('mark_sent',jsonb_build_object('challenge_id',cid,'session_binding',repeat('e',64)));
  if r2->>'status'<>'invalid' then raise exception 'Foreign binding marked challenge sent'; end if;
  r:=public.oa_crm_identity('mark_sent',jsonb_build_object('challenge_id',cid,'session_binding',binding));
  r2:=public.oa_crm_identity('mark_sent',jsonb_build_object('challenge_id',cid,'session_binding',binding));
  if r->>'status'<>'sent' or r2<>r then raise exception 'Sent marking changed challenge expiry'; end if;
  r:=public.oa_crm_identity('verify',jsonb_build_object('challenge_id',cid,'session_binding',binding,'code_digest',repeat('f',64),'proof_digest',proof));
  if r->>'status'<>'invalid_code' or r->>'attempts_remaining'<>'4' then raise exception 'Wrong code did not consume attempt'; end if;
  r:=public.oa_crm_identity('verify',jsonb_build_object('challenge_id',cid,'session_binding',repeat('e',64),'code_digest',code,'proof_digest',proof));
  if r->>'status'<>'invalid' or (select attempts from one_account.crm_identity_challenges where challenge_id=cid)<>1 then raise exception 'Foreign binding altered challenge'; end if;
  r:=public.oa_crm_identity('verify',jsonb_build_object('challenge_id',cid,'session_binding',binding,'code_digest',code,'proof_digest',proof));
  if r->>'status'<>'verified' or r->>'email'<>v_email or r->>'auth_method'<>'email_otp' or (r->>'expires_at')::timestamptz<>parent_exp then raise exception 'Proof identity or parent expiry cap failed'; end if;
  if r ?| array['proof_digest','code_digest','session_binding'] then raise exception 'Identity digest echoed'; end if;
  r2:=public.oa_crm_identity('verify',jsonb_build_object('challenge_id',cid,'session_binding',binding,'code_digest',code,'proof_digest',repeat('9',64)));
  if r2->>'status'<>'inactive' or exists(select 1 from one_account.crm_identity_proofs where proof_digest=repeat('9',64)) then raise exception 'Consumed code replayed'; end if;
  r:=public.oa_crm_identity('status',jsonb_build_object('proof_digest',proof,'session_binding',binding));
  if r->>'status'<>'verified' then raise exception 'Proof status missing'; end if;
  r:=public.oa_crm_identity('status',jsonb_build_object('proof_digest',proof,'session_binding',repeat('e',64)));
  if r->>'status'<>'unverified' or r ? 'email' then raise exception 'Proof escaped parent binding'; end if;
  update one_account.crm_identity_allowlist set enabled=false where crm_identity_allowlist.email=v_email;
  r:=public.oa_crm_identity('status',jsonb_build_object('proof_digest',proof,'session_binding',binding));
  if r->>'status'<>'unverified' then raise exception 'Withdrawn allowlist grant accepted'; end if;
  update one_account.crm_identity_allowlist set enabled=true where crm_identity_allowlist.email=v_email;
  update one_account.crm_identity_policy set mode='disabled' where singleton;
  r:=public.oa_crm_identity('status',jsonb_build_object('proof_digest',proof,'session_binding',binding));
  if r->>'status'<>'unverified' then raise exception 'Disabled policy kept proof usable'; end if;
  update one_account.crm_identity_policy set mode='all_verified' where singleton;
  select * into saved_proof from one_account.crm_identity_proofs where proof_digest=proof;
  update one_account.crm_identity_proofs set verified_at=saved_proof.verified_at-interval '9 hours',expires_at=saved_proof.verified_at-interval '1 hour' where proof_digest=proof;
  r:=public.oa_crm_identity('status',jsonb_build_object('proof_digest',proof,'session_binding',binding));
  if r->>'status'<>'unverified' then raise exception 'Expired proof accepted'; end if;
  update one_account.crm_identity_proofs set verified_at=saved_proof.verified_at,expires_at=saved_proof.expires_at where proof_digest=proof;

  -- All 5 failures commit as states, not exceptions that roll their counters back.
  cid:='a9000000-0000-4000-8000-000000000003';
  args:=args||jsonb_build_object('challenge_id',cid,'email','identity-lock@igisam.com','session_binding',repeat('1',64));
  perform public.oa_crm_identity('start',args);
  perform public.oa_crm_identity('mark_sent',jsonb_build_object('challenge_id',cid,'session_binding',repeat('1',64)));
  for i in 1..5 loop
    r:=public.oa_crm_identity('verify',jsonb_build_object('challenge_id',cid,'session_binding',repeat('1',64),'code_digest',repeat('0',64),'proof_digest',repeat('2',64)));
    if r->>'status'<>(case when i=5 then 'locked' else 'invalid_code' end) or (r->>'attempts_remaining')::int<>5-i then raise exception 'Attempt limit failed'; end if;
  end loop;
  r:=public.oa_crm_identity('verify',jsonb_build_object('challenge_id',cid,'session_binding',repeat('1',64),'code_digest',code,'proof_digest',repeat('2',64)));
  if r->>'status'<>'inactive' or exists(select 1 from one_account.crm_identity_proofs where proof_digest=repeat('2',64)) then raise exception 'Locked challenge accepted'; end if;

  -- A new reservation supersedes previous active challenges for that binding.
  cid:='a9000000-0000-4000-8000-000000000004';
  args:=args||jsonb_build_object('challenge_id',cid,'email','identity-resend@igisam.com','session_binding',repeat('3',64),'parent_expires_at',clock_timestamp()+interval '29 days');
  perform public.oa_crm_identity('start',args);
  update one_account.crm_identity_challenges set created_at=created_at-interval '2 minutes',expires_at=expires_at-interval '2 minutes' where challenge_id=cid;
  args:=args||'{"challenge_id":"a9000000-0000-4000-8000-000000000005"}';
  r:=public.oa_crm_identity('start',args);
  if r->>'status'<>'pending' or (select status from one_account.crm_identity_challenges where challenge_id=cid)<>'cancelled' then raise exception 'Active challenge not superseded'; end if;
  cid:='a9000000-0000-4000-8000-000000000005';
  perform public.oa_crm_identity('mark_sent',jsonb_build_object('challenge_id',cid,'session_binding',repeat('3',64)));
  r:=public.oa_crm_identity('verify',jsonb_build_object('challenge_id',cid,'session_binding',repeat('3',64),'code_digest',code,'proof_digest',repeat('4',64)));
  if r->>'status'<>'verified' or (select expires_at-verified_at from one_account.crm_identity_proofs where proof_digest=repeat('4',64))<>interval '8 hours' then raise exception 'Eight-hour proof cap failed'; end if;
  update one_account.crm_identity_challenges set created_at=created_at-interval '2 minutes',expires_at=expires_at-interval '2 minutes' where challenge_id=cid;
  cid:='a9000000-0000-4000-8000-000000000006'; args:=args||jsonb_build_object('challenge_id',cid);
  perform public.oa_crm_identity('start',args);
  perform public.oa_crm_identity('mark_sent',jsonb_build_object('challenge_id',cid,'session_binding',repeat('3',64)));
  perform public.oa_crm_identity('verify',jsonb_build_object('challenge_id',cid,'session_binding',repeat('3',64),'code_digest',code,'proof_digest',repeat('5',64)));
  r:=public.oa_crm_identity('status',jsonb_build_object('proof_digest',repeat('4',64),'session_binding',repeat('3',64)));
  if r->>'status'<>'unverified' then raise exception 'Replacement proof left prior proof active'; end if;

  cid:='a9000000-0000-4000-8000-000000000007'; args:=args||jsonb_build_object('challenge_id',cid,'email','identity-expired@igisam.com','session_binding',repeat('6',64));
  perform public.oa_crm_identity('start',args);
  update one_account.crm_identity_challenges set created_at=created_at-interval '11 minutes',expires_at=expires_at-interval '11 minutes' where challenge_id=cid;
  r:=public.oa_crm_identity('mark_sent',jsonb_build_object('challenge_id',cid,'session_binding',repeat('6',64)));
  if r->>'status'<>'expired' then raise exception 'Expired challenge can be sent'; end if;
  cid:='a9000000-0000-4000-8000-000000000008'; args:=args||jsonb_build_object('challenge_id',cid,'email','identity-cancel@igisam.com','session_binding',repeat('7',64));
  perform public.oa_crm_identity('start',args);
  perform public.oa_crm_identity('cancel',jsonb_build_object('challenge_id',cid,'session_binding',repeat('7',64)));
  r:=public.oa_crm_identity('mark_sent',jsonb_build_object('challenge_id',cid,'session_binding',repeat('7',64)));
  if r->>'status'<>'inactive' then raise exception 'Cancelled SMTP challenge reactivated'; end if;
  r:=public.oa_crm_identity('start',args||'{"challenge_id":"a9000000-0000-4000-8000-000000000009"}');
  if r->>'status'<>'rate_limited' then raise exception 'SMTP failure reset rate limit'; end if;

  -- Test exact send thresholds independently: 5/email/hour, 5/binding/hour,
  -- 25/IP/hour. Old cancelled reservations count and need no SMTP or sleeps.
  for i in 1..4 loop
    insert into one_account.crm_identity_challenges(challenge_id,email,session_binding,ip_digest,code_digest,parent_expires_at,status,created_at,expires_at,completed_at)
      values(gen_random_uuid(),'identity-rate-email@igisam.com',repeat(md5('email-binding-'||i),2),repeat(md5('email-ip-'||i),2),code,parent_exp,'cancelled',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '11 minutes',clock_timestamp());
  end loop;
  args:=jsonb_build_object('challenge_id',gen_random_uuid(),'email','identity-rate-email@igisam.com','session_binding',repeat(md5('email-limit-new'),2),'ip_digest',repeat(md5('email-limit-ip'),2),'code_digest',code,'parent_expires_at',parent_exp);
  r:=public.oa_crm_identity('start',args); if r->>'status'<>'pending' then raise exception 'Fifth mailbox reservation rejected'; end if;
  r:=public.oa_crm_identity('start',args||jsonb_build_object('challenge_id',gen_random_uuid(),'session_binding',repeat(md5('email-limit-sixth'),2)));
  if r->>'status'<>'rate_limited' or (r->>'retry_after')::int<2000 then raise exception 'Mailbox hourly limit failed'; end if;
  rate_binding:=repeat(md5('binding-limit'),2);
  for i in 1..4 loop
    insert into one_account.crm_identity_challenges(challenge_id,email,session_binding,ip_digest,code_digest,parent_expires_at,status,created_at,expires_at,completed_at)
      values(gen_random_uuid(),'identity-binding-'||i||'@igisam.com',rate_binding,repeat(md5('binding-ip-'||i),2),code,parent_exp,'cancelled',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '11 minutes',clock_timestamp());
  end loop;
  args:=jsonb_build_object('challenge_id',gen_random_uuid(),'email','identity-binding-5@igisam.com','session_binding',rate_binding,'ip_digest',repeat(md5('binding-ip-5'),2),'code_digest',code,'parent_expires_at',parent_exp);
  r:=public.oa_crm_identity('start',args); if r->>'status'<>'pending' then raise exception 'Fifth binding reservation rejected'; end if;
  r:=public.oa_crm_identity('start',args||jsonb_build_object('challenge_id',gen_random_uuid(),'email','identity-binding-6@igisam.com'));
  if r->>'status'<>'rate_limited' then raise exception 'Binding rotation limit failed'; end if;
  rate_ip:=repeat(md5('ip-limit'),2);
  for i in 1..24 loop
    insert into one_account.crm_identity_challenges(challenge_id,email,session_binding,ip_digest,code_digest,parent_expires_at,status,created_at,expires_at,completed_at)
      values(gen_random_uuid(),'identity-ip-'||i||'@igisam.com',repeat(md5('ip-binding-'||i),2),rate_ip,code,parent_exp,'cancelled',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '11 minutes',clock_timestamp());
  end loop;
  args:=jsonb_build_object('challenge_id',gen_random_uuid(),'email','identity-ip-25@igisam.com','session_binding',repeat(md5('ip-binding-25'),2),'ip_digest',rate_ip,'code_digest',code,'parent_expires_at',parent_exp);
  r:=public.oa_crm_identity('start',args); if r->>'status'<>'pending' then raise exception 'Twenty-fifth IP reservation rejected'; end if;
  r:=public.oa_crm_identity('start',args||jsonb_build_object('challenge_id',gen_random_uuid(),'email','identity-ip-26@igisam.com','session_binding',repeat(md5('ip-binding-26'),2)));
  if r->>'status'<>'rate_limited' then raise exception 'Distributed IP limit failed'; end if;

  insert into one_account.crm_accounts(account_id,name,piscfh) values('identity-fixture-account','Synthetic Identity Account','C');
  insert into one_account.crm_accounts(account_id,name,piscfh,account_kind) values('identity-fixture-group','Synthetic Identity Group','C','group');
  insert into one_account.crm_persons(person_id,name) values('identity-fixture-person','Synthetic Identity Person'),('identity-fixture-other','Synthetic Other Person');
  insert into one_account.crm_affiliations(affiliation_id,person_id,account_id) values
    ('identity-fixture-aff','identity-fixture-person','identity-fixture-account'),('identity-fixture-other-aff','identity-fixture-other','identity-fixture-account');
  insert into one_account.crm_gift_campaigns(campaign_id,name,year,occasion) values('identity-fixture-campaign','Synthetic Campaign',2026,'synthetic');
  insert into one_account.crm_gift_items(item_id,name) values('identity-fixture-item','Synthetic Item');
  -- Legacy replay remains unverified in ORIGINAL mutation provenance.
  perform public.oa_crm_commit('update','person','identity-fixture-person',1,'{"notes":"Synthetic legacy note"}',v_email,legacy_request);
  r:=public.oa_crm_verified_commit('update','person','identity-fixture-person',1,'{"notes":"Synthetic legacy note"}',legacy_request,proof,binding);
  if r->>'status'<>'replayed' or exists(select 1 from one_account.crm_commit_verifications where request_id=legacy_request) then raise exception 'Legacy replay falsely attributed verified origin'; end if;
  r:=public.oa_crm_verified_commit('update','person','identity-fixture-person',2,'{"notes":"Synthetic verified note"}',edit_request,proof,binding);
  if r->>'status'<>'committed' or r->>'revision'<>'3' then raise exception 'Verified mutation failed'; end if;
  if not exists(select 1 from one_account.crm_audit a join one_account.crm_commit_verifications v using(audit_id)
    where a.request_id=edit_request and a.actor_email=v_email and v.actor_email=v_email and v.proof_digest=proof and v.auth_method='email_otp'
      and a.before_record->>'notes'='Synthetic legacy note' and a.after_record->>'notes'='Synthetic verified note') then raise exception 'Full authenticated change provenance missing'; end if;
  select count(*) into before_audits from one_account.crm_audit;
  r2:=public.oa_crm_verified_commit('update','person','identity-fixture-person',2,'{"notes":"Synthetic verified note"}',edit_request,proof,binding);
  if r2->>'status'<>'replayed' or (select count(*) from one_account.crm_audit)<>before_audits then raise exception 'Verified replay wrote twice'; end if;
  r:=public.oa_crm_verified_commit('update','person','identity-fixture-person',3,'{"notes":"Synthetic verified note"}',noop_request,proof,binding);
  if r->>'status'<>'noop' or not exists(select 1 from one_account.crm_commit_verifications where request_id=noop_request and audit_id is null) then raise exception 'Verified noop provenance failed'; end if;
  r:=public.oa_crm_verified_commit('update','person','identity-fixture-person',1,'{"notes":"Synthetic stale note"}','a9000000-0000-4000-8000-000000000023',proof,binding);
  if r->>'status'<>'conflict' or not exists(select 1 from one_account.crm_identity_access_audit where request_id='a9000000-0000-4000-8000-000000000023' and result_status='conflict') then raise exception 'Conflict was not safely audited'; end if;
  failed:=false;
  begin perform public.oa_crm_verified_commit('update','person','identity-fixture-person',2,'{"notes":"Changed replay payload"}',edit_request,proof,binding); exception when sqlstate '22023' then failed:=true; end;
  if not failed then raise exception 'Changed replay payload accepted'; end if;
  failed:=false;
  begin perform public.oa_crm_verified_commit('create','contact_point','identity-fixture-bad',0,'{"person_id":"identity-fixture-person","affiliation_id":"identity-fixture-other-aff","kind":"email","value":"synthetic@example.invalid"}',gen_random_uuid(),proof,binding); exception when sqlstate '22023' then failed:=true; end;
  if not failed or exists(select 1 from one_account.crm_contact_points where contact_point_id='identity-fixture-bad') then raise exception 'Cross-person contact created'; end if;
  failed:=false;
  begin perform public.oa_crm_verified_commit('create','affiliation','identity-fixture-bad-group',0,'{"person_id":"identity-fixture-person","account_id":"identity-fixture-group"}',gen_random_uuid(),proof,binding); exception when sqlstate '22023' then failed:=true; end;
  if not failed then raise exception 'Display group became employer'; end if;
  r:=public.oa_crm_verified_commit('create','contact_point','identity-fixture-contact',0,'{"person_id":"identity-fixture-person","affiliation_id":"identity-fixture-aff","kind":"email","value":"synthetic@example.invalid"}',gen_random_uuid(),proof,binding);
  if r->>'status'<>'committed' then raise exception 'Verified contact creation failed'; end if;
  perform public.oa_crm_verified_commit('create','preference','identity-fixture-pref',0,'{"person_id":"identity-fixture-person","availability":"no","scope":"campaign","campaign_id":"identity-fixture-campaign"}',gen_random_uuid(),proof,binding);
  perform public.oa_crm_verified_commit('create','gift_recipient','identity-fixture-gift',0,'{"person_id":"identity-fixture-person","campaign_id":"identity-fixture-campaign","item_id":"identity-fixture-item","send_target":"yes"}',gen_random_uuid(),proof,binding);
  perform public.oa_crm_verified_commit('create','life_event','identity-fixture-event',0,'{"person_id":"identity-fixture-person","event_type":"other","description":"Synthetic event"}',gen_random_uuid(),proof,binding);
  -- Deliberately collide a different entity type's ID to prove typed audit scope.
  perform public.oa_crm_commit('create','life_event','identity-fixture-person',0,'{"person_id":"identity-fixture-other","event_type":"other","description":"Other fixture event"}',v_email,gen_random_uuid());
  r:=public.oa_crm_verified_read('person','identity-fixture-person',null,100,proof,binding);
  if not exists(select 1 from jsonb_array_elements(r->'audit') a where a->>'entity_type'='life_event' and a->>'entity_id'='identity-fixture-event' and a->'verification'->>'auth_method'='email_otp') then raise exception 'Life-event verified audit absent'; end if;
  if exists(select 1 from jsonb_array_elements(r->'audit') a where a->>'entity_type'='life_event' and a->>'entity_id'='identity-fixture-person') then raise exception 'Another person audit leaked through ID collision'; end if;
  if not exists(select 1 from jsonb_array_elements(r->'audit') a where a->>'request_id'=edit_request::text and a->'before_record'->>'notes'='Synthetic legacy note' and a->'after_record'->>'notes'='Synthetic verified note') then raise exception 'Person history omitted before and after'; end if;
  if not exists(select 1 from jsonb_array_elements(r->'audit') a where a->>'request_id'=legacy_request::text and a->'verification'='null'::jsonb) then raise exception 'Legacy audit authentication falsified'; end if;
  if not exists(select 1 from jsonb_array_elements(r->'campaigns') c where c->>'campaign_id'='identity-fixture-campaign') or not exists(select 1 from jsonb_array_elements(r->'items') c where c->>'item_id'='identity-fixture-item') then raise exception 'Verified edit catalogs missing'; end if;
  if not exists(select 1 from one_account.crm_identity_access_audit where actor_email=v_email and entity_id='identity-fixture-person' and action='person_read' and proof_digest=proof) then raise exception 'Detail access not logged'; end if;
  if (r->'audit')::text like '%proof_digest%' or (r->'audit')::text like '%session_binding%' then raise exception 'Authentication digest leaked into person history'; end if;
  failed:=false;
  begin perform public.oa_crm_verified_read('account','identity-fixture-account',null,100,proof,binding); exception when sqlstate '22023' then failed:=true; end;
  if not failed then raise exception 'Verified read opened a bulk list'; end if;
  failed:=false;
  begin perform public.oa_crm_verified_read('person','identity-fixture-person',null,100,proof,repeat('e',64)); exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Detail read accepted wrong binding'; end if;
  failed:=false;
  begin update one_account.crm_commit_verifications set actor_email='changed@igisam.com' where request_id=edit_request; exception when sqlstate '55000' then failed:=true; end;
  if not failed then raise exception 'Mutation verification history mutable'; end if;
  failed:=false;
  begin delete from one_account.crm_identity_access_audit where actor_email=v_email; exception when sqlstate '55000' then failed:=true; end;
  if not failed then raise exception 'Access history mutable'; end if;
  perform public.oa_crm_identity('revoke',jsonb_build_object('proof_digest',proof,'session_binding',binding));
  r:=public.oa_crm_identity('status',jsonb_build_object('proof_digest',proof,'session_binding',binding));
  if r->>'status'<>'unverified' then raise exception 'Revoked proof accepted'; end if;
  failed:=false;
  begin perform public.oa_crm_verified_commit('update','person','identity-fixture-person',2,'{"notes":"Synthetic verified note"}',edit_request,proof,binding); exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Revoked proof replay bypassed verification'; end if;

  foreach role_name in array array['anon','authenticated','service_role'] loop
    foreach table_name in array array['crm_identity_policy','crm_identity_allowlist','crm_identity_challenges','crm_identity_proofs','crm_commit_verifications','crm_identity_access_audit'] loop
      if has_table_privilege(role_name,'one_account.'||table_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Direct identity table privilege'; end if;
      if not (select relrowsecurity from pg_class where oid=('one_account.'||table_name)::regclass) then raise exception 'Identity RLS disabled'; end if;
    end loop;
    if has_function_privilege(role_name,'one_account._crm_identity_allowed(text)','EXECUTE') or has_function_privilege(role_name,'one_account._crm_require_identity(text,text)','EXECUTE') then raise exception 'Private identity helper executable'; end if;
    if has_function_privilege(role_name,'public.oa_crm_commit(text,text,text,bigint,jsonb,text,uuid)','EXECUTE') then raise exception 'Legacy commit bypass still executable'; end if;
    if has_sequence_privilege(role_name,'one_account.crm_identity_access_audit_access_id_seq','USAGE,SELECT,UPDATE') then raise exception 'Direct access sequence privilege'; end if;
    foreach function_name in array array['public.oa_crm_identity(text,jsonb)','public.oa_crm_verified_read(text,text,text,integer,text,text)','public.oa_crm_verified_commit(text,text,text,bigint,jsonb,uuid,text,text)'] loop
      if has_function_privilege(role_name,function_name,'EXECUTE') is distinct from (role_name='service_role') then raise exception 'Identity RPC privilege mismatch'; end if;
    end loop;
  end loop;
  if not has_function_privilege('service_role','public.oa_crm_read(text,text,text,integer)','EXECUTE') or not has_function_privilege('service_role','public.oa_crm_import(jsonb,text)','EXECUTE') then raise exception 'Unrelated CRM service privilege removed'; end if;
  if (select count(*) from one_account.crm_source_records)<>before_sources or (select count(*) from one_account.crm_field_claims)<>before_claims then raise exception 'Immutable source data changed'; end if;
  if (select coalesce(jsonb_agg(to_jsonb(s) order by s.dataset_id),'[]'::jsonb) from one_account.current_state s) is distinct from before_rm then raise exception 'RM state changed'; end if;
end $$;
rollback;
