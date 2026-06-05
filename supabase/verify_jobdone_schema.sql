select table_schema || '.' || table_name as table_ref
from information_schema.tables
where table_schema in ('jobdone', 'public')
  and table_name in (
    'entries',
    'context_clues',
    'locations',
    'entry_locations',
    'contactClientAliases',
    'tag_categories',
    'tags',
    'tag_vocabulary',
    'entry_tags',
    'contacts',
    'entry_contacts',
    'queries',
    'feedback',
    'entry_attachments',
    'teams',
    'team_members',
    'team_invites',
    'backlog_items',
    'approval_requests'
  )
order by table_ref;

select schemaname || '.' || tablename as table_ref
from pg_tables
where schemaname in ('jobdone', 'public')
  and tablename in (
    'entries',
    'context_clues',
    'locations',
    'entry_locations',
    'contactClientAliases',
    'tag_categories',
    'tags',
    'tag_vocabulary',
    'entry_tags',
    'contacts',
    'entry_contacts',
    'queries',
    'feedback',
    'entry_attachments',
    'teams',
    'team_members',
    'team_invites',
    'backlog_items',
    'approval_requests'
  )
order by table_ref;

select schemaname || '.' || tablename || ':' || policyname as policy_ref
from pg_policies
where schemaname = 'jobdone'
order by policy_ref;
