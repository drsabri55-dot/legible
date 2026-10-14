-- Phase 5: what the testing agent is doing (live view) and questions about a
-- scan (chat). Only the site reads these tables.
create table scan_events (
  id bigint generated always as identity primary key,
  scan_id uuid not null references scans (id) on delete cascade,
  step integer not null,
  page text not null,
  title text,
  kind text not null check (kind in ('page', 'step', 'done')),
  note text not null,
  at timestamptz not null default now()
);
create index scan_events_scan on scan_events (scan_id, id);

-- The latest picture only; deleted when the scan finishes.
create table scan_live (
  scan_id uuid primary key references scans (id) on delete cascade,
  frame bytea not null,
  note text not null,
  updated_at timestamptz not null default now()
);

create table chat_messages (
  id bigint generated always as identity primary key,
  scan_id uuid not null references scans (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  body text not null,
  created_at timestamptz not null default now()
);
create index chat_messages_scan on chat_messages (scan_id, id);

alter table scan_events enable row level security;
alter table scan_live enable row level security;
alter table chat_messages enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on scan_events, scan_live, chat_messages from anon, authenticated';
  end if;
end
$$;
