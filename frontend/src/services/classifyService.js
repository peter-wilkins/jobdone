const QUERY_PATTERNS = [
  /^what (did|do|does|is|are|was|were|have|has|should|could|would|will|can|will|have i|do i|does|are you)/i,
  /^did (i|you|he|she|it|they|we)/i,
  /^have i (been|gone|done|seen|heard|been to|visited)/i,
  /^show me/i,
  /^find (me|all|my)/i,
  /^which (one|ones|day|place|location|address)/i,
  /^where (did|do|does|is|was|were|have|has) (i|you|he|she|it|they|we|my)/i,
  /^when (did|do|does|was|were|have|has) (i|you|he|she|it|they|we|my)/i,
  /^how (did|do|does|was|were|have|has) (i|you|he|she|it|they|we|my)/i,
  /^can i (get|see|find|have|check|view)/i,
  /^should i (get|do|buy|hire|call|check)/i,
  /\?$/,
];

/**
 * @param {string} transcript
 * @returns {'NOTE' | 'QUERY'}
 */
export function classify(transcript) {
  const t = transcript?.trim();
  if (!t) return 'NOTE';

  for (const pattern of QUERY_PATTERNS) {
    if (pattern.test(t)) return 'QUERY';
  }

  return 'NOTE';
}
