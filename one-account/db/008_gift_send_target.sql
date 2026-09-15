-- A campaign's sending decision is independent of list membership and actuals.
-- No personal values or bulk source reconciliation belong in this migration.
begin;

alter table one_account.crm_gift_recipients
  add column send_target text,
  add constraint crm_gift_recipients_send_target_check
    check(send_target in ('yes','no'));
comment on column one_account.crm_gift_recipients.send_target is
  '발송대상: yes=O, no=X, NULL=미확인(화면 빈칸). 해당 캠페인의 발송 결정이며 실제 발송·수령 사실이 아님.';

-- Existing rows and omitted import/create fields stay NULL. In particular,
-- plan_status=listed and receiving availability never imply send_target=yes.
do $$
declare body text; needle constant text := '"item_id","plan_status"';
begin
  body:=pg_get_functiondef('one_account._crm_entity(text)'::regprocedure);
  if (length(body)-length(replace(body,needle,'')))/length(needle)<>2
    or position('"send_target"' in body)>0 then
    raise exception 'Unexpected CRM gift mutable-field contract';
  end if;
  execute replace(body,needle,'"item_id","send_target","plan_status"');
end $$;

-- Enrich only the bounded search matches, never fetch an entire account for
-- each person. Use account-detail affiliation rules and person-wide gift history.
create function one_account._crm_search_details(p_person_id text,p_affiliation_id text)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'identity_status',p.identity_status,'started_on',a.started_on,'ended_on',a.ended_on,
    'notes',a.notes,'revision',a.revision,
    'contact_points',coalesce((
      select jsonb_agg(to_jsonb(c) order by c.kind,c.contact_point_id)
      from one_account.crm_contact_points c
      where c.person_id=p.person_id and (c.affiliation_id is null or c.affiliation_id=a.affiliation_id)
    ),'[]'::jsonb),
    'receiving_preferences',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
      from one_account.crm_receiving_preferences r
      where r.person_id=p.person_id and (r.affiliation_id is null or r.affiliation_id=a.affiliation_id)
    ),'[]'::jsonb),
    'gift_recipients',coalesce((
      select jsonb_agg(to_jsonb(g)||jsonb_build_object(
        'campaign_name',k.name,'item_name',i.name,'gift_name',i.name,'unit_price',i.unit_price,'currency',i.currency,
        'gift_account_id',f.account_id,'gift_account_name',owner.name
      ) order by k.year desc,g.recipient_id)
      from one_account.crm_gift_recipients g
      join one_account.crm_gift_campaigns k using(campaign_id)
      left join one_account.crm_gift_items i using(item_id)
      left join one_account.crm_affiliations f on f.affiliation_id=g.affiliation_id
      left join one_account.crm_accounts owner on owner.account_id=f.account_id
      where g.person_id=p.person_id
    ),'[]'::jsonb)
  )
  from one_account.crm_persons p join one_account.crm_affiliations a using(person_id)
  where p.person_id=p_person_id and a.affiliation_id=p_affiliation_id;
$$;
revoke all on function one_account._crm_search_details(text,text) from public,anon,authenticated,service_role;

-- Migration 006 moved the original search dispatch to this private helper.
-- Replace the output projection only: matching, sort, limit+1 and truncated
-- semantics remain unchanged. The public session-gated wrapper keeps its ACL.
do $$
declare body text; needle constant text := 'jsonb_agg(to_jsonb(s))';
begin
  body:=pg_get_functiondef('one_account._crm_read_without_hierarchy(text,text,text,integer)'::regprocedure);
  if (length(body)-length(replace(body,needle,'')))/length(needle)<>1
    or position('_crm_search_details' in body)>0 then
    raise exception 'Unexpected CRM search response contract';
  end if;
  execute replace(body,needle,'jsonb_agg(to_jsonb(s)||one_account._crm_search_details(s.person_id,s.affiliation_id))');
end $$;

notify pgrst,'reload schema';
commit;
