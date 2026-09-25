-- Legible: initial schema.
--
-- The app talks to Postgres from the server only (DATABASE_URL). Browsers never
-- query the database directly, so row level security is switched on for every
-- table with no policies: Supabase's public API roles (anon, authenticated)
-- can read or write nothing, and only the server connection can.

-- One row per email address that has bought a report or signed in.
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  marketing_emails boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per free scan. Stores the address, the trimmed axe-core results,
-- the score and when it happened.
create table scans (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  host text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed')),
  error text,
  pages_done integer not null default 0,
  pages_total integer,
  score integer check (score between 0 and 100),
  summary jsonb,
  raw jsonb,
  ip_hash text,
  lead_email text,
  user_id uuid references users (id),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index scans_ip_recent on scans (ip_hash, created_at desc);
create index scans_host_recent on scans (host, created_at desc);
create index scans_status on scans (status, created_at);

-- One row per paid report. The token is the secret part of the report link.
create table reports (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null unique references scans (id),
  user_id uuid not null references users (id),
  token text not null unique,
  stripe_session_id text unique,
  amount_cents integer not null,
  currency text not null default 'usd',
  delivered_at timestamptz,
  offer_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index reports_user on reports (user_id, created_at desc);

-- Monthly monitoring. In version 1 a row is a request from a customer who
-- said yes to the day-3 offer; billing is switched on later.
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  site_host text not null,
  plan text not null default 'monitoring' check (plan in ('monitoring', 'agency')),
  status text not null default 'requested'
    check (status in ('requested', 'active', 'cancelled')),
  stripe_subscription_id text unique,
  created_at timestamptz not null default now(),
  unique (user_id, site_host, plan)
);

-- Every Stripe webhook event we have acted on. Recorded before acting, so a
-- repeated delivery of the same event is ignored.
create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- Single-use sign-in links for the account area. Only a hash is stored.
create table login_tokens (
  token_hash text primary key,
  email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index login_tokens_email on login_tokens (email, created_at desc);

-- Sites whose owners asked us not to scan them.
create table blocked_domains (
  host text primary key,
  reason text,
  created_at timestamptz not null default now()
);

-- A log of every email sent, for support questions.
create table email_log (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  template text not null,
  provider_id text,
  created_at timestamptz not null default now()
);

alter table users enable row level security;
alter table scans enable row level security;
alter table reports enable row level security;
alter table subscriptions enable row level security;
alter table stripe_events enable row level security;
alter table login_tokens enable row level security;
alter table blocked_domains enable row level security;
alter table email_log enable row level security;

-- On Supabase, also remove the default table grants from the public API
-- roles. The roles do not exist on a plain local Postgres, so check first.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
  end if;
end
$$;
