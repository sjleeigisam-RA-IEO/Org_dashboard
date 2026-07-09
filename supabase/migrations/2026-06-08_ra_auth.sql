-- RA Portal custom authentication tables.
-- Passwords and automatic-login tokens are never stored in plaintext.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.ra_user_credentials (
  staff_id text primary key references public.staff(staff_id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  password_salt text not null,
  hash_algo text not null default 'PBKDF2-SHA256',
  hash_iterations integer not null default 210000,
  password_set_at timestamptz not null default now(),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ra_setup_codes (
  code_id uuid primary key default extensions.gen_random_uuid(),
  label text not null,
  code_hash text not null unique,
  purpose text not null default 'password_setup',
  max_uses integer,
  use_count integer not null default 0,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ra_auth_sessions (
  session_id uuid primary key default extensions.gen_random_uuid(),
  staff_id text not null references public.staff(staff_id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists idx_ra_user_credentials_email on public.ra_user_credentials (lower(email));
create index if not exists idx_ra_auth_sessions_staff_id on public.ra_auth_sessions (staff_id);
create index if not exists idx_ra_auth_sessions_active on public.ra_auth_sessions (token_hash, expires_at) where revoked_at is null;
create index if not exists idx_ra_setup_codes_active on public.ra_setup_codes (code_hash) where revoked_at is null;

alter table public.ra_user_credentials enable row level security;
alter table public.ra_setup_codes enable row level security;
alter table public.ra_auth_sessions enable row level security;

-- Bootstrap setup/reset code.
-- This is only for first password setup/reset, not for regular login.
insert into public.ra_setup_codes (label, code_hash, purpose, max_uses, expires_at)
values (
  'bootstrap-default',
  'fc8626cbe559dc2f667a197deb043ea1820097c13ac9342fe0cabb49895ca1d1',
  'password_setup',
  null,
  null
)
on conflict (code_hash) do nothing;
