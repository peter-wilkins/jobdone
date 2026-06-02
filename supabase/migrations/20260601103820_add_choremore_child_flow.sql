-- Choremore child claim/submit shell.

alter table choremore.backlog_items
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamptz,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_at timestamptz;

create unique index if not exists approval_requests_backlog_item_uidx
  on choremore.approval_requests(backlog_item_id);

create index if not exists backlog_items_team_approved_at_idx
  on choremore.backlog_items(team_id, approved_at desc)
  where status = 'approved';
