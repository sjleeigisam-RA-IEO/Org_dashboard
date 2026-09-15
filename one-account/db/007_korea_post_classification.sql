-- User-confirmed correction, 2026-09-15: Korea Post (deposit/insurance) is P.
-- Operator-only, exact-account data change. No permissions or RPCs are widened.
begin;
set local statement_timeout = '120s';
do $$
declare
  target_id constant text := 'ACCT-CAND-23BFCB386063';
  v_batch_id constant uuid := 'c39c9e91-fc64-4d55-bddc-83abcb97a215';
  actor constant text := 'sjlee@igisam.com';
  rule constant text := 'user-korea-post-P-20260915';
  old_row one_account.crm_accounts;
  new_row one_account.crm_accounts;
  prior one_account.crm_classification_batches;
  decision jsonb := jsonb_build_object(
    'account_id', target_id, 'from_code', 'S', 'to_code', 'P', 'expected_revision', 1,
    'subtype', '사용자 지정 P 기관',
    'reason', '사용자 재확인: 우정사업본부는 예금·보험 부문을 포함하여 P로 분류한다.',
    'source_urls', '[]'::jsonb, 'evidence_date', '2026-09-15', 'review_required', false);
  payload_hash text;
  outcome jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('one_account.classification', 0));
  payload_hash := encode(sha256(convert_to(jsonb_build_object(
    'actor', actor, 'rule', rule, 'rows', jsonb_build_array(decision))::text, 'UTF8')), 'hex');
  select * into prior from one_account.crm_classification_batches b where b.batch_id = v_batch_id;
  if found then
    if prior.payload_sha256 <> payload_hash then
      raise exception 'Korea Post classification batch id reuse' using errcode = '22023';
    end if;
    return;
  end if;
  select * into old_row from one_account.crm_accounts where account_id = target_id for update;
  if not found or old_row.name <> '우정사업본부' or old_row.piscfh <> 'S' or old_row.revision <> 1 then
    raise exception 'Korea Post classification revision conflict' using errcode = '40001';
  end if;
  update one_account.crm_accounts set piscfh = 'P',
    classification_review = jsonb_build_object(
      'rule_version', rule, 'batch_id', v_batch_id, 'previous_code', old_row.piscfh,
      'subtype', decision->>'subtype', 'reason', decision->>'reason',
      'source_urls', decision->'source_urls', 'evidence_date', decision->>'evidence_date',
      'review_required', false, 'reviewed_at', clock_timestamp()),
    revision = revision + 1, updated_at = clock_timestamp()
    where account_id = target_id returning * into new_row;
  insert into one_account.crm_audit(entity_type, entity_id, revision, actor_email,
    action, before_record, after_record, request_id)
    values ('account', target_id, new_row.revision, actor, 'update',
      to_jsonb(old_row), to_jsonb(new_row), v_batch_id);
  outcome := jsonb_build_object('status', 'ok', 'batch_id', v_batch_id, 'reviewed', 1, 'changed', 1);
  insert into one_account.crm_classification_batches(batch_id, actor_email, rule_version, payload_sha256, result)
    values (v_batch_id, actor, rule, payload_hash, outcome);
end $$;
commit;
