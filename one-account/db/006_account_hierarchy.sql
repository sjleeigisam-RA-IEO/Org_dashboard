-- Presentation groups preserve every underlying organization identity and record.
begin;
alter table one_account.crm_accounts
  add column parent_account_id text references one_account.crm_accounts(account_id),
  add column account_kind text not null default 'organization' check(account_kind in ('organization','group')),
  add column hierarchy_label text not null default '' check(length(hierarchy_label)<=200),
  add column hierarchy_note text not null default '' check(length(hierarchy_note)<=5000),
  add constraint crm_accounts_no_self_parent check(parent_account_id is distinct from account_id),
  add constraint crm_accounts_group_is_root check(account_kind<>'group' or parent_account_id is null);
create index crm_accounts_parent on one_account.crm_accounts(parent_account_id) where parent_account_id is not null;

-- One grouping level; alias/contact anchors remain independent of display groups.
create function one_account._crm_check_hierarchy()
returns trigger language plpgsql set search_path='' as $$
declare parent_row one_account.crm_accounts;
begin
  perform pg_advisory_xact_lock(hashtextextended('one_account.hierarchy',0));
  if tg_op='UPDATE' and old.parent_account_id is not null
    and new.parent_account_id is distinct from old.parent_account_id then
    raise exception 'Existing group membership cannot be reassigned' using errcode='22023';
  end if;
  if new.parent_account_id is not null then
    select * into parent_row from one_account.crm_accounts where account_id=new.parent_account_id;
    if not found or new.account_id=new.parent_account_id or new.account_kind<>'organization'
      or parent_row.account_kind<>'group' or parent_row.parent_account_id is not null then
      raise exception 'Group membership requires a distinct top-level group' using errcode='22023';
    end if;
  end if;
  if new.account_kind<>'group' and exists(select 1 from one_account.crm_accounts where parent_account_id=new.account_id) then
    raise exception 'An organization cannot parent other accounts' using errcode='22023';
  end if;
  if new.account_kind='group' and exists(select 1 from one_account.crm_affiliations where account_id=new.account_id) then
    raise exception 'An employer cannot be converted into a display group' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function one_account._crm_check_hierarchy() from public,anon,authenticated,service_role;
create trigger crm_check_hierarchy before insert or update of parent_account_id,account_kind on one_account.crm_accounts
  for each row execute function one_account._crm_check_hierarchy();

-- A display group is never an employer. Preserve real organizational affiliations.
create function one_account._crm_require_organization_affiliation()
returns trigger language plpgsql set search_path='' as $$
declare employer_kind text;
begin
  -- The row lock also serializes against a concurrent account-kind conversion.
  select account_kind into employer_kind from one_account.crm_accounts where account_id=new.account_id for share;
  if employer_kind='group' then
    raise exception 'Affiliations must belong to an organization, not a display group' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function one_account._crm_require_organization_affiliation() from public,anon,authenticated,service_role;
create trigger crm_require_organization_affiliation before insert or update of account_id on one_account.crm_affiliations
  for each row execute function one_account._crm_require_organization_affiliation();

create table one_account.crm_hierarchy_batches (
  batch_id uuid primary key, actor_email text not null, payload_sha256 text not null,
  result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table one_account.crm_hierarchy_batches enable row level security;
revoke all on one_account.crm_hierarchy_batches from public,anon,authenticated,service_role;
create trigger immutable before update or delete on one_account.crm_hierarchy_batches
  for each row execute function one_account._reject_history_mutation();

-- Operator-only, atomic, optimistic and idempotent. No client/API execute grant.
create function one_account.apply_account_hierarchy(p_batch_id uuid,p_actor text,p_group jsonb,p_members jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  member jsonb; old_row one_account.crm_accounts; new_row one_account.crm_accounts;
  previous one_account.crm_hierarchy_batches; payload_hash text; outcome jsonb; members_count integer:=0;
begin
  if p_batch_id is null or p_actor is null or p_actor !~ '^[a-z0-9._%+-]+@igisam[.]com$'
    or jsonb_typeof(p_group) is distinct from 'object' or jsonb_typeof(p_members) is distinct from 'array'
    or jsonb_array_length(p_members) not between 1 and 2000
    or coalesce(p_group->>'account_id','') !~ '^GROUP-[A-Z0-9-]{1,190}$'
    or coalesce(length(p_group->>'name'),0) not between 1 and 300
    or coalesce(p_group->>'piscfh','') not in ('P','I','S','C','F','H','미Account')
    or coalesce(length(p_group->>'hierarchy_label'),0) not between 1 and 200
    or coalesce(length(p_group->>'hierarchy_note'),0) not between 1 and 5000
    or exists(select 1 from jsonb_object_keys(p_group) k where k not in ('account_id','name','piscfh','hierarchy_label','hierarchy_note')) then
    raise exception 'Invalid hierarchy batch' using errcode='22023';
  end if;
  if (select count(distinct value->>'account_id') from jsonb_array_elements(p_members))<>jsonb_array_length(p_members) then
    raise exception 'Duplicate or missing member id' using errcode='22023';
  end if;
  payload_hash:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor,'group',p_group,'members',p_members)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('one_account.hierarchy',0));
  select * into previous from one_account.crm_hierarchy_batches where batch_id=p_batch_id;
  if found then
    if previous.payload_sha256<>payload_hash then raise exception 'Hierarchy batch id reuse' using errcode='22023'; end if;
    return previous.result;
  end if;
  if exists(select 1 from one_account.crm_accounts where account_id=p_group->>'account_id') then
    raise exception 'Group account already exists' using errcode='40001';
  end if;
  insert into one_account.crm_accounts(account_id,name,piscfh,account_kind,hierarchy_label,hierarchy_note)
    values(p_group->>'account_id',p_group->>'name',p_group->>'piscfh','group',p_group->>'hierarchy_label',p_group->>'hierarchy_note') returning * into new_row;
  insert into one_account.crm_audit(entity_type,entity_id,revision,actor_email,action,before_record,after_record,request_id)
    values('account',new_row.account_id,new_row.revision,p_actor,'create',null,to_jsonb(new_row),p_batch_id);
  for member in select value from jsonb_array_elements(p_members) order by value->>'account_id' loop
    if jsonb_typeof(member) is distinct from 'object'
      or coalesce(length(member->>'account_id'),0) not between 1 and 200
      or coalesce(member->>'expected_revision','') !~ '^[1-9][0-9]*$'
      or coalesce(member->>'expected_code','') not in ('P','I','S','C','F','H','비Account','미분류','미Account')
      or (member ? 'hierarchy_label' and (jsonb_typeof(member->'hierarchy_label') is distinct from 'string' or length(member->>'hierarchy_label')>200))
      or (member ? 'hierarchy_note' and (jsonb_typeof(member->'hierarchy_note') is distinct from 'string' or length(member->>'hierarchy_note')>5000))
      or exists(select 1 from jsonb_object_keys(member) k where k not in ('account_id','expected_revision','expected_code','hierarchy_label','hierarchy_note')) then
      raise exception 'Invalid hierarchy member' using errcode='22023';
    end if;
    select * into old_row from one_account.crm_accounts where account_id=member->>'account_id' for update;
    if not found or old_row.revision<>(member->>'expected_revision')::bigint or old_row.piscfh<>member->>'expected_code' then
      raise exception 'Hierarchy member revision or scope conflict' using errcode='40001';
    end if;
    if old_row.account_kind<>'organization' or old_row.parent_account_id is not null then
      raise exception 'Only ungrouped organizations can join a new group' using errcode='22023';
    end if;
    update one_account.crm_accounts set parent_account_id=p_group->>'account_id',
      hierarchy_label=coalesce(member->>'hierarchy_label',''),hierarchy_note=coalesce(member->>'hierarchy_note',''),
      revision=revision+1,updated_at=clock_timestamp()
      where account_id=old_row.account_id returning * into new_row;
    insert into one_account.crm_audit(entity_type,entity_id,revision,actor_email,action,before_record,after_record,request_id)
      values('account',new_row.account_id,new_row.revision,p_actor,'update',to_jsonb(old_row),to_jsonb(new_row),p_batch_id);
    members_count:=members_count+1;
  end loop;
  outcome:=jsonb_build_object('status','ok','batch_id',p_batch_id,'group_account_id',p_group->>'account_id','members',members_count);
  insert into one_account.crm_hierarchy_batches(batch_id,actor_email,payload_sha256,result) values(p_batch_id,p_actor,payload_hash,outcome);
  return outcome;
end $$;
revoke all on function one_account.apply_account_hierarchy(uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Account and contact identity mappings are separate; this includes aliases of
-- every member without combining affiliations or inventing a group employment.
create function one_account._crm_group_contact_anchors(p_account_id text)
returns table(contact_anchor text) language sql stable set search_path='' as $$
  select distinct coalesce(m.contact_account_id,m.account_id)
  from one_account.crm_accounts root join one_account.crm_accounts m
    on m.account_id=root.account_id or (root.account_kind='group' and m.parent_account_id=root.account_id)
  where root.account_id=p_account_id;
$$;
revoke all on function one_account._crm_group_contact_anchors(text) from public,anon,authenticated,service_role;

create function one_account._crm_account_summary(p_account_id text)
returns jsonb language sql stable set search_path='' as $$
  select to_jsonb(a)||jsonb_build_object(
    'children_count',(select count(*) from one_account.crm_accounts child where child.parent_account_id=a.account_id),
    'people_count',(select count(distinct f.person_id) from one_account.crm_affiliations f
      join one_account.crm_accounts c on c.account_id=f.account_id
      where coalesce(c.contact_account_id,c.account_id) in (select contact_anchor from one_account._crm_group_contact_anchors(a.account_id))))
  from one_account.crm_accounts a where a.account_id=p_account_id;
$$;
revoke all on function one_account._crm_account_summary(text) from public,anon,authenticated,service_role;

-- Preserve migration 003's person/history behavior byte-for-byte in a private
-- helper, replacing only the catalog/account dispatch at the public boundary.
alter function public.oa_crm_read(text,text,text,integer) set schema one_account;
alter function one_account.oa_crm_read(text,text,text,integer) rename to _crm_read_without_hierarchy;
revoke all on function one_account._crm_read_without_hierarchy(text,text,text,integer) from public,anon,authenticated,service_role;
create function public.oa_crm_read(p_action text,p_id text default null,p_query text default null,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account_row one_account.crm_accounts; person_rows jsonb; result jsonb;
begin
  if p_action='catalog' then
    return jsonb_build_object('status','ok',
      'accounts',(select coalesce(jsonb_agg(one_account._crm_account_summary(a.account_id) order by a.name,a.account_id),'[]'::jsonb) from one_account.crm_accounts a),
      'campaigns',(select coalesce(jsonb_agg(to_jsonb(c) order by year desc),'[]'::jsonb) from one_account.crm_gift_campaigns c),
      'items',(select coalesce(jsonb_agg(to_jsonb(i) order by name),'[]'::jsonb) from one_account.crm_gift_items i),
      'totals',jsonb_build_object('accounts',(select count(*) from one_account.crm_accounts),
        'top_level_accounts',(select count(*) from one_account.crm_accounts where parent_account_id is null),
        'grouped_accounts',(select count(*) from one_account.crm_accounts where parent_account_id is not null),
        'groups',(select count(*) from one_account.crm_accounts where account_kind='group'),
        'persons',(select count(*) from one_account.crm_persons),'affiliations',(select count(*) from one_account.crm_affiliations),
        'needs_review',(select count(*) from one_account.crm_persons where identity_status='needs_review')));
  elsif p_action='account' then
    select * into account_row from one_account.crm_accounts where account_id=p_id;
    if not found then raise exception 'Unknown account' using errcode='P0002'; end if;
    -- _crm_people retains its source/affiliation-aware gift and contact rules.
    select coalesce(jsonb_agg(person_row order by person_row->>'account_name',person_row->>'department',person_row->>'title',person_row->>'name',person_row->>'affiliation_id'),'[]'::jsonb) into person_rows
      from (select distinct on (person->>'affiliation_id') person||jsonb_build_object('account_name',owner.name) person_row
        from one_account.crm_accounts a cross join lateral jsonb_array_elements(one_account._crm_people(a.account_id)) person
        join one_account.crm_accounts owner on owner.account_id=person->>'account_id'
        where a.account_id=p_id or (account_row.account_kind='group' and a.parent_account_id=p_id)
        order by person->>'affiliation_id',a.account_id) grouped_people;
    return jsonb_build_object('status','ok','account',one_account._crm_account_summary(p_id),'people',person_rows,
      'children',(select coalesce(jsonb_agg(one_account._crm_account_summary(a.account_id) order by a.name,a.account_id),'[]'::jsonb) from one_account.crm_accounts a where a.parent_account_id=p_id),
      'parent_account',one_account._crm_account_summary(account_row.parent_account_id));
  end if;
  return one_account._crm_read_without_hierarchy(p_action,p_id,p_query,p_limit);
end $$;
revoke all on function public.oa_crm_read(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.oa_crm_read(text,text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
