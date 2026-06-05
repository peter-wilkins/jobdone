const STOP_WORDS = new Set([
  'about',
  'after',
  'before',
  'done',
  'entry',
  'from',
  'have',
  'later',
  'more',
  'need',
  'needs',
  'note',
  'that',
  'this',
  'what',
  'when',
  'with',
  'work',
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length > 2 && !STOP_WORDS.has(token));
}

function clueText(values = [], keys = []) {
  return (Array.isArray(values) ? values : [])
    .flatMap(value => keys.map(key => value?.[key]))
    .filter(Boolean)
    .join(' ');
}

function entrySearchText(entry = {}) {
  return [
    entry.summary,
    entry.transcript,
    clueText(entry.locations, ['displayName', 'placeText', 'addressText']),
    clueText(entry.contacts, ['displayName', 'primaryEmail', 'primaryPhone']),
    clueText(entry.tags, ['label']),
    clueText(entry.workContexts, ['title', 'description', 'teamName']),
  ].filter(Boolean).join(' ');
}

function scoreEntry(query, entry) {
  if (entry?.status && entry.status !== 'confirmed') return 0;

  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query);
  if (!normalizedQuery || queryTokens.length === 0) return 0;

  const normalizedBody = normalizeText(entrySearchText(entry));
  if (!normalizedBody) return 0;

  let score = normalizedBody.includes(normalizedQuery) ? 12 : 0;
  const bodyTokens = new Set(tokenize(normalizedBody));
  for (const token of queryTokens) {
    if (bodyTokens.has(token)) {
      score += 4;
    } else if (normalizedBody.includes(token)) {
      score += 1;
    }
  }
  return score;
}

export function recallLocalEntries(query, entries = [], limit = 25) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({ entry, index, score: scoreEntry(query, entry) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const bTime = new Date(b.entry.createdAt || 0).getTime();
      const aTime = new Date(a.entry.createdAt || 0).getTime();
      return bTime - aTime || a.index - b.index;
    })
    .slice(0, limit)
    .map(candidate => ({
      ...candidate.entry,
      syncStatus: candidate.entry.syncStatus || 'local',
    }));
}
