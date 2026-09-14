-- Synthetic fixtures are rolled back. No real Account is changed.
begin;
insert into one_account.crm_accounts(account_id,name,piscfh) values
 ('qa-class-A','Classification fixture','C'),('qa-class-B','Protected fixture','P');
do $$
declare rows jsonb; result jsonb; batch uuid:='848a6cc0-cdc8-428c-914c-313d8458a332'; rejected boolean;
begin
 rows:='[{"account_id":"qa-class-A","from_code":"C","to_code":"I","expected_revision":1,"reason":"Synthetic bank classification","subtype":"bank","source_urls":["https://example.invalid/"],"review_required":false,"evidence_date":"2026-09-14"}]';
 -- A late failure must roll back all earlier updates from the same call.
 rejected:=false;
 begin
   perform one_account.apply_classification_review(batch,'sjlee@igisam.com','qa',rows||jsonb_build_array((rows->0)||'{"account_id":"qa-class-B","from_code":"P"}'::jsonb));
 exception when sqlstate '22023' then rejected:=true; end;
 if not rejected or (select revision from one_account.crm_accounts where account_id='qa-class-A')<>1 then raise exception 'Scope rollback failed'; end if;
 result:=one_account.apply_classification_review(batch,'sjlee@igisam.com','qa',rows);
 if result->>'reviewed'<>'1' or (select piscfh from one_account.crm_accounts where account_id='qa-class-A')<>'I' then raise exception 'Apply failed'; end if;
 if one_account.apply_classification_review(batch,'sjlee@igisam.com','qa',rows)<>result then raise exception 'Replay failed'; end if;
 rejected:=false;
 begin perform one_account.apply_classification_review(batch,'sjlee@igisam.com','changed-rule',rows);
 exception when sqlstate '22023' then rejected:=true; end;
 if not rejected then raise exception 'Batch reuse not rejected'; end if;
 rejected:=false;
 begin perform one_account.apply_classification_review('47c9303c-d6cc-45fb-8c01-b16c1450c7e4','sjlee@igisam.com','qa',rows);
 exception when sqlstate '40001' then rejected:=true; end;
 if not rejected then raise exception 'Stale revision not rejected'; end if;
 if (select count(*) from one_account.crm_audit where entity_id='qa-class-A')<>1 then raise exception 'Audit duplicated'; end if;
 if has_function_privilege('service_role','one_account.apply_classification_review(uuid,text,text,jsonb)','EXECUTE') then raise exception 'Operator function exposed to API'; end if;
end $$;
select 'classification regression passed' as result;
rollback;
