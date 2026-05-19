import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canStrengthenLocationDraft,
  locationHasAnchor,
  strengthenLocationDraftWithClue,
} from './locationStrengtheningService.js';

test('weak existing Locations can be strengthened', () => {
  assert.equal(canStrengthenLocationDraft({ id: 'location-1', displayName: 'Barn near Little Barford' }), true);
});

test('new drafts and already anchored Locations are not strengthening prompts', () => {
  assert.equal(canStrengthenLocationDraft({ displayName: 'Current location' }), false);
  assert.equal(canStrengthenLocationDraft({ id: 'location-1', displayName: '14 Bell Street', addressText: '14 Bell Street' }), false);
  assert.equal(locationHasAnchor({ id: 'location-2', displayName: 'North field', latitude: 52.1, longitude: -0.2 }), true);
});

test('strengthens a Location draft with confirmed current GPS clue', () => {
  const strengthened = strengthenLocationDraftWithClue(
    { id: 'location-1', displayName: 'Barn near Little Barford' },
    {
      payload: {
        latitude: 52.198123,
        longitude: -0.293456,
        capturedAt: '2026-05-19T10:00:00.000Z',
      },
    }
  );

  assert.equal(strengthened.id, 'location-1');
  assert.equal(strengthened.latitude, 52.198123);
  assert.equal(strengthened.longitude, -0.293456);
  assert.equal(strengthened.locationStrengthened, true);
});
