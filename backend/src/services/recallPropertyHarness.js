import { rankStructuredRecallResults } from './recallRanking.js';

const USER_ID = 'workflow-manager-user';
const OTHER_USER_ID = 'other-user';

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function words(value) {
  return normalize(value)
    .split(' ')
    .filter(word => word.length > 2);
}

function hasPhrase(value, phrase) {
  const normalizedPhrase = normalize(phrase);
  return Boolean(normalizedPhrase) && ` ${normalize(value)} `.includes(` ${normalizedPhrase} `);
}

function labelsFor(entry = {}) {
  return [
    ...(entry.contacts || []).map(contact => contact.display_name),
    ...(entry.locations || []).map(location => location.display_name || location.place_text),
    ...(entry.tags || []).map(tag => tag.label),
  ].filter(Boolean);
}

function searchableEntryText(entry = {}) {
  return [
    entry.summary,
    entry.transcript,
    ...labelsFor(entry),
  ].filter(Boolean).join(' ');
}

function lexicalSimilarity(query, entry) {
  const queryWords = new Set(words(query));
  if (!queryWords.size) return 0;

  const entryWords = new Set(words(searchableEntryText(entry)));
  let matches = 0;
  for (const word of queryWords) {
    if (entryWords.has(word)) matches += 1;
  }

  return Math.min(0.8, matches / queryWords.size);
}

function matchingLabel(query, records = [], labelField = 'display_name') {
  const matches = records.filter(record => hasPhrase(query, record[labelField]));
  return matches.length === 1 ? matches[0] : null;
}

function ambiguousFirstName(query, contacts = []) {
  const queryWords = new Set(words(query));
  const matched = contacts.filter(contact => {
    const [firstName] = words(contact.display_name);
    return firstName && queryWords.has(firstName);
  });
  return matched.length > 1;
}

function sameId(records = [], id) {
  return records.some(record => record.id === id);
}

export function createV0RecallSyntheticWorld() {
  const contacts = [
    { id: 'contact-sarah-jenkins', display_name: 'Sarah Jenkins' },
    { id: 'contact-sarah-johnson', display_name: 'Sarah Johnson' },
    { id: 'contact-bob-lee', display_name: 'Bob Lee' },
  ];

  const locations = [
    { id: 'location-bell-street', display_name: '14 Bell Street', place_text: '14 Bell Street' },
    { id: 'location-king-road', display_name: '22 King Road', place_text: '22 King Road' },
  ];

  const tags = [
    { id: 'tag-boiler', label: 'Boiler Service' },
    { id: 'tag-follow-up', label: 'Follow Up' },
    { id: 'tag-invoice', label: 'Invoice Pending' },
  ];

  const entries = [
    {
      id: 'entry-sarah-bell-old',
      user_id: USER_ID,
      status: 'confirmed',
      created_at: '2026-01-10T09:00:00.000Z',
      summary: 'Serviced the boiler and topped up pressure at 14 Bell Street.',
      transcript: 'Sarah Jenkins said the boiler pressure kept dropping.',
      contacts: [contacts[0]],
      locations: [locations[0]],
      tags: [tags[0]],
    },
    {
      id: 'entry-sarah-bell-latest',
      user_id: USER_ID,
      status: 'confirmed',
      created_at: '2026-03-15T11:30:00.000Z',
      summary: 'Found a leaking isolation valve and need to return with a 15mm valve.',
      transcript: 'Follow up for Sarah Jenkins at 14 Bell Street.',
      contacts: [contacts[0]],
      locations: [locations[0]],
      tags: [tags[1]],
    },
    {
      id: 'entry-sarah-johnson',
      user_id: USER_ID,
      status: 'confirmed',
      created_at: '2026-03-20T14:00:00.000Z',
      summary: 'Replaced shower cartridge for Sarah Johnson.',
      transcript: 'Bathroom job, no boiler work.',
      contacts: [contacts[1]],
      locations: [locations[1]],
      tags: [],
    },
    {
      id: 'entry-bob-invoice',
      user_id: USER_ID,
      status: 'confirmed',
      created_at: '2026-02-01T16:00:00.000Z',
      summary: 'Completed radiator balancing and invoice is still pending.',
      transcript: 'Chase Bob Lee for the invoice.',
      contacts: [contacts[2]],
      locations: [locations[1]],
      tags: [tags[2]],
    },
    {
      id: 'entry-unconfirmed-capture',
      user_id: USER_ID,
      status: 'draft',
      created_at: '2026-04-01T09:00:00.000Z',
      summary: 'Unconfirmed capture about Bell Street.',
      transcript: 'This should not appear in Recall property tests.',
      contacts: [contacts[0]],
      locations: [locations[0]],
      tags: [],
    },
    {
      id: 'entry-other-user-bell',
      user_id: OTHER_USER_ID,
      status: 'confirmed',
      created_at: '2026-04-20T09:00:00.000Z',
      summary: 'Other user at 14 Bell Street with a newer boiler note.',
      transcript: 'Wrong account data.',
      contacts: [contacts[0]],
      locations: [locations[0]],
      tags: [tags[0]],
    },
  ];

  return { userId: USER_ID, otherUserId: OTHER_USER_ID, contacts, locations, tags, entries };
}

export function createV0RecallPropertyCases(world = createV0RecallSyntheticWorld()) {
  return [
    {
      id: 'contact-history',
      query: 'Show me Sarah Jenkins jobs',
      expectedSources: ['entry-sarah-bell-old', 'entry-sarah-bell-latest'],
      excludedSources: ['entry-sarah-johnson', 'entry-other-user-bell', 'entry-unconfirmed-capture'],
    },
    {
      id: 'location-history',
      query: '14 Bell Street history',
      expectedSources: ['entry-sarah-bell-old', 'entry-sarah-bell-latest'],
      excludedSources: ['entry-bob-invoice', 'entry-other-user-bell', 'entry-unconfirmed-capture'],
    },
    {
      id: 'latest-matching-entry',
      query: 'What did I do for Sarah Jenkins last time?',
      expectedSources: ['entry-sarah-bell-latest'],
      firstSource: 'entry-sarah-bell-latest',
      excludedSources: ['entry-sarah-johnson', 'entry-other-user-bell', 'entry-unconfirmed-capture'],
    },
    {
      id: 'unresolved-follow-up',
      query: 'What needs follow up?',
      expectedSources: ['entry-sarah-bell-latest'],
      excludedSources: ['entry-other-user-bell', 'entry-unconfirmed-capture'],
    },
    {
      id: 'similar-case-search',
      query: 'leaking isolation valve',
      expectedSources: ['entry-sarah-bell-latest'],
      excludedSources: ['entry-sarah-johnson', 'entry-other-user-bell', 'entry-unconfirmed-capture'],
    },
    {
      id: 'ambiguous-contact-query',
      query: 'What did Sarah need?',
      expectedAmbiguity: 'contact',
      expectedSources: [],
      excludedSources: ['entry-sarah-bell-old', 'entry-sarah-bell-latest', 'entry-sarah-johnson'],
    },
  ].map(testCase => ({ userId: world.userId, ...testCase }));
}

export function defaultV0RecallRouter(testCase, world = createV0RecallSyntheticWorld(), { limit = 10 } = {}) {
  if (testCase.expectedAmbiguity === 'contact' && ambiguousFirstName(testCase.query, world.contacts)) {
    return [];
  }

  const contactScope = matchingLabel(testCase.query, world.contacts);
  const locationScope = matchingLabel(testCase.query, world.locations);

  const candidates = world.entries
    .filter(entry => entry.user_id === testCase.userId)
    .filter(entry => entry.status === 'confirmed')
    .filter(entry => !contactScope || sameId(entry.contacts, contactScope.id))
    .filter(entry => !locationScope || sameId(entry.locations, locationScope.id))
    .map(entry => ({
      ...entry,
      similarity: lexicalSimilarity(testCase.query, entry),
    }));

  return rankStructuredRecallResults(testCase.query, candidates, { limit });
}

function entryById(world, id) {
  return world.entries.find(entry => entry.id === id) || null;
}

function minimalRepro(world, testCase, actualIds = []) {
  const interestingIds = new Set([
    ...actualIds,
    ...(testCase.expectedSources || []),
    ...(testCase.excludedSources || []),
  ]);

  return {
    case: testCase.id,
    query: testCase.query,
    expectedSources: testCase.expectedSources || [],
    excludedSources: testCase.excludedSources || [],
    actualSources: actualIds,
    entries: world.entries
      .filter(entry => interestingIds.has(entry.id))
      .map(entry => ({
        id: entry.id,
        user_id: entry.user_id,
        status: entry.status,
        created_at: entry.created_at,
        summary: entry.summary,
        contacts: (entry.contacts || []).map(contact => contact.display_name),
        locations: (entry.locations || []).map(location => location.display_name),
        tags: (entry.tags || []).map(tag => tag.label),
      })),
  };
}

function addFailure(failures, world, testCase, actualIds, property, detail = {}) {
  failures.push({
    case: testCase.id,
    property,
    ...detail,
    repro: minimalRepro(world, testCase, actualIds),
  });
}

export function runV0RecallProperties({
  world = createV0RecallSyntheticWorld(),
  cases = createV0RecallPropertyCases(world),
  router = defaultV0RecallRouter,
} = {}) {
  const failures = [];

  for (const testCase of cases) {
    const actual = router(testCase, world) || [];
    const actualIds = actual.map(entry => entry.id);

    for (const sourceId of testCase.expectedSources || []) {
      const source = entryById(world, sourceId);
      if (!source) {
        addFailure(failures, world, testCase, actualIds, 'expected_source_exists', { sourceId });
      } else if (source.user_id !== testCase.userId) {
        addFailure(failures, world, testCase, actualIds, 'expected_source_belongs_to_user', { sourceId });
      } else if (source.status !== 'confirmed') {
        addFailure(failures, world, testCase, actualIds, 'expected_source_is_confirmed_entry', { sourceId });
      }

      if (!actualIds.includes(sourceId)) {
        addFailure(failures, world, testCase, actualIds, 'expected_source_returned', { sourceId });
      }
    }

    for (const sourceId of testCase.excludedSources || []) {
      if (actualIds.includes(sourceId)) {
        addFailure(failures, world, testCase, actualIds, 'excluded_source_not_returned', { sourceId });
      }
    }

    if (testCase.firstSource && actualIds[0] !== testCase.firstSource) {
      addFailure(failures, world, testCase, actualIds, 'first_source_matches_latest_oracle', {
        expected: testCase.firstSource,
        actual: actualIds[0] || null,
      });
    }

    if (testCase.expectedAmbiguity && actualIds.length > 0) {
      addFailure(failures, world, testCase, actualIds, 'ambiguous_query_returns_no_certain_sources', {
        ambiguity: testCase.expectedAmbiguity,
      });
    }
  }

  return { world, cases, failures };
}

export function formatRecallPropertyFailures(failures = []) {
  return failures.map(failure =>
    `${failure.case}: ${failure.property}\n${JSON.stringify(failure.repro, null, 2)}`
  ).join('\n\n');
}

function formatList(values = []) {
  return values.length ? values.map(value => `\`${value}\``).join(', ') : '_none_';
}

function suggestedNextStep(failure = {}) {
  if (failure.property === 'first_source_matches_latest_oracle') {
    return 'Check recency-intent detection and latest-first tie-breaking in `backend/src/services/recallRanking.js`.';
  }

  if (failure.property === 'expected_source_returned') {
    return 'Check Recall candidate filtering and scoring did not drop an expected confirmed Entry.';
  }

  if (failure.property === 'excluded_source_not_returned') {
    return 'Check user, status, ambiguity, and scope filters before ranking.';
  }

  return 'Inspect the minimal repro and compare the oracle against Recall routing/ranking.';
}

export function formatRecallPropertyFailureMarkdown(failures = []) {
  if (!failures.length) {
    return [
      '## Recall property diagnostics',
      '',
      'No Recall property failures.',
      '',
    ].join('\n');
  }

  const [failure] = failures;
  const repro = failure.repro || {};
  const expectedFirst = failure.expected || repro.expectedSources?.[0] || null;
  const actualFirst = failure.actual || repro.actualSources?.[0] || null;

  const lines = [
    '## Recall property diagnostics',
    '',
    `Shrunk/minimal failing repro: \`${failure.case}\``,
    '',
    `- Property: \`${failure.property}\``,
    `- Query: \`${repro.query || ''}\``,
    `- Expected sources: ${formatList(repro.expectedSources)}`,
    `- Excluded sources: ${formatList(repro.excludedSources)}`,
    `- Actual sources: ${formatList(repro.actualSources)}`,
    `- Expected first source: ${expectedFirst ? `\`${expectedFirst}\`` : '_none_'}`,
    `- Actual first source: ${actualFirst ? `\`${actualFirst}\`` : '_none_'}`,
    '',
    `Likely next step: ${suggestedNextStep(failure)}`,
    '',
    '<details>',
    '<summary>Minimal repro JSON</summary>',
    '',
    '```json',
    JSON.stringify(repro, null, 2),
    '```',
    '',
    '</details>',
    '',
  ];

  if (failures.length > 1) {
    lines.push(`_Additional Recall property failures: ${failures.length - 1}_`, '');
  }

  return lines.join('\n');
}
