import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTeamCaptureCandidates,
  runTeamCapturePreExtraction,
  selectAutoAttachedContextClues,
} from './teamCaptureExtractionService.js';

test('Team Capture extraction auto-attaches exact local Location and Contact clues', () => {
  const candidates = buildTeamCaptureCandidates({
    contacts: [{ id: 'contact-1', displayName: 'Alan Smith', primaryEmail: 'alan@example.com' }],
    locations: [{ id: 'location-1', displayName: 'North Field', latitude: 51.5, longitude: -1.2 }],
    tags: [{ id: 'tag-1', label: 'Fencing' }],
    team: {
      id: 'team-1',
      name: 'Farm',
      capture_context: { source: 'team_settings', label: 'Farm', notes: 'ponds, fencing and field work' },
    },
  });
  const preExtraction = runTeamCapturePreExtraction({
    captureText: 'Alan Smith checked the fence at North Field.',
    candidates,
    userId: 'user-1',
  });

  const selected = selectAutoAttachedContextClues({ preExtraction, candidates });

  assert.deepEqual(selected.contacts.map(contact => contact.id), ['contact-1']);
  assert.deepEqual(selected.locations.map(location => location.id), ['location-1']);
});

test('Team Capture extraction does not auto-attach ambiguous local clues', () => {
  const candidates = buildTeamCaptureCandidates({
    locations: [
      { id: 'location-1', displayName: 'North Field' },
      { id: 'location-2', displayName: 'North Field' },
    ],
  });
  const preExtraction = runTeamCapturePreExtraction({
    captureText: 'Checked North Field.',
    candidates,
    userId: 'user-1',
  });

  const selected = selectAutoAttachedContextClues({ preExtraction, candidates });

  assert.deepEqual(selected.locations, []);
});

test('Team Capture Context helps matching but does not become an attached Contact or Location', () => {
  const candidates = buildTeamCaptureCandidates({
    team: {
      id: 'team-1',
      name: 'Farm',
      capture_context: { source: 'team_settings', label: 'Farm', notes: 'pond surveys and watercourse work' },
    },
  });
  const preExtraction = runTeamCapturePreExtraction({
    captureText: 'Surveyed the pond outlet.',
    candidates,
    userId: 'user-1',
  });

  const selected = selectAutoAttachedContextClues({ preExtraction, candidates });

  assert.equal(preExtraction.suggestions.teams[0]?.id, 'team-1');
  assert.deepEqual(selected.contacts, []);
  assert.deepEqual(selected.locations, []);
});

test('Team Capture extraction accepts backend prediction only for known local candidates', () => {
  const candidates = buildTeamCaptureCandidates({
    contacts: [{ id: 'contact-1', displayName: 'Alan Smith' }],
  });

  const selected = selectAutoAttachedContextClues({
    preExtraction: { suggestions: { contacts: [], locations: [], tags: [] } },
    candidates,
    backendPrediction: { contactIds: ['contact-1', 'missing-contact'] },
  });

  assert.deepEqual(selected.contacts.map(contact => contact.id), ['contact-1']);
});
