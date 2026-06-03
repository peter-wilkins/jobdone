import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBacklogItemClaimedByEmail } from './teams.js';

test('matches My Work claimed rows to the signed-in claimant only', () => {
  assert.equal(
    isBacklogItemClaimedByEmail({ claimed_by_email: 'WORKER@example.com' }, 'worker@example.com'),
    true
  );
  assert.equal(
    isBacklogItemClaimedByEmail({ claimed_by_email: 'other@example.com' }, 'worker@example.com'),
    false
  );
});

test('keeps anonymous dogfood rows visible without claimant filtering', () => {
  assert.equal(isBacklogItemClaimedByEmail({ claimed_by_email: null }, null), true);
});

