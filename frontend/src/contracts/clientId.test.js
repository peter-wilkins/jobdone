import assert from 'node:assert/strict';
import test from 'node:test';
import { createUuidV7, isUuidV7 } from '../../../shared/contracts/clientId.js';

test('creates UUIDv7 Client IDs that sort by creation time', () => {
  const earlier = createUuidV7(Date.UTC(2026, 5, 5, 12, 0, 0));
  const later = createUuidV7(Date.UTC(2026, 5, 5, 12, 0, 1));

  assert.equal(isUuidV7(earlier), true);
  assert.equal(isUuidV7(later), true);
  assert.equal(earlier < later, true);
});
