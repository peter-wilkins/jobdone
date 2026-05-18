const MAX_LOCATIONS = 5;
const MAX_CONTACTS = 5;
const MAX_TAGS = 12;
const STALE_ONE_OFF_DAYS = 90;

const DOMAIN_SEED_TAGS = [
  { id: 'seed-follow-up', label: 'Follow Up', categoryName: 'Workflow', source: 'domain_template' },
  { id: 'seed-invoice', label: 'Invoice', categoryName: 'Workflow', source: 'domain_template' },
  { id: 'seed-materials', label: 'Materials', categoryName: 'Work Type', source: 'domain_template' },
  { id: 'seed-boiler-service', label: 'Boiler Service', categoryName: 'Work Type', source: 'domain_template' },
  { id: 'seed-plumbing', label: 'Plumbing', categoryName: 'Work Type', source: 'domain_template' },
];

function compactText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function key(value) {
  return compactText(value).toLowerCase();
}

export function validateCandidateTagLabel(value) {
  if (/[\p{C}]/u.test(String(value || ''))) return null;
  const label = compactText(value);
  if (!label || label.length > 40) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(label)) return null;
  return label;
}

function daysSince(value, now) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return Infinity;
  return Math.max(0, (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function clueText(clue = {}) {
  return [
    clue.summary,
    clue.kind,
    clue.source,
    clue.payload?.title,
    clue.payload?.locationText,
    clue.payload?.contactName,
    clue.payload?.displayName,
    clue.payload?.name,
    clue.payload?.text,
    clue.metadata?.source,
  ].map(compactText).filter(Boolean).join(' ');
}

function buildEvidenceText({ entryData = {}, contextClues = [] }) {
  return [
    entryData.summary,
    entryData.transcript,
    ...contextClues.map(clueText),
  ].map(compactText).filter(Boolean).join(' ').toLowerCase();
}

function textScore(label, evidenceText) {
  const labelKey = key(label);
  if (!labelKey || !evidenceText) return 0;
  if (evidenceText.includes(labelKey)) return 20;
  const words = labelKey.split(/\s+/).filter(word => word.length >= 3);
  return words.reduce((score, word) => score + (evidenceText.includes(word) ? 3 : 0), 0);
}

function sortAndLimit(candidates, limit) {
  return candidates
    .sort((a, b) => b.score - a.score || String(a.label).localeCompare(String(b.label)))
    .slice(0, limit)
    .map(({ score, ...candidate }) => candidate);
}

function normalizeLocationCandidate(location = {}, evidenceText, now) {
  const label = compactText(location.display_name || location.displayName || location.place_text || location.placeText);
  if (!label) return null;
  const recentBoost = Math.max(0, 8 - daysSince(location.updated_at || location.created_at, now) / 14);
  return {
    id: String(location.id || location.local_id || label),
    label,
    placeText: compactText(location.place_text || location.placeText || label),
    source: 'location_history',
    score: textScore(label, evidenceText) + recentBoost,
  };
}

function normalizeContactCandidate(contact = {}, evidenceText, now) {
  const label = compactText(contact.display_name || contact.displayName || contact.primary_email || contact.primaryEmail || contact.primary_phone || contact.primaryPhone);
  if (!label) return null;
  const recentBoost = Math.max(0, 8 - daysSince(contact.updated_at || contact.created_at, now) / 14);
  return {
    id: String(contact.id || contact.local_id || label),
    label,
    source: 'contact_history',
    score: textScore(label, evidenceText) + recentBoost,
  };
}

function normalizeTagVocabularyCandidate(item = {}, evidenceText, now) {
  const tag = item.tag || item.tags || item;
  const label = validateCandidateTagLabel(tag.label || tag.name || item.label);
  if (!label) return null;

  const acceptedCount = Number(item.accepted_count ?? tag.accepted_count ?? 0);
  const rejectedCount = Number(item.rejected_count ?? tag.rejected_count ?? 0);
  const useCount = Number(item.use_count ?? tag.use_count ?? acceptedCount);
  const ageDays = daysSince(item.last_used_at || tag.updated_at || tag.created_at, now);

  if (rejectedCount > acceptedCount) return null;
  if (useCount <= 1 && ageDays > STALE_ONE_OFF_DAYS && textScore(label, evidenceText) === 0) return null;

  const categoryName = compactText(tag.category_name || tag.categoryName || tag.tag_categories?.name || 'General') || 'General';
  return {
    id: String(tag.id || item.tag_id || label),
    label,
    categoryName,
    source: 'tag_vocabulary',
    stats: {
      useCount,
      acceptedCount,
      rejectedCount,
      lastUsedAt: item.last_used_at || tag.updated_at || tag.created_at || null,
    },
    score: textScore(label, evidenceText) + useCount + acceptedCount * 2 - rejectedCount * 3 + Math.max(0, 10 - ageDays / 7),
  };
}

function clueCandidates(contextClues = [], evidenceText) {
  const locations = [];
  const contacts = [];
  const tags = [];

  for (const clue of contextClues) {
    const payload = clue.payload || {};
    const locationLabel = compactText(payload.locationText || payload.location || payload.placeText || payload.addressText);
    if (locationLabel) {
      locations.push({
        id: `clue-location-${key(locationLabel)}`,
        label: locationLabel,
        placeText: locationLabel,
        source: 'context_clue',
        score: 30 + textScore(locationLabel, evidenceText),
      });
    }

    const contactLabel = compactText(payload.contactName || payload.contact || payload.displayName || payload.name);
    if (contactLabel) {
      contacts.push({
        id: `clue-contact-${key(contactLabel)}`,
        label: contactLabel,
        source: 'context_clue',
        score: 30 + textScore(contactLabel, evidenceText),
      });
    }

    const tagValues = Array.isArray(payload.tags) ? payload.tags : [];
    for (const value of tagValues) {
      const label = validateCandidateTagLabel(value);
      if (!label) continue;
      tags.push({
        id: `clue-tag-${key(label)}`,
        label,
        categoryName: 'General',
        source: 'context_clue',
        score: 30 + textScore(label, evidenceText),
      });
    }
  }

  return { locations, contacts, tags };
}

function dedupeByLabel(candidates) {
  const byLabel = new Map();
  for (const candidate of candidates) {
    const candidateKey = key(candidate.label);
    const existing = byLabel.get(candidateKey);
    if (!existing || candidate.score > existing.score) {
      byLabel.set(candidateKey, candidate);
    }
  }
  return Array.from(byLabel.values());
}

export function buildPredictionCandidateSet({
  entryData = {},
  contextClues = [],
  locations = [],
  contacts = [],
  tagVocabulary = [],
  now = new Date(),
} = {}) {
  const evidenceText = buildEvidenceText({ entryData, contextClues });
  const clue = clueCandidates(contextClues, evidenceText);

  const locationCandidates = dedupeByLabel([
    ...clue.locations,
    ...locations.map(location => normalizeLocationCandidate(location, evidenceText, now)).filter(Boolean),
  ]);

  const contactCandidates = dedupeByLabel([
    ...clue.contacts,
    ...contacts.map(contact => normalizeContactCandidate(contact, evidenceText, now)).filter(Boolean),
  ]);

  const vocabularyCandidates = tagVocabulary
    .map(item => normalizeTagVocabularyCandidate(item, evidenceText, now))
    .filter(Boolean);

  const seedCandidates = DOMAIN_SEED_TAGS.map(tag => ({
    ...tag,
    score: textScore(tag.label, evidenceText) + 1,
  }));

  const tagCandidates = dedupeByLabel([
    ...clue.tags,
    ...vocabularyCandidates,
    ...seedCandidates,
  ]);

  return {
    locations: sortAndLimit(locationCandidates, MAX_LOCATIONS),
    contacts: sortAndLimit(contactCandidates, MAX_CONTACTS),
    tags: sortAndLimit(tagCandidates, MAX_TAGS),
    limits: {
      locations: MAX_LOCATIONS,
      contacts: MAX_CONTACTS,
      tags: MAX_TAGS,
    },
  };
}

export function buildStructuredPredictionRequest({ entryData = {}, candidateSet }) {
  return {
    schemaVersion: 1,
    task: 'rank_entry_structure_candidates',
    input: {
      entry: {
        summary: compactText(entryData.summary),
        transcript: compactText(entryData.transcript),
      },
      candidates: candidateSet,
      rules: {
        chooseOnlyCandidateIds: true,
        proposedTagAllowedOnlyWhenNoCandidateFits: true,
        proposedTagValidation: 'letters, numbers, spaces, hyphens, underscores, max 40 chars',
      },
    },
    responseSchema: {
      type: 'object',
      required: ['locationIds', 'contactIds', 'tagIds', 'proposedTag'],
      properties: {
        locationIds: { type: 'array', items: { type: 'string' } },
        contactIds: { type: 'array', items: { type: 'string' } },
        tagIds: { type: 'array', items: { type: 'string' } },
        proposedTag: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              required: ['label', 'categoryName'],
              properties: {
                label: { type: 'string', maxLength: 40 },
                categoryName: { type: 'string', maxLength: 40 },
              },
            },
          ],
        },
      },
    },
  };
}

export function normalizeStructuredPredictionResponse(response = {}, candidateSet) {
  const locationIds = new Set(candidateSet.locations.map(candidate => candidate.id));
  const contactIds = new Set(candidateSet.contacts.map(candidate => candidate.id));
  const tagIds = new Set(candidateSet.tags.map(candidate => candidate.id));

  const proposedTag = response.proposedTag?.label
    ? {
        label: validateCandidateTagLabel(response.proposedTag.label),
        categoryName: validateCandidateTagLabel(response.proposedTag.categoryName || 'General') || 'General',
      }
    : null;

  return {
    locationIds: (response.locationIds || []).filter(id => locationIds.has(id)).slice(0, 1),
    contactIds: (response.contactIds || []).filter(id => contactIds.has(id)).slice(0, 1),
    tagIds: (response.tagIds || []).filter(id => tagIds.has(id)).slice(0, 5),
    proposedTag: proposedTag?.label ? proposedTag : null,
  };
}

export async function heuristicStructurePredictor(structuredRequest) {
  const { candidates } = structuredRequest.input;
  return {
    locationIds: candidates.locations.slice(0, 1).map(candidate => candidate.id),
    contactIds: candidates.contacts.slice(0, 1).map(candidate => candidate.id),
    tagIds: candidates.tags.slice(0, 3).map(candidate => candidate.id),
    proposedTag: null,
  };
}
