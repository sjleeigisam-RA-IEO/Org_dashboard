-- Keep the same import field allowlist, but read it once per table instead of
-- evaluating the information_schema view for every field of every source row.
begin;
do $$
declare body text; needle text;
begin
 body:=pg_get_functiondef('public.oa_crm_import(jsonb,text)'::regprocedure);
 needle:='counts jsonb:=''{}''; inserted integer;';
 if position(needle in body)=0 then raise exception 'Unexpected import declaration'; end if;
 body:=replace(body,needle,needle || ' allowed_columns text[];');
 needle:='k:=spec->>''key''; tab:=''crm_''||k; pk:=spec->>''pk''; inserted:=0; rows:=coalesce(p_payload->k,''[]''::jsonb);';
 if position(needle in body)=0 then raise exception 'Unexpected import collection loop'; end if;
 body:=replace(body,needle,needle || E'\n  select array_agg(a.attname::text) into allowed_columns from pg_catalog.pg_attribute a where a.attrelid=format(''one_account.%I'',tab)::regclass and a.attnum>0 and not a.attisdropped;');
 needle:='not exists(select 1 from information_schema.columns c where c.table_schema=''one_account'' and c.table_name=tab and c.column_name=f)';
 if position(needle in body)=0 then raise exception 'Unexpected import field validation'; end if;
 body:=replace(body,needle,'not (f=any(allowed_columns))');
 execute body;
end $$;
notify pgrst,'reload schema';
commit;
