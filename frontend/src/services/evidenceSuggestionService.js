const STOP_WORDS = new Set([
  'about',
  'after',
  'backlog',
  'before',
  'done',
  'entry',
  'from',
  'have',
  'item',
  'later',
  'more',
  'need',
  'needs',
  'open',
  'should',
  'task',
  'team',
  'that',
  'this',
  'what',
  'when',
  'with',
  'work',
]);

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2 && !STOP_WORDS.has(token));
}

function entryBody(entry = {}) {
  return [entry.summary, entry.transcript].filter(Boolean).join(' ');
}

function scoreEntry(backlogText, entry) {
  const backlogTokens = new Set(tokenize(backlogText));
  if (backlogTokens.size === 0) return 0;
  const entryTokens = new Set(tokenize(entryBody(entry)));
  let score = 0;
  for (const token of backlogTokens) {
    if (entryTokens.has(token)) score += 2;
  }
  const body = entryBody(entry).toLowerCase();
  const description = String(backlogText || '').toLowerCase().trim();
  if (description && body.includes(description)) score += 4;
  return score;
}

export function evidenceTextForEntry(entry = {}) {
  const body = entry.summary || entry.transcript || 'Timeline Entry';
  return body.trim();
}

export function suggestEvidenceEntries(backlogItem = {}, entries = [], limit = 3) {
  const backlogText = [backlogItem.description, backlogItem.title].filter(Boolean).join(' ');
  return entries
    .map((entry, index) => ({ entry, score: scoreEntry(backlogText, entry), index }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(candidate => candidate.entry);
}

