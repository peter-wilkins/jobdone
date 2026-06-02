set search_path = jobdone, public;

alter table teams
  add column if not exists require_owner_self_review boolean not null default false;

alter table backlog_items
  add column if not exists claimed_by_email text;

create index if not exists backlog_items_team_claimed_by_idx
  on backlog_items(team_id, claimed_by_email)
  where claimed_by_email is not null;
