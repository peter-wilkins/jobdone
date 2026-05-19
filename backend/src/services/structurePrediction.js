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

function normalizedWords(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function containsExactPhrase(evidenceText, label) {
  const labelWords = normalizedWords(label);
  if (!evidenceText || labelWords.length === 0) return false;
  return ` ${evidenceText} `.includes(` ${labelWords.join(' ')} `);
}

function containsFirstNameOnly(evidenceText, label) {
  const words = normalizedWords(label);
  if (words.length < 2 || !evidenceText) return false;
  return ` ${evidenceText} `.includes(` ${words[0]} `);
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

function numericCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function distanceMeters(a, b) {
  const lat1 = numericCoordinate(a?.latitude);
  const lon1 = numericCoordinate(a?.longitude);
  const lat2 = numericCoordinate(b?.latitude);
  const lon2 = numericCoordinate(b?.longitude);
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;

  const radius = 6371000;
  const toRadians = degrees => degrees * Math.PI / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const startLat = toRadians(lat1);
  const endLat = toRadians(lat2);
  const haversine = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function locationClues(contextClues = []) {
  return contextClues
    .filter(clue => clue.kind === 'device_location')
    .map(clue => ({
      latitude: clue.payload?.latitude,
      longitude: clue.payload?.longitude,
      accuracy: clue.payload?.accuracy,
      locationText: compactText(clue.payload?.locationText),
      created_at: clue.created_at,
    }))
    .filter(clue => numericCoordinate(clue.latitude) !== null && numericCoordinate(clue.longitude) !== null);
}

function proximityScore(location, clues = []) {
  const distances = clues
    .map(clue => distanceMeters(location, clue))
    .filter(distance => distance !== null);
  if (!distances.length) return 0;

  const nearest = Math.min(...distances);
  if (nearest <= 100) return 18;
  if (nearest <= 250) return 12;
  if (nearest <= 500) return 7;
  return 0;
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
  const text = [
    entryData.summary,
    entryData.transcript,
    ...contextClues.map(clueText),
  ].map(compactText).filter(Boolean).join(' ');
  return normalizedWords(text).join(' ');
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
    .filter(candidate => candidate.visible !== false)
    .sort((a, b) => b.score - a.score || String(a.label).localeCompare(String(b.label)))
    .slice(0, limit)
    .map(({ score, ...candidate }) => candidate);
}

function normalizeLocationCandidate(location = {}, evidenceText, now, deviceLocationClues = []) {
  const label = compactText(location.display_name || location.displayName || location.place_text || location.placeText);
  if (!label) return null;
  const recentBoost = Math.max(0, 8 - daysSince(location.updated_at || location.created_at, now) / 14);
  const exactMatch = containsExactPhrase(evidenceText, label);
  const proximityBoost = proximityScore(location, deviceLocationClues);
  const partialScore = textScore(label, evidenceText);
  const confidence = exactMatch ? 'strong' : proximityBoost > 0 || partialScore > 0 ? 'medium' : 'weak';
  return {
    id: String(location.id || location.local_id || label),
    label,
    placeText: compactText(location.place_text || location.placeText || label),
    latitude: numericCoordinate(location.latitude),
    longitude: numericCoordinate(location.longitude),
    source: 'location_history',
    confidence,
    visible: confidence !== 'weak',
    score: partialScore + recentBoost + proximityBoost,
  };
}

function normalizeContactCandidate(contact = {}, evidenceText, now) {
  const label = compactText(contact.display_name || contact.displayName || contact.primary_email || contact.primaryEmail || contact.primary_phone || contact.primaryPhone);
  if (!label) return null;
  const recentBoost = Math.max(0, 8 - daysSince(contact.updated_at || contact.created_at, now) / 14);
  const exactMatch = containsExactPhrase(evidenceText, label);
  const firstNameOnly = containsFirstNameOnly(evidenceText, label);
  const partialScore = textScore(label, evidenceText);
  const confidence = exactMatch ? 'strong' : firstNameOnly || partialScore > 0 ? 'medium' : 'weak';
  return {
    id: String(contact.id || contact.local_id || label),
    label,
    source: 'contact_history',
    confidence,
    visible: confidence !== 'weak',
    score: partialScore + recentBoost,
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
  const exactMatch = containsExactPhrase(evidenceText, label);
  const partialScore = textScore(label, evidenceText);
  const confidence = exactMatch ? 'strong' : partialScore > 0 || useCount > 1 ? 'medium' : 'weak';
  return {
    id: String(tag.id || item.tag_id || label),
    label,
    categoryName,
    source: 'tag_vocabulary',
    confidence,
    visible: confidence !== 'weak',
    stats: {
      useCount,
      acceptedCount,
      rejectedCount,
      lastUsedAt: item.last_used_at || tag.updated_at || tag.created_at || null,
    },
    score: partialScore + useCount + acceptedCount * 2 - rejectedCount * 3 + Math.max(0, 10 - ageDays / 7),
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
      const isDeviceLocation = clue.kind === 'device_location';
      locations.push({
        id: `clue-location-${key(locationLabel)}`,
        label: locationLabel,
        placeText: locationLabel,
        latitude: numericCoordinate(payload.latitude),
        longitude: numericCoordinate(payload.longitude),
        source: isDeviceLocation ? 'device_location' : 'context_clue',
        confidence: isDeviceLocation ? 'medium' : 'strong',
        visible: true,
        score: isDeviceLocation ? 8 : 30 + textScore(locationLabel, evidenceText),
      });
    }

    const contactLabel = compactText(payload.contactName || payload.contact || payload.displayName || payload.name);
    if (contactLabel) {
      contacts.push({
        id: `clue-contact-${key(contactLabel)}`,
        label: contactLabel,
        source: 'context_clue',
        confidence: 'strong',
        visible: true,
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
        confidence: 'strong',
        visible: true,
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
  const deviceLocationClues = locationClues(contextClues);

  const locationCandidates = dedupeByLabel([
    ...clue.locations,
    ...locations.map(location => normalizeLocationCandidate(location, evidenceText, now, deviceLocationClues)).filter(Boolean),
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
    confidence: textScore(tag.label, evidenceText) > 0 ? 'medium' : 'weak',
    visible: textScore(tag.label, evidenceText) > 0,
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
  const strongLocationIds = new Set(candidateSet.locations.filter(candidate => candidate.confidence === 'strong').map(candidate => candidate.id));
  const strongContactIds = new Set(candidateSet.contacts.filter(candidate => candidate.confidence === 'strong').map(candidate => candidate.id));

  const proposedTag = response.proposedTag?.label
    ? {
        label: validateCandidateTagLabel(response.proposedTag.label),
        categoryName: validateCandidateTagLabel(response.proposedTag.categoryName || 'General') || 'General',
      }
    : null;

  return {
    locationIds: (response.locationIds || []).filter(id => locationIds.has(id) && strongLocationIds.has(id)).slice(0, 1),
    contactIds: (response.contactIds || []).filter(id => contactIds.has(id) && strongContactIds.has(id)).slice(0, 1),
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
