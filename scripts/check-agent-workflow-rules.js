import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const filesToCheck = [
  'AGENTS.md',
  '.agents/skills/review-merge/SKILL.md',
  '.agents/skills/issue-branch-worker/SKILL.md',
  '.agents/skills/senior-review-merge/SKILL.md',
  '.agents/skills/junior-issue-worker/SKILL.md',
];

const forbiddenPatterns = [
  {
    pattern: /requires?\s+(?:a\s+)?GPT-5\.5/i,
    reason: 'review/merge must not require a specific model name',
  },
  {
    pattern: /current session is not GPT-5\.5/i,
    reason: 'review/merge must not stop on a model-name check',
  },
  {
    pattern: /model is unknown/i,
    reason: 'review/merge must not stop because the runtime model is unknown',
  },
  {
    pattern: /Junior and senior agent roles/i,
    reason: 'workflow docs should use capability roles, not seniority roles',
  },
];

const requiredSnippets = [
  {
    file: 'AGENTS.md',
    text: 'Approve-and-merge work should use the `review-merge` skill.',
  },
  {
    file: '.agents/skills/review-merge/SKILL.md',
    text: 'This is a capability workflow, not a developer-seniority workflow.',
  },
  {
    file: '.agents/skills/senior-review-merge/SKILL.md',
    text: 'Deprecated compatibility alias for review-merge.',
  },
];

const failures = [];

for (const relativePath of filesToCheck) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${relativePath}: missing`);
    continue;
  }

  const body = fs.readFileSync(absolutePath, 'utf8');
  for (const { pattern, reason } of forbiddenPatterns) {
    if (pattern.test(body)) {
      failures.push(`${relativePath}: ${reason}`);
    }
  }
}

for (const { file, text } of requiredSnippets) {
  const absolutePath = path.join(repoRoot, file);
  const body = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
  if (!body.includes(text)) {
    failures.push(`${file}: missing required text ${JSON.stringify(text)}`);
  }
}

if (failures.length) {
  console.error('[agent-workflow-rules] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[agent-workflow-rules] passed');
