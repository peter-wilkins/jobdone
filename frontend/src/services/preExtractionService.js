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

const CANDIDATE_KEYS = ['contacts', 'locations', 'tags', 'teams', 'backlogItems'];
const TOKEN_ALIASES = new Map([
  ['rd', 'road'],
  ['st', 'street'],
  ['ave', 'avenue'],
  ['av', 'avenue'],
  ['ln', 'lane'],
  ['dr', 'drive'],
  ['ct', 'court'],
  ['pl', 'place'],
  ['ter', 'terrace'],
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
    .map(token => TOKEN_ALIASES.get(token) || token)
    .filter(token => token.length > 2 && !STOP_WORDS.has(token));
}

function normalizeSearchText(value) {
  return tokenize(value).join(' ');
}

function candidateLabel(candidate = {}) {
  return candidate.displayName
    || candidate.display_name
    || candidate.description
    || candidate.title
    || candidate.label
    || candidate.name
    || '';
}

function candidateSearchText(candidate = {}) {
  return [
    candidate.displayName,
    candidate.display_name,
    candidate.description,
    candidate.title,
    candidate.label,
    candidate.name,
    candidate.addressText,
    candidate.address_text,
    candidate.placeText,
    candidate.place_text,
  ].filter(Boolean).join(' ');
}

function isAvailableCandidate(candidate = {}, userId) {
  if (candidate.available === false) return false;
  if (candidate.deleted || candidate.archived) return false;
  if (candidate.status && ['deleted', 'archived', 'approved'].includes(candidate.status)) return false;
  if (userId && candidate.userId && candidate.userId !== userId) return false;
  if (userId && candidate.user_id && candidate.user_id !== userId) return false;
  return true;
}

function exactMentionScore(captureText, label) {
  const normalizedCapture = normalizeSearchText(captureText);
  const normalizedLabel = normalizeSearchText(label);
  if (!normalizedCapture || !normalizedLabel) return 0;
  return normalizedCapture.includes(normalizedLabel) ? 100 : 0;
}

function tokenMentionScore(captureText, searchText) {
  const captureTokens = new Set(tokenize(captureText));
  const labelTokens = tokenize(searchText);
  if (!captureTokens.size || !labelTokens.length) return 0;
  const matched = labelTokens.filter(token => captureTokens.has(token)).length;
  if (matched === 0) return 0;
  const allTokensMatched = matched === labelTokens.length;
  const coverage = matched / labelTokens.length;
  return Math.round((allTokensMatched ? 40 : 0) + (matched * 15) + (coverage * 30));
}

function scoreCandidate(captureText, candidate) {
  const label = candidateLabel(candidate);
  const searchText = candidateSearchText(candidate) || label;
  const exactScore = exactMentionScore(captureText, label);
  if (exactScore) return { score: exactScore, reason: 'exact_name_match', label };
  const tokenScore = tokenMentionScore(captureText, searchText);
  if (tokenScore) return { score: tokenScore, reason: 'keyword_match', label };
  return { score: 0, reason: 'no_match', label };
}

function suggestForKind(kind, captureText, candidates = [], userId, limit) {
  const scored = candidates
    .filter(candidate => isAvailableCandidate(candidate, userId))
    .map((candidate, index) => {
      const scoredCandidate = scoreCandidate(captureText, candidate);
      return {
        ...candidate,
        id: candidate.id,
        kind,
        label: scoredCandidate.label,
        score: scoredCandidate.score,
        reason: scoredCandidate.reason,
        source: 'deterministic_pre_extraction',
        ambiguous: false,
        index,
      };
    })
    .filter(candidate => candidate.id && candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const topScore = scored[0]?.score || 0;
  return scored.slice(0, limit).map(candidate => ({
    ...candidate,
    ambiguous: topScore > 0 && scored.filter(item => item.score === topScore).length > 1,
    index: undefined,
  }));
}

export function runPreExtraction({
  captureText = '',
  candidates = {},
  userId = '',
  userSelections = {},
  limit = 3,
} = {}) {
  const suggestions = {};
  for (const key of CANDIDATE_KEYS) {
    suggestions[key] = suggestForKind(key, captureText, candidates[key] || [], userId, limit);
  }

  return {
    source: 'deterministic_pre_extraction',
    durable: false,
    suggestions,
    preservedUserSelections: structuredClone(userSelections || {}),
  };
}

export const preExtractionInternals = {
  normalizeText,
  normalizeSearchText,
  tokenize,
};
