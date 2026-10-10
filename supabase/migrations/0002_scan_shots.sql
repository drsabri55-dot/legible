-- Screenshots the testing agent took of elements it reports, shown next to
-- the finding. Read only through the server connection, by unguessable id.
create table scan_shots (
  id uuid primary key,
  scan_id uuid not null references scans (id) on delete cascade,
  image bytea not null,
  created_at timestamptz not null default now()
);
create index scan_shots_scan on scan_shots (scan_id);

alter table scan_shots enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on scan_shots from anon, authenticated';
  end if;
end
$$;
