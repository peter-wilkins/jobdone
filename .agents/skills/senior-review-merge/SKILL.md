---
name: senior-review-merge
description: Reviews junior-agent PRs, requests changes or merges when safe, and reconciles linked issues. Use only in a GPT-5.5 session when the user asks to review, approve, or merge a junior/Spark agent PR.
---

# Senior Review Merge

This skill is reserved for GPT-5.5. If the current session is not GPT-5.5, or the model is unknown, stop and say this workflow requires a GPT-5.5 reviewer.

## Contract

- Review as maintainer, not implementer.
- Do not approve your own PR or a PR from the same implementation session.
- Do not merge unless the user explicitly asked for merge/approve-and-merge.
- Reconcile the issue with shipped reality before closing it.
- Production deploys and database writes remain separate explicit actions.

## Review Workflow

1. Fetch PR metadata, changed files, comments, and linked issue.
2. Inspect the diff for correctness, scope control, security, data loss, and missing tests.
3. Run the smallest meaningful local checks.
4. Check CI/status checks when available.
5. Verify the PR satisfies the issue acceptance criteria.
6. If not safe, request changes with concrete blockers.
7. If safe and merge was requested, merge with the repo's preferred method.
8. Update or close the linked issue only after the merge reflects what actually shipped.

## Merge Gate

Merge only if all are true:

- PR is not draft.
- Worktree is clean.
- CI/status checks pass or the user explicitly accepts the risk.
- Required tests for the changed surface passed locally or in CI.
- Diff is scoped to the issue.
- No unresolved review threads remain.
- No production deploy, DB migration, or env mutation is hidden inside the PR.

## Output

Report:

- review decision
- checks run
- merge SHA if merged
- issue update/closure status
- remaining risks
