-- Copy-link Team Invites for JobDone Teams.
-- MVP mode: no email delivery yet; invite links are copied manually.

set search_path = jobdone, public;

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  email text not null,
  normalized_email text generated always as (lower(btrim(email))) stored,
  role text not null default 'worker'
    check (role in ('owner', 'worker')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists team_members_team_normalized_email_idx
  on team_members(team_id, normalized_email);

create index if not exists team_members_team_role_idx
  on team_members(team_id, role);

create table if not exists team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  email text not null,
  normalized_email text generated always as (lower(btrim(email))) stored,
  token_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked')),
  invited_by_email text not null,
  accepted_member_id uuid references team_members(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists team_invites_one_pending_per_email_idx
  on team_invites(team_id, normalized_email)
  where status = 'pending';

create index if not exists team_invites_team_status_idx
  on team_invites(team_id, status, created_at desc);

create index if not exists team_invites_invited_by_created_idx
  on team_invites(invited_by_email, created_at desc);

alter table team_members enable row level security;
alter table team_invites enable row level security;

drop policy if exists "jobdone_backend_manage_team_members" on team_members;
drop policy if exists "jobdone_backend_manage_team_invites" on team_invites;

create policy "jobdone_backend_manage_team_members"
  on team_members
  for all
  to jobdone_backend
  using (true)
  with check (true);

create policy "jobdone_backend_manage_team_invites"
  on team_invites
  for all
  to jobdone_backend
  using (true)
  with check (true);

grant select, insert, update, delete on team_members to jobdone_backend;
grant select, insert, update, delete on team_invites to jobdone_backend;
