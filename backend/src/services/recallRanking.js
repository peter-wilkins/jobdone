function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function includesPhrase(haystack, phrase) {
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return false;
  return ` ${normalize(haystack)} `.includes(` ${normalizedPhrase} `);
}

function structureLabels(entry = {}) {
  const locations = (entry.locations || []).map(location =>
    location.display_name || location.displayName || location.place_text || location.placeText
  );
  const contacts = (entry.contacts || entry.contactSnapshots || []).map(contact =>
    contact.display_name || contact.displayName || contact.label
  );
  const tags = (entry.tags || entry.tagSnapshots || []).map(tag =>
    tag.label || tag.name
  );

  return [
    ...locations.map(label => ({ kind: 'location', label })),
    ...contacts.map(label => ({ kind: 'contact', label })),
    ...tags.map(label => ({ kind: 'tag', label })),
  ].filter(item => item.label);
}

export function scoreStructureMatch(query, entry) {
  const labels = structureLabels(entry);
  let score = 0;
  const matched = [];

  for (const { kind, label } of labels) {
    if (!includesPhrase(query, label)) continue;
    const boost = kind === 'location' || kind === 'contact' ? 0.35 : 0.25;
    score += boost;
    matched.push({ kind, label });
  }

  return { score, matched };
}

export function rankStructuredRecallResults(query, entries = [], { limit = 10 } = {}) {
  return [...entries]
    .map((entry, index) => {
      const structure = scoreStructureMatch(query, entry);
      const similarity = Number(entry.similarity || 0);
      return {
        ...entry,
        structure_similarity: structure.score,
        structure_matches: structure.matched,
        recall_score: similarity + structure.score,
        _rankIndex: index,
      };
    })
    .filter(entry => entry.similarity > 0 || entry.structure_similarity > 0)
    .sort((a, b) => b.recall_score - a.recall_score || a._rankIndex - b._rankIndex)
    .slice(0, limit)
    .map(({ _rankIndex, ...entry }) => entry);
}
