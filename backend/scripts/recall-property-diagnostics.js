function list(values) {
  return values?.length ? values.join(', ') : '(none)';
}

function escapeGitHubCommand(value) {
  return String(value)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

function labelLookup(rows, labelKey = 'displayName') {
  return new Map((rows || []).map(row => [row.id, row[labelKey] || row.name || row.label || row.id]));
}

export function buildRelevantEntryFacts(failure) {
  const world = failure.shrunkWorld || {};
  const contactLabels = labelLookup(world.contacts);
  const locationLabels = labelLookup(world.locations);
  const tagLabels = labelLookup(world.tags, 'label');

  return (world.entries || []).map(entry => ({
    id: entry.id,
    createdAt: entry.createdAt,
    summary: entry.summary,
    contacts: (entry.contacts || []).map(id => contactLabels.get(id) || id),
    locations: (entry.locations || []).map(id => locationLabels.get(id) || id),
    tags: (entry.tags || []).map(id => tagLabels.get(id) || id),
  }));
}

export function buildFailureDiagnostic(failure) {
  const expected = failure.query?.expect || {};
  return {
    seed: failure.seed,
    queryId: failure.query?.id,
    queryText: failure.query?.text,
    expectedFirst: expected.first || null,
    expectedIncluded: expected.include || [],
    expectedExcluded: expected.exclude || [],
    expectedEmpty: expected.empty === true,
    actual: failure.actual || [],
    failures: failure.failures || [],
    entries: buildRelevantEntryFacts(failure),
  };
}

export function renderGitHubErrorAnnotation(failure) {
  const diagnostic = buildFailureDiagnostic(failure);
  const message = [
    `Query "${diagnostic.queryText}" failed`,
    `expected include: ${list(diagnostic.expectedIncluded)}`,
    `expected first: ${diagnostic.expectedFirst || '(none)'}`,
    `actual: ${list(diagnostic.actual)}`,
    'see job summary for shrunk repro',
  ].join('; ');
  return `::error title=Recall property failure::${escapeGitHubCommand(message)}`;
}

export function renderMarkdownSummary(failure, failurePath) {
  const diagnostic = buildFailureDiagnostic(failure);
  const rows = diagnostic.entries.map(entry => [
    entry.id,
    entry.createdAt || '',
    entry.summary || '',
    list(entry.contacts),
    list(entry.locations),
    list(entry.tags),
  ]);

  return [
    '## Recall property failure',
    '',
    `- Seed: ${diagnostic.seed}`,
    `- Query ID: ${diagnostic.queryId}`,
    `- Query: ${diagnostic.queryText}`,
    `- Expected first source: ${diagnostic.expectedFirst || '(none)'}`,
    `- Expected included sources: ${list(diagnostic.expectedIncluded)}`,
    `- Expected excluded sources: ${list(diagnostic.expectedExcluded)}`,
    `- Expected empty result: ${diagnostic.expectedEmpty ? 'yes' : 'no'}`,
    `- Actual sources: ${list(diagnostic.actual)}`,
    `- Failure JSON: ${failurePath}`,
    '',
    '### Failures',
    '',
    ...(diagnostic.failures.length ? diagnostic.failures.map(item => `- ${item}`) : ['- (none)']),
    '',
    '### Relevant Entry Facts',
    '',
    '| Entry | Created | Summary | Contacts | Locations | Tags |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.map(cell => String(cell).replaceAll('|', '\\|')).join(' | ')} |`),
    '',
    '### Minimal Repro JSON',
    '',
    '```json',
    JSON.stringify(diagnostic, null, 2),
    '```',
    '',
  ].join('\n');
}

export function renderLocalFailureText(failure, failurePath) {
  const diagnostic = buildFailureDiagnostic(failure);
  return [
    `Recall property failed: ${diagnostic.queryId} seed ${diagnostic.seed}`,
    `Query: ${diagnostic.queryText}`,
    `Expected included: ${list(diagnostic.expectedIncluded)}`,
    `Expected first: ${diagnostic.expectedFirst || '(none)'}`,
    `Expected excluded: ${list(diagnostic.expectedExcluded)}`,
    `Actual: ${list(diagnostic.actual)}`,
    'Failures:',
    ...(diagnostic.failures.length ? diagnostic.failures.map(item => `- ${item}`) : ['- (none)']),
    `Shrunk repro: ${failurePath}`,
  ].join('\n');
}
