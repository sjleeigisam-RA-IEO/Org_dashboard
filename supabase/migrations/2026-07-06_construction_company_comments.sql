create extension if not exists pgcrypto with schema extensions;

create table if not exists public.construction_company_comments (
  id uuid primary key default extensions.gen_random_uuid(),
  company_key text not null,
  company_name text,
  tab_id text,
  source text not null default 'user',
  author_name text,
  body text not null,
  created_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  constraint construction_company_comments_source_check
    check (source in ('user', 'pdf', 'system')),
  constraint construction_company_comments_body_check
    check (length(btrim(body)) between 1 and 1200),
  constraint construction_company_comments_author_check
    check (author_name is null or length(btrim(author_name)) between 1 and 80),
  constraint construction_company_comments_reserved_author_check
    check (source <> 'user' or coalesce(btrim(author_name), '') <> '개발솔루션센터 센터장')
);

create index if not exists idx_construction_company_comments_company
  on public.construction_company_comments (company_key, created_at desc)
  where is_deleted = false;

alter table public.construction_company_comments enable row level security;

drop policy if exists construction_company_comments_public_select
  on public.construction_company_comments;
create policy construction_company_comments_public_select
  on public.construction_company_comments
  for select
  to anon, authenticated
  using (is_deleted = false);

drop policy if exists construction_company_comments_public_insert
  on public.construction_company_comments;
create policy construction_company_comments_public_insert
  on public.construction_company_comments
  for insert
  to anon, authenticated
  with check (
    source = 'user'
    and is_deleted = false
    and length(btrim(body)) between 1 and 1200
    and (author_name is null or length(btrim(author_name)) between 1 and 80)
    and coalesce(btrim(author_name), '') <> '개발솔루션센터 센터장'
  );

grant select, insert on public.construction_company_comments to anon, authenticated;
