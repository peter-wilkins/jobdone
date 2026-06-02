import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evidenceTextForEntry,
  suggestEvidenceEntries,
} from './evidenceSuggestionService.js';

test('suggests recent entries that overlap the Backlog Item description', () => {
  const suggestions = suggestEvidenceEntries(
    { description: 'Clean kitchen sink trap' },
    [
      { id: 'recent-match', summary: 'Cleaned the sink trap and checked for leaks.' },
      { id: 'noise', summary: 'Called supplier about boiler parts.' },
      { id: 'older-match', transcript: 'Kitchen sink was draining normally after cleanup.' },
    ],
    2
  );

  assert.deepEqual(suggestions.map(entry => entry.id), ['recent-match', 'older-match']);
});

test('keeps empty or no-match suggestions quiet', () => {
  assert.deepEqual(
    suggestEvidenceEntries({ description: 'Paint fence' }, [{ id: 'noise', summary: 'Fixed boiler.' }]),
    []
  );
});

test('uses summary before transcript for inserted evidence text', () => {
  assert.equal(
    evidenceTextForEntry({ summary: 'Short reviewed summary.', transcript: 'Long transcript.' }),
    'Short reviewed summary.'
  );
});

