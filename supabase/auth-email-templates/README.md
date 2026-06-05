# JobDone Auth Email Templates

Hosted Supabase reads Auth email templates from project Auth settings, not from
this folder. Keep the source HTML here, then apply it with the helper script:

```bash
. ~/.profile
npm run auth:emails:dry-run -- --env staging
SUPABASE_ACCESS_TOKEN=... npm run auth:emails:apply -- --env staging
```

Use `--env production` for prod. The script patches only the Magic Link template
and subject.

The Magic Link email deliberately uses neutral "Open JobDone" copy. Supabase
renders `{{ .Data }}` from persistent user metadata, so using it for transient
"sign in" versus "Team invite" context can leak stale copy into later emails.
Team invite context is handled in the app after the link opens.

Current Supabase docs:

- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/auth-smtp
