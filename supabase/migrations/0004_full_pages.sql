-- Pages of the paid whole-site test, sent one by one by the worker.
create table full_pages (
  id bigint generated always as identity primary key,
  scan_id uuid not null references scans (id) on delete cascade,
  url text not null,
  page jsonb not null,
  created_at timestamptz not null default now(),
  unique (scan_id, url)
);

alter table full_pages enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on full_pages from anon, authenticated';
  end if;
end
$$;

-- The whole-site test of each paid report. A null status means the report
-- was bought before the whole-site test existed: it is never started.
alter table reports
  add column full_status text check (full_status in ('running', 'done', 'limit', 'stopped')),
  add column full_pages integer not null default 0,
  add column full_updated_at timestamptz,
  add column full_attempts integer not null default 0,
  add column full_emailed_at timestamptz;

-- Paid spend is charged per page: the page address tells repeats apart.
alter table agent_spend add column ref text not null default '';
drop index agent_spend_once;
create unique index agent_spend_once on agent_spend (scan_id, kind, ref) where kind in ('free', 'paid');
