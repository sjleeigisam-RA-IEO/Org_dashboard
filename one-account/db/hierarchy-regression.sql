-- Synthetic data and group operations are rolled back; real records are read only.
begin;
insert into one_account.crm_accounts(account_id,name,piscfh) values
 ('qa-h-A','Synthetic union A','I'),('qa-h-B','Synthetic central body','P'),('qa-h-alias','Synthetic A alias','I');
update one_account.crm_accounts set contact_account_id='qa-h-A' where account_id='qa-h-alias';
insert into one_account.crm_persons(person_id,name) values ('qa-h-person','Synthetic person'),('qa-h-person-alias','Synthetic alias person');
insert into one_account.crm_affiliations(affiliation_id,person_id,account_id,department,title) values
 ('qa-h-aff-A','qa-h-person','qa-h-A','Fixture department','Fixture title'),
 ('qa-h-aff-B','qa-h-person','qa-h-B','Fixture department','Fixture title'),
 ('qa-h-aff-alias','qa-h-person-alias','qa-h-alias','Fixture department','Fixture title');
do $$
declare
  batch uuid:='0590a58a-bd31-4b98-8028-a02cf924a1e8'; rows jsonb; group_row jsonb; result jsonb; result2 jsonb;
  rejected boolean; person_before jsonb; links_before jsonb; top_before bigint; physical_before bigint;
begin
  group_row:='{"account_id":"GROUP-QA-HIERARCHY","name":"Synthetic grouping","piscfh":"I","hierarchy_label":"Individual organizations","hierarchy_note":"Display grouping only; underlying legal entities and source records are preserved."}';
  rows:='[{"account_id":"qa-h-A","expected_revision":1,"expected_code":"I","hierarchy_label":"Local union","hierarchy_note":"Synthetic legal entity; preserve this account identity."},{"account_id":"qa-h-B","expected_revision":1,"expected_code":"P"}]';
  person_before:=public.oa_crm_read('person','qa-h-person');
  select jsonb_agg(to_jsonb(a) order by affiliation_id) into links_before from one_account.crm_affiliations a where affiliation_id like 'qa-h-%';
  select count(*),count(*) filter(where parent_account_id is null) into physical_before,top_before from one_account.crm_accounts;

  -- A late mismatch must roll back the group, first member and its audit.
  rejected:=false;
  begin perform one_account.apply_account_hierarchy(batch,'sjlee@igisam.com',group_row,jsonb_set(rows,'{1,expected_code}','"C"'));
  exception when sqlstate '40001' then rejected:=true; end;
  if not rejected or exists(select 1 from one_account.crm_accounts where account_id='GROUP-QA-HIERARCHY')
    or (select revision from one_account.crm_accounts where account_id='qa-h-A')<>1 then raise exception 'Atomic scope rollback failed'; end if;

  result:=one_account.apply_account_hierarchy(batch,'sjlee@igisam.com',group_row,rows);
  if result->>'members'<>'2' or (select count(*) from one_account.crm_accounts where parent_account_id='GROUP-QA-HIERARCHY')<>2 then raise exception 'Grouping failed'; end if;
  if (select piscfh from one_account.crm_accounts where account_id='qa-h-B')<>'P' then raise exception 'Original classification changed'; end if;
  if (select hierarchy_label from one_account.crm_accounts where account_id='qa-h-A')<>'Local union'
    or (select hierarchy_note from one_account.crm_accounts where account_id='qa-h-A')<>'Synthetic legal entity; preserve this account identity.'
    or (select hierarchy_label||hierarchy_note from one_account.crm_accounts where account_id='qa-h-B')<>'' then raise exception 'Member hierarchy metadata was lost'; end if;
  if one_account.apply_account_hierarchy(batch,'sjlee@igisam.com',group_row,rows)<>result then raise exception 'Replay failed'; end if;
  rejected:=false;
  begin perform one_account.apply_account_hierarchy(batch,'sjlee@igisam.com',group_row||'{"name":"Changed request"}',rows);
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'Batch reuse accepted'; end if;
  rejected:=false;
  begin perform one_account.apply_account_hierarchy('38a8dbb6-ceda-4e1e-978d-f3fd7317913d','sjlee@igisam.com',group_row||'{"account_id":"GROUP-QA-STALE"}',rows);
  exception when sqlstate '40001' then rejected:=true; end;
  if not rejected or exists(select 1 from one_account.crm_accounts where account_id='GROUP-QA-STALE') then raise exception 'Stale revision rollback failed'; end if;

  rejected:=false;
  begin update one_account.crm_accounts set parent_account_id=account_id where account_id='GROUP-QA-HIERARCHY';
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'Self cycle accepted'; end if;
  rejected:=false;
  begin update one_account.crm_accounts set parent_account_id='qa-h-A' where account_id='GROUP-QA-HIERARCHY';
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'Nested cycle accepted'; end if;
  rejected:=false;
  begin update one_account.crm_accounts set parent_account_id=null where account_id='qa-h-A';
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'Silent regrouping accepted'; end if;
  rejected:=false;
  begin update one_account.crm_accounts set parent_account_id='qa-h-A' where account_id='qa-h-alias';
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'Organization used as parent'; end if;
  rejected:=false;
  begin insert into one_account.crm_affiliations(affiliation_id,person_id,account_id)
    values('qa-h-invalid-group-aff','qa-h-person','GROUP-QA-HIERARCHY');
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected or exists(select 1 from one_account.crm_affiliations where affiliation_id='qa-h-invalid-group-aff') then raise exception 'Display group accepted as employer'; end if;
  rejected:=false;
  begin update one_account.crm_affiliations set account_id='GROUP-QA-HIERARCHY' where affiliation_id='qa-h-aff-A';
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'Existing affiliation reassigned to display group'; end if;
  rejected:=false;
  begin update one_account.crm_accounts set account_kind='group' where account_id='qa-h-alias';
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'An employer converted into a display group'; end if;

  result2:=public.oa_crm_read('account','GROUP-QA-HIERARCHY');
  if jsonb_array_length(result2->'children')<>2 or jsonb_array_length(result2->'people')<>3
    or result2#>>'{account,people_count}'<>'2' then raise exception 'Group alias/person aggregation failed'; end if;
  if (select count(distinct p->>'affiliation_id') from jsonb_array_elements(result2->'people') p)<>3
    or exists(select 1 from jsonb_array_elements(result2->'people') p where p->>'account_name' is null)
    or (result2->'parent_account')<>'null'::jsonb then raise exception 'Group provenance failed'; end if;
  result2:=public.oa_crm_read('account','qa-h-A');
  if result2#>>'{parent_account,account_id}'<>'GROUP-QA-HIERARCHY' or jsonb_array_length(result2->'children')<>0
    or jsonb_array_length(result2->'people')<>2 then raise exception 'Individual account read regressed'; end if;
  result2:=public.oa_crm_read('catalog');
  if (result2#>>'{totals,accounts}')::bigint<>physical_before+1
    or (result2#>>'{totals,top_level_accounts}')::bigint<>top_before-1 then raise exception 'Physical/top-level counts incorrect'; end if;
  if public.oa_crm_read('person','qa-h-person')<>person_before
    or (select jsonb_agg(to_jsonb(a) order by affiliation_id) from one_account.crm_affiliations a where affiliation_id like 'qa-h-%')<>links_before then
    raise exception 'People or source affiliation records changed'; end if;
  if (select count(*) from one_account.crm_audit where request_id=batch)<>3 then raise exception 'Audits missing or duplicated'; end if;
  if has_function_privilege('service_role','one_account.apply_account_hierarchy(uuid,text,jsonb,jsonb)','EXECUTE')
    or has_function_privilege('service_role','one_account._crm_read_without_hierarchy(text,text,text,integer)','EXECUTE')
    or has_function_privilege('anon','public.oa_crm_read(text,text,text,integer)','EXECUTE')
    or not has_function_privilege('service_role','public.oa_crm_read(text,text,text,integer)','EXECUTE') then raise exception 'RPC privilege boundary regressed'; end if;
end $$;
select 'hierarchy regression passed' as result;
rollback;
