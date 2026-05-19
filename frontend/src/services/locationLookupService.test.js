import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseLookupLocationAction,
  locationDraftFromLookupCandidate,
} from './locationLookupService.js';

test('creates a Location draft from address lookup candidate', () => {
  const draft = locationDraftFromLookupCandidate({
    displayName: '14 Bell Street',
    placeText: '14 Bell Street, Exampletown',
    addressText: '14 Bell Street, Exampletown, AB1 2CD',
    latitude: 53.1,
    longitude: -6.2,
    providerPlaceId: 'nominatim:way:1:2',
  });

  assert.equal(draft.displayName, '14 Bell Street');
  assert.equal(draft.addressText, '14 Bell Street, Exampletown, AB1 2CD');
  assert.equal(draft.providerPlaceId, 'nominatim:way:1:2');
  assert.equal(draft.source, 'address_lookup');
});

test('reuses an existing Location when lookup identity matches', () => {
  const existing = { id: 'loc-1', displayName: '14 Bell Street', addressText: '14 Bell Street, Exampletown, AB1 2CD' };
  const decision = chooseLookupLocationAction([existing], {
    displayName: '14 Bell Street',
    addressText: '14 Bell Street, Exampletown, AB1 2CD',
  });

  assert.equal(decision.action, 'reuse');
  assert.equal(decision.existing.id, 'loc-1');
});

test('creates a new Location when lookup identity does not match existing Locations', () => {
  const existing = { id: 'loc-1', displayName: '22 King Road', addressText: '22 King Road, AB1 2CD' };
  const decision = chooseLookupLocationAction([existing], {
    displayName: '14 Bell Street',
    addressText: '14 Bell Street, Exampletown, AB1 2CD',
  });

  assert.equal(decision.action, 'create');
  assert.equal(decision.draft.displayName, '14 Bell Street');
});
