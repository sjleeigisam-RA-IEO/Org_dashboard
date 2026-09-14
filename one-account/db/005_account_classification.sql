-- Account scope review only. No people or source assertions are rewritten.
begin;
alter table one_account.crm_accounts drop constraint crm_accounts_piscfh_check;
alter table one_account.crm_accounts add constraint crm_accounts_piscfh_check
  check(piscfh in ('P','I','S','C','F','H','비Account','미분류','미Account'));
alter table one_account.crm_accounts alter column piscfh set default '미Account';
alter table one_account.crm_accounts add column classification_review jsonb
  check(classification_review is null or jsonb_typeof(classification_review)='object');

create table one_account.crm_classification_batches (
  batch_id uuid primary key, actor_email text not null, rule_version text not null,
  payload_sha256 text not null, result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table one_account.crm_classification_batches enable row level security;
revoke all on one_account.crm_classification_batches from public,anon,authenticated,service_role;
create trigger immutable before update or delete on one_account.crm_classification_batches
  for each row execute function one_account._reject_history_mutation();

-- Invoker rights, private schema and no API grants: database operators only.
create function one_account.apply_classification_review(p_batch_id uuid,p_actor text,p_rule text,p_rows jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  row_data jsonb; old_row one_account.crm_accounts; new_row one_account.crm_accounts;
  previous one_account.crm_classification_batches; payload_hash text; outcome jsonb;
  reviewed_count integer:=0; changed_count integer:=0; review_info jsonb;
begin
  if p_batch_id is null or p_actor is null or p_actor !~ '^[a-z0-9._%+-]+@igisam[.]com$'
    or p_rule is null or length(p_rule) not between 1 and 100
    or p_rows is null or jsonb_typeof(p_rows)<>'array'
    or jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception 'Invalid classification batch' using errcode='22023';
  end if;
  payload_hash:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor,'rule',p_rule,'rows',p_rows)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('one_account.classification',0));
  select * into previous from one_account.crm_classification_batches where batch_id=p_batch_id;
  if found then
    if previous.payload_sha256<>payload_hash then raise exception 'Classification batch id reuse' using errcode='22023'; end if;
    return previous.result;
  end if;
  if (select count(distinct value->>'account_id') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then
    raise exception 'Duplicate or missing Account id' using errcode='22023';
  end if;
  for row_data in select value from jsonb_array_elements(p_rows) order by value->>'account_id' loop
    if jsonb_typeof(row_data)<>'object'
      or coalesce(row_data->>'from_code','') not in ('I','C','미분류','비Account','미Account')
      or coalesce(row_data->>'to_code','') not in ('I','C','미Account')
      or (row_data->>'from_code' in ('미분류','비Account','미Account') and row_data->>'to_code'<>'미Account')
      or coalesce(row_data->>'expected_revision','') !~ '^[1-9][0-9]*$'
      or coalesce(length(row_data->>'reason'),0) not between 1 and 5000
      or coalesce(length(row_data->>'subtype'),0) not between 1 and 200
      or jsonb_typeof(row_data->'source_urls') is distinct from 'array'
      or jsonb_typeof(row_data->'review_required') is distinct from 'boolean'
      or coalesce(row_data->>'evidence_date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Invalid classification decision' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(row_data->'source_urls') u
      where jsonb_typeof(u)<>'string' or (u#>>'{}') !~ '^https?://' or length(u#>>'{}')>3000) then
      raise exception 'Invalid evidence URL' using errcode='22023';
    end if;
    select * into old_row from one_account.crm_accounts where account_id=row_data->>'account_id' for update;
    if not found or old_row.piscfh<>row_data->>'from_code' or old_row.revision<>(row_data->>'expected_revision')::bigint then
      raise exception 'Account classification revision conflict' using errcode='40001';
    end if;
    review_info:=jsonb_build_object('rule_version',p_rule,'batch_id',p_batch_id,
      'previous_code',old_row.piscfh,'subtype',row_data->>'subtype','reason',row_data->>'reason',
      'source_urls',row_data->'source_urls','evidence_date',row_data->>'evidence_date',
      'review_required',row_data->'review_required','reviewed_at',clock_timestamp());
    update one_account.crm_accounts set piscfh=row_data->>'to_code',classification_review=review_info,
      revision=revision+1,updated_at=clock_timestamp() where account_id=old_row.account_id returning * into new_row;
    insert into one_account.crm_audit(entity_type,entity_id,revision,actor_email,action,before_record,after_record,request_id)
      values('account',old_row.account_id,new_row.revision,p_actor,'update',to_jsonb(old_row),to_jsonb(new_row),p_batch_id);
    reviewed_count:=reviewed_count+1;
    if old_row.piscfh<>new_row.piscfh then changed_count:=changed_count+1; end if;
  end loop;
  outcome:=jsonb_build_object('status','ok','batch_id',p_batch_id,'reviewed',reviewed_count,'changed',changed_count);
  insert into one_account.crm_classification_batches(batch_id,actor_email,rule_version,payload_sha256,result)
    values(p_batch_id,p_actor,p_rule,payload_hash,outcome);
  return outcome;
end $$;
revoke all on function one_account.apply_classification_review(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
commit;
