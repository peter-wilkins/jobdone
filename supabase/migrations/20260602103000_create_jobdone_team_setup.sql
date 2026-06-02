-- Generic JobDone Team setup, backlog, and approval shell.
-- MVP mode: prototype data is disposable, so the old Choremore schema is removed.

drop schema if exists choremore cascade;

create schema if not exists jobdone;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'jobdone_backend') then
    create role jobdone_backend nologin;
  end if;
end;
$$;

grant usage on schema jobdone to service_role;
grant usage on schema jobdone to jobdone_backend;

set search_path = jobdone, public;

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  template text not null default 'high_trust'
    check (template in ('high_trust', 'low_trust', 'family')),
  points_enabled boolean not null default false,
  approval_mode text not null default 'auto'
    check (approval_mode in ('auto', 'manual')),
  workers_can_create_backlog_items boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists backlog_items (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  description text not null,
  points integer check (points is null or points between 1 and 10),
  status text not null default 'open'
    check (status in ('open', 'claimed', 'submitted', 'needs_more_evidence', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists backlog_items_team_status_idx
  on backlog_items(team_id, status, created_at desc);

create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  backlog_item_id uuid not null references backlog_items(id) on delete cascade,
  status text not null default 'submitted'
    check (status in ('submitted', 'needs_more_evidence', 'approved')),
  evidence_text text not null default '',
  submitted_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists approval_requests_team_status_idx
  on approval_requests(team_id, status, submitted_at desc);
create index if not exists approval_requests_backlog_item_idx
  on approval_requests(backlog_item_id);

alter table teams enable row level security;
alter table backlog_items enable row level security;
alter table approval_requests enable row level security;

drop policy if exists "jobdone_backend_manage_teams" on teams;
drop policy if exists "jobdone_backend_manage_backlog_items" on backlog_items;
drop policy if exists "jobdone_backend_manage_approval_requests" on approval_requests;

create policy "jobdone_backend_manage_teams"
  on teams
  for all
  to jobdone_backend
  using (true)
  with check (true);

create policy "jobdone_backend_manage_backlog_items"
  on backlog_items
  for all
  to jobdone_backend
  using (true)
  with check (true);

create policy "jobdone_backend_manage_approval_requests"
  on approval_requests
  for all
  to jobdone_backend
  using (true)
  with check (true);

grant select, insert, update, delete on teams to jobdone_backend;
grant select, insert, update, delete on backlog_items to jobdone_backend;
grant select, insert, update, delete on approval_requests to jobdone_backend;
