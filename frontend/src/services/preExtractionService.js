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

function stemToken(token) {
  if (token.length > 5 && token.endsWith('ied')) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
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
  const captureContext = candidate.capture_context || candidate.captureContext || {};
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
    captureContext.label,
    captureContext.examples,
    captureContext.notes,
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

function editDistance(left, right) {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > 2) return 3;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > 2) return 3;
    previous = current;
  }
  return previous[right.length];
}

function tokensFuzzilyMatch(captureToken, labelToken) {
  if (captureToken === labelToken) return true;
  const captureStem = stemToken(captureToken);
  const labelStem = stemToken(labelToken);
  if (captureStem === labelStem) return true;
  if (captureStem.length >= 3 && labelStem.length >= 3 && editDistance(captureStem, labelStem) <= 1) return true;
  if (captureStem.length >= 5 && labelStem.length >= 5) {
    const [shorter, longer] = captureStem.length <= labelStem.length
      ? [captureStem, labelStem]
      : [labelStem, captureStem];
    if (longer.startsWith(shorter) || editDistance(captureStem, labelStem) <= 1) return true;
  }
  if (captureStem.length >= 7 && labelStem.length >= 7 && editDistance(captureStem, labelStem) <= 2) return true;
  return false;
}

function tokenMentionScore(captureText, searchText) {
  const captureTokens = tokenize(captureText);
  const exactCaptureTokens = new Set(captureTokens);
  const labelTokens = tokenize(searchText);
  if (!captureTokens.length || !labelTokens.length) return 0;
  let matched = 0;
  let exactMatched = 0;
  let fuzzyMatched = 0;
  for (const labelToken of labelTokens) {
    if (exactCaptureTokens.has(labelToken)) {
      matched += 1;
      exactMatched += 1;
    } else if (captureTokens.some(captureToken => tokensFuzzilyMatch(captureToken, labelToken))) {
      matched += 1;
      fuzzyMatched += 1;
    }
  }
  if (matched === 0) return 0;
  const allTokensMatched = matched === labelTokens.length;
  const coverage = matched / labelTokens.length;
  const definiteTokenMatch = matched >= 3;
  const score = Math.round(
    (allTokensMatched ? 40 : 0)
    + (definiteTokenMatch ? 30 : 0)
    + (exactMatched * 15)
    + (fuzzyMatched * 12)
    + (coverage * 30)
  );
  return Math.min(score, 95);
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
  stemToken,
  tokenize,
};
