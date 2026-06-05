import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthEmailPayload } from '../../../scripts/apply-supabase-auth-email-templates.js';

test('magic-link template uses neutral copy rather than stale user metadata', () => {
  const payload = buildAuthEmailPayload();
  const content = payload.mailer_templates_magic_link_content;

  assert.equal(payload.mailer_subjects_magic_link, 'Open JobDone');
  assert.match(content, /Open JobDone/);
  assert.doesNotMatch(content, /email_kind|\.Data\./);
  assert.doesNotMatch(content, /Sign in to JobDone|JobDone sign-in link/);
});
