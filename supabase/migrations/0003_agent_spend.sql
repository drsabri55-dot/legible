-- What the testing agent cost, one row per scan run (and later per chat
-- answer). The daily cap adds up today's free rows.
create table agent_spend (
  id bigint generated always as identity primary key,
  scan_id uuid not null references scans (id) on delete cascade,
  kind text not null check (kind in ('free', 'paid', 'chat_free', 'chat_paid')),
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  -- Null only when the prices were removed while the scan ran.
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now()
);
create index agent_spend_recent on agent_spend (created_at);
-- A scan run is charged once, however often the worker repeats its message.
create unique index agent_spend_once on agent_spend (scan_id, kind) where kind in ('free', 'paid');

alter table agent_spend enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on agent_spend from anon, authenticated';
  end if;
end
$$;

-- Whether a free scan was sent with the testing agent: on, left out because
-- of the daily cap, or off (no prices set).
alter table scans add column agent text not null default 'off'
  check (agent in ('on', 'capped', 'off'));
