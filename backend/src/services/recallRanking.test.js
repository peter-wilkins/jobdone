import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rankStructuredRecallResults, scoreStructureMatch } from './recallRanking.js';

describe('structure-aware Recall ranking', () => {
  test('boosts exact Location matches above weaker semantic matches', () => {
    const ranked = rankStructuredRecallResults('14 Bell Street', [
      {
        id: 'semantic-only',
        summary: 'General boiler work',
        similarity: 0.75,
        locations: [{ display_name: 'Old Road' }],
      },
      {
        id: 'location-match',
        summary: 'Short service note',
        similarity: 0.5,
        locations: [{ display_name: '14 Bell Street' }],
      },
    ]);

    assert.equal(ranked[0].id, 'location-match');
    assert.equal(ranked[0].structure_matches[0].kind, 'location');
  });

  test('boosts Tag matches for task-like Recall queries without a Task model', () => {
    const ranked = rankStructuredRecallResults('Follow Up', [
      {
        id: 'plain-entry',
        summary: 'Checked a radiator',
        similarity: 0.55,
        tags: [{ label: 'Heating' }],
      },
      {
        id: 'follow-up-entry',
        summary: 'Need to return with part',
        similarity: 0.4,
        tags: [{ label: 'Follow Up' }],
      },
    ]);

    assert.equal(ranked[0].id, 'follow-up-entry');
    assert.equal(ranked[0].structure_matches[0].kind, 'tag');
  });

  test('handles Entries with no Location or Contact as valid Recall candidates', () => {
    const ranked = rankStructuredRecallResults('radiator', [
      {
        id: 'unstructured-entry',
        summary: 'Radiator valve replaced',
        similarity: 0.62,
      },
    ]);

    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].id, 'unstructured-entry');
    assert.deepEqual(ranked[0].structure_matches, []);
  });

  test('scores Contact matches when Contact snapshots are available', () => {
    const result = scoreStructureMatch('Sarah Jenkins boiler', {
      contactSnapshots: [{ displayName: 'Sarah Jenkins' }],
    });

    assert.equal(result.score, 0.35);
    assert.deepEqual(result.matched, [{ kind: 'contact', label: 'Sarah Jenkins' }]);
  });
});
