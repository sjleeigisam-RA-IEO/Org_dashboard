-- Private customer CRM. No personal source values belong in this migration.
-- Run once as database administrator after 001_shared_state.sql.
begin;

create table one_account.crm_import_batches (
  batch_id text primary key check(length(batch_id) between 1 and 200),
  manifest_sha256 text not null check(manifest_sha256 ~ '^[a-f0-9]{64}$'),
  payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
  actor_email text not null, counts jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table one_account.crm_sources (
  source_id text primary key, file_name text not null,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  imported_batch_id text not null references one_account.crm_import_batches,
  created_at timestamptz not null default clock_timestamp(),
  unique(file_name,sha256)
);
create table one_account.crm_source_records (
  source_record_id text primary key,
  source_id text not null references one_account.crm_sources,
  sheet_name text not null, row_number integer not null check(row_number>0),
  raw_values jsonb not null check(jsonb_typeof(raw_values)='object'),
  unique(source_id,sheet_name,row_number)
);
create table one_account.crm_accounts (
  account_id text primary key check(length(account_id) between 1 and 200),
  name text not null check(length(name) between 1 and 300),
  piscfh text not null default '미분류' check(piscfh in ('P','I','S','C','F','H','비Account','미분류')),
  aliases jsonb not null default '[]' check(jsonb_typeof(aliases)='array'),
  is_existing boolean not null default false,
  is_placeholder boolean not null default false,
  contact_account_id text references one_account.crm_accounts(account_id) deferrable initially deferred,
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create table one_account.crm_persons (
  person_id text primary key, name text not null check(length(name) between 1 and 200),
  identity_status text not null default 'unverified' check(identity_status in ('unverified','verified','needs_review')),
  notes text not null default '' check(length(notes)<=10000),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create table one_account.crm_affiliations (
  affiliation_id text primary key,
  person_id text not null references one_account.crm_persons,
  account_id text not null references one_account.crm_accounts,
  department text not null default '' check(length(department)<=1000),
  title text not null default '' check(length(title)<=1000),
  employment_status text not null default 'unknown' check(employment_status in ('unknown','current','former')),
  started_on date, ended_on date,
  notes text not null default '' check(length(notes)<=10000),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check(ended_on is null or started_on is null or ended_on>=started_on),
  check(employment_status<>'current' or ended_on is null)
);
create index crm_affiliations_account on one_account.crm_affiliations(account_id,person_id);
create index crm_affiliations_person on one_account.crm_affiliations(person_id);
create table one_account.crm_contact_points (
  contact_point_id text primary key,
  person_id text not null references one_account.crm_persons,
  affiliation_id text references one_account.crm_affiliations,
  kind text not null check(kind in ('mobile','phone','email','address','postcode')),
  value text not null check(length(value) between 1 and 3000),
  verification_status text not null default 'unverified' check(verification_status in ('source_reported','unverified','conflict','verified')),
  source_record_id text references one_account.crm_source_records,
  notes text not null default '' check(length(notes)<=10000),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index crm_contacts_person on one_account.crm_contact_points(person_id);
create table one_account.crm_gift_campaigns (
  campaign_id text primary key, name text not null, year integer not null check(year between 1900 and 2200),
  occasion text not null, created_at timestamptz not null default clock_timestamp()
);
create table one_account.crm_gift_items (
  item_id text primary key, name text not null,
  unit_price numeric(16,2) check(unit_price>=0), currency text not null default 'KRW'
);
create table one_account.crm_gift_recipients (
  recipient_id text primary key, campaign_id text not null references one_account.crm_gift_campaigns,
  person_id text not null references one_account.crm_persons, affiliation_id text references one_account.crm_affiliations,
  item_id text references one_account.crm_gift_items,
  plan_status text not null default 'proposed' check(plan_status in ('listed','proposed','cancelled')),
  delivery_status text not null default 'unknown' check(delivery_status in ('unknown','not_sent','sent','returned','cancelled')),
  received_status text not null default 'unknown' check(received_status in ('unknown','received','not_received','declined')),
  planned_amount numeric(16,2) check(planned_amount>=0), actual_amount numeric(16,2) check(actual_amount>=0),
  sent_on date, received_on date,
  source_record_id text references one_account.crm_source_records,
  notes text not null default '' check(length(notes)<=10000),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check(sent_on is null or delivery_status='sent'), check(received_on is null or received_status='received')
);
create index crm_gifts_person on one_account.crm_gift_recipients(person_id,campaign_id);
create table one_account.crm_receiving_preferences (
  preference_id text primary key, person_id text not null references one_account.crm_persons,
  affiliation_id text references one_account.crm_affiliations, campaign_id text references one_account.crm_gift_campaigns,
  availability text not null default 'unknown' check(availability in ('yes','no','unknown','not_applicable')),
  scope text not null default 'unknown' check(scope in ('campaign','ongoing','unknown')),
  effective_from date, effective_to date,
  source_record_id text references one_account.crm_source_records,
  notes text not null default '' check(length(notes)<=10000),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check(scope<>'campaign' or campaign_id is not null),
  check(scope<>'ongoing' or campaign_id is null),
  check(effective_to is null or effective_from is null or effective_to>=effective_from)
);
create index crm_preferences_person on one_account.crm_receiving_preferences(person_id);
create table one_account.crm_life_events (
  event_id text primary key, person_id text not null references one_account.crm_persons,
  affiliation_id text references one_account.crm_affiliations,
  event_type text not null check(event_type in ('birthday','wedding','bereavement','anniversary','other')),
  event_date date, recurring boolean not null default false,
  calendar text not null default 'unknown' check(calendar in ('solar','lunar','unknown')),
  description text not null default '' check(length(description)<=2000),
  notes text not null default '' check(length(notes)<=10000),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index crm_events_person on one_account.crm_life_events(person_id);
create table one_account.crm_field_claims (
  claim_id text primary key, entity_type text not null, entity_id text not null,
  field_name text not null, value jsonb,
  source_record_id text not null references one_account.crm_source_records,
  verification_status text not null default 'source_reported', notes text not null default ''
);
create index crm_claims_entity on one_account.crm_field_claims(entity_type,entity_id);
create table one_account.crm_audit (
  audit_id bigint generated always as identity primary key,
  entity_type text not null, entity_id text not null, revision bigint not null,
  actor_email text not null, action text not null check(action in ('create','update')),
  before_record jsonb, after_record jsonb not null,
  request_id uuid not null, created_at timestamptz not null default clock_timestamp(),
  unique(entity_type,entity_id,revision)
);
create table one_account.crm_commit_requests (
  request_id uuid primary key, actor_email text not null,
  request_hash text not null, result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

-- A person-linked row must never borrow an unrelated person's affiliation.
create function one_account._crm_check_affiliation()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.affiliation_id is not null and not exists(select 1 from one_account.crm_affiliations a
    where a.affiliation_id=new.affiliation_id and a.person_id=new.person_id) then
    raise exception 'Affiliation does not belong to person' using errcode='22023';
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['crm_contact_points','crm_gift_recipients','crm_receiving_preferences','crm_life_events'] loop
    execute format('create trigger affiliation_owner before insert or update on one_account.%I for each row execute function one_account._crm_check_affiliation()',t);
  end loop;
  foreach t in array array['crm_import_batches','crm_sources','crm_source_records','crm_field_claims','crm_audit','crm_commit_requests'] loop
    execute format('create trigger immutable before update or delete on one_account.%I for each row execute function one_account._reject_history_mutation()',t);
  end loop;
  for t in select tablename from pg_tables where schemaname='one_account' and tablename like 'crm\_%' escape '\' loop
    execute format('alter table one_account.%I enable row level security',t);
    execute format('revoke all on table one_account.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

-- Stable baseline catalog remains immutable; newly registered accounts are an
-- additive overlay only for the production RM dataset.
create function one_account._effective_catalogs(p_dataset_id text,p_catalogs jsonb)
returns jsonb language sql stable set search_path='' as $$
  select case when p_dataset_id='rm-v1.7' then jsonb_set(p_catalogs,'{accounts}',
    coalesce((select jsonb_object_agg(account_id,name) from one_account.crm_accounts),'{}'::jsonb)
      || (p_catalogs->'accounts')) else p_catalogs end;
$$;
-- Preserve the original function body and change only the local catalog copy.
do $$ declare body text; needle text := 'select * into strict v_dataset from one_account.datasets where dataset_id = p_dataset_id;'; begin
  body := pg_get_functiondef('public.oa_commit_state(text,bigint,jsonb,text,uuid,text,bigint)'::regprocedure);
  if position(needle in body)=0 then raise exception 'Unexpected RM commit definition; inspect before migration'; end if;
  body := replace(body,needle,needle || E'\n  v_dataset.catalogs := one_account._effective_catalogs(p_dataset_id, v_dataset.catalogs);');
  execute body;
end $$;

-- Runtime read contracts intentionally exclude raw source cells and contact
-- values from catalog/search responses. Details require the existing session.
create function one_account._crm_people(p_account_id text)
returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'affiliation_id',a.affiliation_id,'person_id',p.person_id,'name',p.name,'identity_status',p.identity_status,
   'account_id',a.account_id,'department',a.department,'title',a.title,'employment_status',a.employment_status,
   'started_on',a.started_on,'ended_on',a.ended_on,'notes',a.notes,'revision',a.revision,
   'contact_points',coalesce((select jsonb_agg(to_jsonb(c) order by c.kind,c.contact_point_id) from one_account.crm_contact_points c where c.person_id=p.person_id and (c.affiliation_id is null or c.affiliation_id=a.affiliation_id)),'[]'::jsonb),
   'receiving_preferences',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from one_account.crm_receiving_preferences r where r.person_id=p.person_id and (r.affiliation_id is null or r.affiliation_id=a.affiliation_id)),'[]'::jsonb),
   'gift_recipients',coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object('campaign_name',k.name,'item_name',i.name,'gift_name',i.name,'unit_price',i.unit_price,'currency',i.currency) order by k.year desc,g.recipient_id) from one_account.crm_gift_recipients g join one_account.crm_gift_campaigns k using(campaign_id) left join one_account.crm_gift_items i using(item_id) where g.person_id=p.person_id and (g.affiliation_id is null or g.affiliation_id=a.affiliation_id)),'[]'::jsonb)
 ) order by a.department,a.title,p.name,a.affiliation_id),'[]'::jsonb)
 from one_account.crm_affiliations a join one_account.crm_persons p using(person_id)
 join one_account.crm_accounts c on c.account_id=a.account_id
 where coalesce(c.contact_account_id,c.account_id)=(select coalesce(contact_account_id,account_id) from one_account.crm_accounts where account_id=p_account_id);
$$;
create function public.oa_crm_read(p_action text,p_id text default null,p_query text default null,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_record jsonb; v_people jsonb; v_ids text[]; v_records jsonb;
begin
 if p_action='catalog' then
   return jsonb_build_object('status','ok','accounts',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('people_count',(select count(distinct f.person_id) from one_account.crm_affiliations f join one_account.crm_accounts c on c.account_id=f.account_id where coalesce(c.contact_account_id,c.account_id)=coalesce(a.contact_account_id,a.account_id))) order by a.name),'[]'::jsonb) from one_account.crm_accounts a),
     'campaigns',(select coalesce(jsonb_agg(to_jsonb(c) order by year desc),'[]'::jsonb) from one_account.crm_gift_campaigns c),
     'items',(select coalesce(jsonb_agg(to_jsonb(i) order by name),'[]'::jsonb) from one_account.crm_gift_items i),
     'totals',jsonb_build_object('accounts',(select count(*) from one_account.crm_accounts),'persons',(select count(*) from one_account.crm_persons),'affiliations',(select count(*) from one_account.crm_affiliations),'needs_review',(select count(*) from one_account.crm_persons where identity_status='needs_review')));
 elsif p_action='account' then
   select to_jsonb(a) into v_record from one_account.crm_accounts a where account_id=p_id;
   if v_record is null then raise exception 'Unknown account' using errcode='P0002'; end if;
   return jsonb_build_object('status','ok','account',v_record,'people',one_account._crm_people(p_id));
 elsif p_action='search' then
   if p_query is null or length(p_query) not between 1 and 200 or p_limit not between 1 and 200 then raise exception 'Invalid search' using errcode='22023'; end if;
   select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into v_people from (
     select p.person_id,p.name,a.account_id,c.name account_name,a.affiliation_id,a.department,a.title,a.employment_status
     from one_account.crm_persons p join one_account.crm_affiliations a using(person_id) join one_account.crm_accounts c using(account_id)
     where position(lower(p_query) in lower(p.name||' '||a.department||' '||a.title||' '||c.name))>0 order by c.name,p.name,a.affiliation_id limit p_limit+1
   ) s;
   return jsonb_build_object('status','ok','people',case when jsonb_array_length(v_people)>p_limit then v_people-p_limit else v_people end,'truncated',jsonb_array_length(v_people)>p_limit);
 elsif p_action='person' then
   select to_jsonb(p) into v_record from one_account.crm_persons p where person_id=p_id;
   if v_record is null then raise exception 'Unknown person' using errcode='P0002'; end if;
   select array_agg(id) into v_ids from (
      select p_id id union select affiliation_id from one_account.crm_affiliations where person_id=p_id
      union select contact_point_id from one_account.crm_contact_points where person_id=p_id
      union select recipient_id from one_account.crm_gift_recipients where person_id=p_id
      union select preference_id from one_account.crm_receiving_preferences where person_id=p_id
   ) s;
   select coalesce(jsonb_agg(jsonb_build_object('source_record_id',r.source_record_id,'file_name',s.file_name,'sha256',s.sha256,'sheet_name',r.sheet_name,'row_number',r.row_number)),'[]'::jsonb) into v_records
     from one_account.crm_source_records r join one_account.crm_sources s using(source_id)
     where r.source_record_id in (select source_record_id from one_account.crm_field_claims where entity_id=any(v_ids)
       union select source_record_id from one_account.crm_contact_points where person_id=p_id
       union select source_record_id from one_account.crm_gift_recipients where person_id=p_id
       union select source_record_id from one_account.crm_receiving_preferences where person_id=p_id);
   return jsonb_build_object('status','ok','person',v_record,
    'affiliations',(select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('account_name',c.name,'piscfh',c.piscfh) order by a.created_at),'[]'::jsonb) from one_account.crm_affiliations a join one_account.crm_accounts c using(account_id) where person_id=p_id),
    'contact_points',(select coalesce(jsonb_agg(to_jsonb(c) order by kind),'[]'::jsonb) from one_account.crm_contact_points c where person_id=p_id),
    'receiving_preferences',(select coalesce(jsonb_agg(to_jsonb(r) order by created_at desc),'[]'::jsonb) from one_account.crm_receiving_preferences r where person_id=p_id),
    'life_events',(select coalesce(jsonb_agg(to_jsonb(e) order by event_date desc nulls last),'[]'::jsonb) from one_account.crm_life_events e where person_id=p_id),
    'gift_recipients',(select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object('campaign_name',c.name,'item_name',i.name,'gift_name',i.name,'unit_price',i.unit_price,'currency',i.currency) order by c.year desc),'[]'::jsonb) from one_account.crm_gift_recipients g join one_account.crm_gift_campaigns c using(campaign_id) left join one_account.crm_gift_items i using(item_id) where person_id=p_id),
    'field_claims',(select coalesce(jsonb_agg(to_jsonb(c) order by entity_type,field_name),'[]'::jsonb) from one_account.crm_field_claims c where entity_id=any(v_ids)),
    'source_records',v_records,
    'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) from (select audit_id,entity_type,entity_id,revision,actor_email,action,created_at from one_account.crm_audit where entity_id=any(v_ids) order by created_at desc limit 100) a));
 end if;
 raise exception 'Invalid action' using errcode='22023';
end $$;

-- All dynamic identifiers come from this fixed contract, never from a caller.
create function one_account._crm_entity(p_entity text)
returns jsonb language sql immutable set search_path='' as $$
 select case p_entity
 when 'person' then '{"table":"crm_persons","pk":"person_id","fields":["name","identity_status","notes"]}'::jsonb
 when 'affiliation' then '{"table":"crm_affiliations","pk":"affiliation_id","fields":["department","title","employment_status","started_on","ended_on","notes"],"create_fields":["person_id","account_id","department","title","employment_status","started_on","ended_on","notes"]}'::jsonb
 when 'contact_point' then '{"table":"crm_contact_points","pk":"contact_point_id","fields":["kind","value","verification_status","notes"],"create_fields":["person_id","affiliation_id","kind","value","verification_status","notes"]}'::jsonb
 when 'preference' then '{"table":"crm_receiving_preferences","pk":"preference_id","fields":["availability","scope","campaign_id","effective_from","effective_to","notes"],"create_fields":["person_id","affiliation_id","availability","scope","campaign_id","effective_from","effective_to","notes"]}'::jsonb
 when 'life_event' then '{"table":"crm_life_events","pk":"event_id","fields":["event_type","event_date","recurring","calendar","description","notes"],"create_fields":["person_id","affiliation_id","event_type","event_date","recurring","calendar","description","notes"]}'::jsonb
 when 'gift_recipient' then '{"table":"crm_gift_recipients","pk":"recipient_id","fields":["item_id","plan_status","delivery_status","received_status","planned_amount","actual_amount","sent_on","received_on","notes"],"create_fields":["person_id","affiliation_id","campaign_id","item_id","plan_status","delivery_status","received_status","planned_amount","actual_amount","sent_on","received_on","notes"]}'::jsonb
 end;
$$;
create function public.oa_crm_commit(p_action text,p_entity text,p_id text,p_expected_revision bigint,p_patch jsonb,p_actor_email text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg jsonb; allowed jsonb; before_row jsonb; after_row jsonb; result jsonb; old_request one_account.crm_commit_requests%rowtype; hash text; cols text; vals text; sets text; pk text; tab text;
begin
 if p_action not in ('create','update') or p_id is null or length(p_id) not between 1 and 200
   or p_request_id is null or p_actor_email is null or p_actor_email !~ '^[a-z0-9._%+-]+@igisam[.]com$'
   or jsonb_typeof(p_patch) is distinct from 'object' or octet_length(p_patch::text)>60000
   or p_expected_revision is null or (p_action='update' and p_expected_revision<1) or (p_action='create' and p_expected_revision<>0) then
   raise exception 'Invalid CRM mutation' using errcode='22023';
 end if;
 cfg := one_account._crm_entity(p_entity); tab:=cfg->>'table'; pk:=cfg->>'pk';
 allowed := case when p_action='create' then cfg->'create_fields' else cfg->'fields' end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_patch) k where not allowed ? k) or p_patch='{}'::jsonb then raise exception 'Unsupported CRM field' using errcode='22023'; end if;
 hash:=encode(sha256(convert_to(jsonb_build_object('action',p_action,'entity',p_entity,'id',p_id,'revision',p_expected_revision,'patch',p_patch,'actor',p_actor_email)::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into old_request from one_account.crm_commit_requests where request_id=p_request_id;
 if found then
   if old_request.actor_email<>p_actor_email or old_request.request_hash<>hash then raise exception 'Request id reuse' using errcode='22023'; end if;
   return old_request.result||jsonb_build_object('status','replayed','original_status',old_request.result->>'status');
 end if;
 -- Serialize creates and updates for one record independently of request retries.
 perform pg_advisory_xact_lock(hashtextextended(tab||':'||p_id,0));
 execute format('select to_jsonb(t) from one_account.%I t where %I=$1 for update',tab,pk) into before_row using p_id;
 if p_action='update' and before_row is null then raise exception 'Unknown CRM record' using errcode='P0002'; end if;
 if (p_action='create' and before_row is not null) or (p_action='update' and (before_row->>'revision')::bigint<>p_expected_revision) then
   return jsonb_build_object('status','conflict','record',before_row,'revision',(before_row->>'revision')::bigint);
 end if;
 if p_action='update' and before_row||p_patch=before_row then
   result:=jsonb_build_object('status','noop','record',before_row,'revision',p_expected_revision);
 else
   if p_action='create' then
     p_patch:=p_patch||jsonb_build_object(pk,p_id);
     select string_agg(format('%I',k),',' order by k),string_agg(format('r.%I',k),',' order by k) into cols,vals from jsonb_object_keys(p_patch) k;
     execute format('insert into one_account.%I (%s) select %s from jsonb_populate_record(null::one_account.%I,$1) r returning to_jsonb(%I)',tab,cols,vals,tab,tab) into after_row using p_patch;
   else
     select string_agg(format('%I=r.%I',k,k),',' order by k) into sets from jsonb_object_keys(p_patch) k;
     execute format('update one_account.%I t set %s,revision=t.revision+1,updated_at=clock_timestamp() from jsonb_populate_record(null::one_account.%I,$1) r where t.%I=$2 returning to_jsonb(t)',tab,sets,tab,pk) into after_row using p_patch,p_id;
   end if;
   insert into one_account.crm_audit(entity_type,entity_id,revision,actor_email,action,before_record,after_record,request_id)
     values(p_entity,p_id,(after_row->>'revision')::bigint,p_actor_email,p_action,before_row,after_row,p_request_id);
   result:=jsonb_build_object('status','committed','record',after_row,'revision',(after_row->>'revision')::bigint);
 end if;
 insert into one_account.crm_commit_requests(request_id,actor_email,request_hash,result) values(p_request_id,p_actor_email,hash,result);
 return result;
end $$;

-- Bulk import is service-only and deliberately has no HTTP application route.
-- Existing identities/user edits are retained; every immutable source claim is
-- inserted by its stable ID. A batch ID cannot be reused for a different payload.
create function public.oa_crm_import(p_payload jsonb,p_actor_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch text; digest text; old_batch one_account.crm_import_batches%rowtype; spec jsonb; rows jsonb; defaults jsonb; k text; tab text; pk text; cols text; vals text; counts jsonb:='{}'; inserted integer;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or p_payload->>'schema_version' is distinct from '1' or octet_length(p_payload::text)>50000000
   or p_actor_email is null or p_actor_email !~ '^[a-z0-9._%+-]+@igisam[.]com$' then raise exception 'Invalid import' using errcode='22023'; end if;
 batch:=p_payload->>'batch_id';
 if batch is null or length(batch) not between 1 and 200 or coalesce(p_payload->>'manifest_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid manifest' using errcode='22023'; end if;
 digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('crm_import',0));
 select * into old_batch from one_account.crm_import_batches where batch_id=batch;
 if found then
   if old_batch.payload_sha256<>digest then raise exception 'Import batch payload changed' using errcode='22023'; end if;
   return jsonb_build_object('status','replayed','batch_id',batch,'counts',old_batch.counts);
 end if;
 for spec in select value from jsonb_array_elements('[
  {"key":"sources","pk":"source_id"},{"key":"source_records","pk":"source_record_id"},
  {"key":"accounts","pk":"account_id"},{"key":"persons","pk":"person_id"},{"key":"affiliations","pk":"affiliation_id"},
  {"key":"contact_points","pk":"contact_point_id"},{"key":"gift_campaigns","pk":"campaign_id"},{"key":"gift_items","pk":"item_id"},
  {"key":"gift_recipients","pk":"recipient_id"},{"key":"receiving_preferences","pk":"preference_id"},{"key":"life_events","pk":"event_id"},{"key":"field_claims","pk":"claim_id"}
 ]'::jsonb) loop
   k:=spec->>'key';
   if jsonb_typeof(coalesce(p_payload->k,'[]'::jsonb))<>'array' then raise exception 'Invalid import collection' using errcode='22023'; end if;
   counts:=counts||jsonb_build_object(k,jsonb_array_length(coalesce(p_payload->k,'[]'::jsonb)));
 end loop;
 insert into one_account.crm_import_batches(batch_id,manifest_sha256,payload_sha256,actor_email,counts)
   values(batch,p_payload->>'manifest_sha256',digest,p_actor_email,counts);
 for spec in select value from jsonb_array_elements('[
  {"key":"sources","pk":"source_id"},{"key":"source_records","pk":"source_record_id"},
  {"key":"accounts","pk":"account_id"},{"key":"persons","pk":"person_id"},{"key":"affiliations","pk":"affiliation_id"},
  {"key":"contact_points","pk":"contact_point_id"},{"key":"gift_campaigns","pk":"campaign_id"},{"key":"gift_items","pk":"item_id"},
  {"key":"gift_recipients","pk":"recipient_id"},{"key":"receiving_preferences","pk":"preference_id"},{"key":"life_events","pk":"event_id"},{"key":"field_claims","pk":"claim_id"}
 ]'::jsonb) loop
  k:=spec->>'key'; tab:='crm_'||k; pk:=spec->>'pk'; inserted:=0; rows:=coalesce(p_payload->k,'[]'::jsonb);
  if exists(select 1 from jsonb_array_elements(rows) r where jsonb_typeof(r)<>'object' or coalesce(r->>pk,'')='' or r ?| array['created_at','updated_at','revision','imported_batch_id']) then raise exception 'Invalid import row' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(rows) r group by r->>pk having count(*)>1) then raise exception 'Duplicate import identity' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(rows) r cross join lateral jsonb_object_keys(r) f where not exists(select 1 from information_schema.columns c where c.table_schema='one_account' and c.table_name=tab and c.column_name=f)) then raise exception 'Unsupported import field' using errcode='22023'; end if;
  if k='gift_recipients' and exists(select 1 from jsonb_array_elements(rows) r where coalesce(r->>'delivery_status','unknown')<>'unknown' or coalesce(r->>'received_status','unknown')<>'unknown' or r->>'actual_amount' is not null or r->>'sent_on' is not null or r->>'received_on' is not null) then raise exception 'Source list is not actual delivery evidence' using errcode='22023'; end if;
  if k='receiving_preferences' and exists(select 1 from jsonb_array_elements(rows) r where r->>'scope'='ongoing') then raise exception 'Imported gift list cannot establish permanent preference' using errcode='22023'; end if;
  defaults:=case k
   when 'sources' then jsonb_build_object('imported_batch_id',batch)
   when 'accounts' then '{"piscfh":"미분류","aliases":[],"is_existing":false,"is_placeholder":false}'::jsonb
   when 'persons' then '{"identity_status":"unverified","notes":""}'::jsonb
   when 'affiliations' then '{"department":"","title":"","employment_status":"unknown","notes":""}'::jsonb
   when 'contact_points' then '{"verification_status":"unverified","notes":""}'::jsonb
   when 'gift_items' then '{"currency":"KRW"}'::jsonb
   when 'gift_recipients' then '{"plan_status":"proposed","delivery_status":"unknown","received_status":"unknown","notes":""}'::jsonb
   when 'receiving_preferences' then '{"availability":"unknown","scope":"unknown","notes":""}'::jsonb
   when 'life_events' then '{"recurring":false,"calendar":"unknown","description":"","notes":""}'::jsonb
   when 'field_claims' then '{"verification_status":"source_reported","notes":""}'::jsonb
   else '{}'::jsonb end;
  if jsonb_array_length(rows)>0 then
   select jsonb_agg(defaults||r) into rows from jsonb_array_elements(rows) r;
   select string_agg(format('%I',f),',' order by f),string_agg(format('r.%I',f),',' order by f) into cols,vals from (select distinct f from jsonb_array_elements(rows) r cross join lateral jsonb_object_keys(r) f) fields;
   execute format('insert into one_account.%I (%s) select %s from jsonb_populate_recordset(null::one_account.%I,$1) r on conflict (%I) do nothing',tab,cols,vals,tab,pk) using rows;
   get diagnostics inserted=row_count;
  end if;
  counts:=counts||jsonb_build_object(k||'_inserted',inserted);
 end loop;
 return jsonb_build_object('status','imported','batch_id',batch,'counts',counts);
end $$;

revoke all on all functions in schema one_account from public,anon,authenticated,service_role;
revoke all on all sequences in schema one_account from public,anon,authenticated,service_role;
revoke all on function public.oa_crm_read(text,text,text,integer) from public,anon,authenticated;
revoke all on function public.oa_crm_commit(text,text,text,bigint,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.oa_crm_import(jsonb,text) from public,anon,authenticated;
grant execute on function public.oa_crm_read(text,text,text,integer) to service_role;
grant execute on function public.oa_crm_commit(text,text,text,bigint,jsonb,text,uuid) to service_role;
grant execute on function public.oa_crm_import(jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
