-- IOTA Platform RAG minimal setup
-- Safe design: does not modify existing iota_* tables and does not add foreign keys.
-- Embedding model target: Gemini embedding with output_dimensionality = 768.

create extension if not exists vector;

create table if not exists public.rag_chunks (
  id bigserial primary key,
  source_table text not null,
  source_id text not null,
  source_type text not null default 'work_log',
  chunk_index integer not null default 0,
  title text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(768),
  embedding_model text not null default 'gemini-embedding-768',
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_table, source_id, chunk_index)
);

comment on table public.rag_chunks is
  'Standalone RAG chunk table. Existing platform tables are only used as read-only sources.';

comment on column public.rag_chunks.source_table is
  'Original source table name, for example iota_seoul_logs.';

comment on column public.rag_chunks.source_id is
  'Original row id as text. No FK is used to avoid coupling with existing schema.';

comment on column public.rag_chunks.embedding is
  'Gemini embedding vector. Use output_dimensionality=768 when generating embeddings.';

alter table public.rag_chunks enable row level security;

drop policy if exists "rag_chunks_select_authenticated" on public.rag_chunks;
create policy "rag_chunks_select_authenticated"
on public.rag_chunks
for select
to authenticated
using (true);

create index if not exists rag_chunks_source_idx
on public.rag_chunks (source_table, source_id);

create index if not exists rag_chunks_embedding_idx
on public.rag_chunks
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

create or replace function public.match_rag_chunks(
  query_embedding vector(768),
  match_count integer default 8,
  source_table_filter text default null
)
returns table (
  id bigint,
  source_table text,
  source_id text,
  source_type text,
  chunk_index integer,
  title text,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    rc.id,
    rc.source_table,
    rc.source_id,
    rc.source_type,
    rc.chunk_index,
    rc.title,
    rc.content,
    rc.metadata,
    1 - (rc.embedding <=> query_embedding) as similarity
  from public.rag_chunks rc
  where rc.embedding is not null
    and (source_table_filter is null or rc.source_table = source_table_filter)
  order by rc.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_rag_chunks(vector, integer, text) to authenticated;

-- Quick verification after running this file:
-- select to_regclass('public.rag_chunks') as rag_chunks_table;
-- select proname from pg_proc where proname = 'match_rag_chunks';
