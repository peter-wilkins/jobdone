import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFailureDiagnostic,
  renderGitHubErrorAnnotation,
  renderLocalFailureText,
  renderMarkdownSummary,
} from '../../scripts/recall-property-diagnostics.js';

const failure = {
  seed: 1000,
  query: {
    id: 'location-history',
    text: 'Bell Street',
    expect: {
      include: ['entry-1'],
      exclude: ['entry-3'],
      first: 'entry-1',
    },
  },
  failures: ['missing expected source entry-1'],
  actual: ['entry-2'],
  shrunkWorld: {
    contacts: [{ id: 'contact-1', displayName: 'Sarah Jenkins' }],
    locations: [{ id: 'location-1', displayName: 'Bell Street' }],
    tags: [{ id: 'tag-1', label: 'Follow Up' }],
    entries: [
      {
        id: 'entry-1',
        createdAt: '2026-01-01T10:00:00.000Z',
        summary: 'Checked boiler at Bell Street.',
        contacts: ['contact-1'],
        locations: ['location-1'],
        tags: ['tag-1'],
      },
    ],
  },
};

test('builds concise recall property diagnostics from the shrunk world', () => {
  assert.deepEqual(buildFailureDiagnostic(failure), {
    seed: 1000,
    queryId: 'location-history',
    queryText: 'Bell Street',
    expectedFirst: 'entry-1',
    expectedIncluded: ['entry-1'],
    expectedExcluded: ['entry-3'],
    expectedEmpty: false,
    actual: ['entry-2'],
    failures: ['missing expected source entry-1'],
    entries: [
      {
        id: 'entry-1',
        createdAt: '2026-01-01T10:00:00.000Z',
        summary: 'Checked boiler at Bell Street.',
        contacts: ['Sarah Jenkins'],
        locations: ['Bell Street'],
        tags: ['Follow Up'],
      },
    ],
  });
});

test('renders a GitHub error annotation that points to the summary', () => {
  const annotation = renderGitHubErrorAnnotation(failure);

  assert.match(annotation, /^::error title=Recall property failure::/);
  assert.match(annotation, /Query "Bell Street" failed/);
  assert.match(annotation, /expected include: entry-1/);
  assert.match(annotation, /actual: entry-2/);
  assert.match(annotation, /see job summary/);
});

test('renders GitHub summary with expected, actual, excluded, and entry facts', () => {
  const summary = renderMarkdownSummary(failure, '/tmp/latest.json');

  assert.match(summary, /## Recall property failure/);
  assert.match(summary, /Expected included sources: entry-1/);
  assert.match(summary, /Expected excluded sources: entry-3/);
  assert.match(summary, /Actual sources: entry-2/);
  assert.match(summary, /Checked boiler at Bell Street/);
  assert.match(summary, /"queryText": "Bell Street"/);
});

test('renders useful local failure text without requiring GitHub Actions', () => {
  const text = renderLocalFailureText(failure, '/tmp/latest.json');

  assert.match(text, /Recall property failed: location-history seed 1000/);
  assert.match(text, /Expected included: entry-1/);
  assert.match(text, /Shrunk repro: \/tmp\/latest.json/);
});
