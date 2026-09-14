-- Show a person's gift history under every affiliation, with the gift's original
-- affiliation identified. Include life-event changes in the person audit trail.
begin;
do $$
declare body text; needle text;
begin
  body:=pg_get_functiondef('one_account._crm_people(text)'::regprocedure);
  needle:='where g.person_id=p.person_id and (g.affiliation_id is null or g.affiliation_id=a.affiliation_id)';
  if position(needle in body)=0 then raise exception 'Unexpected CRM people view'; end if;
  body:=replace(body,needle,'where g.person_id=p.person_id');
  needle:='''gift_name'',i.name,''unit_price'',i.unit_price,''currency'',i.currency';
  if position(needle in body)=0 then raise exception 'Unexpected CRM gift fields'; end if;
  body:=replace(body,needle,needle || ',''gift_account_id'',(select f.account_id from one_account.crm_affiliations f where f.affiliation_id=g.affiliation_id),''gift_account_name'',(select c.name from one_account.crm_affiliations f join one_account.crm_accounts c using(account_id) where f.affiliation_id=g.affiliation_id)');
  execute body;

  body:=pg_get_functiondef('public.oa_crm_read(text,text,text,integer)'::regprocedure);
  needle:='union select preference_id from one_account.crm_receiving_preferences where person_id=p_id';
  if position(needle in body)=0 then raise exception 'Unexpected CRM person identity list'; end if;
  body:=replace(body,needle,needle || E'\n      union select event_id from one_account.crm_life_events where person_id=p_id');
  needle:='''gift_name'',i.name,''unit_price'',i.unit_price,''currency'',i.currency';
  if position(needle in body)=0 then raise exception 'Unexpected CRM person gift fields'; end if;
  body:=replace(body,needle,needle || ',''gift_account_id'',(select f.account_id from one_account.crm_affiliations f where f.affiliation_id=g.affiliation_id),''gift_account_name'',(select x.name from one_account.crm_affiliations f join one_account.crm_accounts x using(account_id) where f.affiliation_id=g.affiliation_id)');
  execute body;
end $$;
notify pgrst,'reload schema';
commit;
