import { runPreExtraction } from './preExtractionService.js';

function text(value) {
  return String(value || '').trim();
}

function localContactCandidate(contact) {
  const label = text(contact.displayName || contact.display_name || contact.label);
  if (!contact?.id || !label) return null;
  return {
    id: contact.id,
    label,
    displayName: label,
    primaryPhone: contact.primaryPhone || contact.primary_phone || null,
    primaryEmail: contact.primaryEmail || contact.primary_email || null,
    phones: contact.phones || [],
    emails: contact.emails || [],
    normalizedPhones: contact.normalizedPhones || contact.normalized_phones || [],
    normalizedEmails: contact.normalizedEmails || contact.normalized_emails || [],
    source: 'local_contacts',
  };
}

function localLocationCandidate(location) {
  const label = text(location.displayName || location.display_name || location.placeText || location.place_text || location.addressText || location.address_text);
  if (!location?.id || !label) return null;
  return {
    id: location.id,
    label,
    displayName: label,
    placeText: location.placeText || location.place_text || label,
    addressText: location.addressText || location.address_text || '',
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    accuracyMeters: location.accuracyMeters ?? location.accuracy_meters ?? null,
    source: 'local_locations',
  };
}

function localTagCandidate(tag) {
  const label = text(tag.label || tag.name);
  if (!tag?.id || !label) return null;
  return {
    id: tag.id,
    label,
    categoryId: tag.categoryId || tag.category_id || null,
    categoryName: tag.categoryName || tag.category_name || 'General',
    source: 'local_tags',
  };
}

function backlogCandidate(item) {
  const label = text(item.description || item.label || item.title);
  if (!item?.id || !label) return null;
  return {
    id: item.id,
    label,
    description: label,
    teamId: item.team_id || item.teamId || null,
    status: item.status || null,
    source: 'team_backlog',
  };
}

function teamCandidate(team) {
  if (!team?.id) return null;
  return {
    id: team.id,
    label: text(team.name) || 'Team',
    name: text(team.name) || 'Team',
    capture_context: team.capture_context || team.captureContext || null,
    source: 'team_page',
  };
}

function compact(values) {
  return values.map(value => value).filter(Boolean);
}

function idsFromSuggestions(suggestions = [], { keywordThreshold = 90 } = {}) {
  return suggestions
    .filter(candidate => !candidate.ambiguous)
    .filter(candidate =>
      candidate.reason === 'exact_name_match'
      || (candidate.reason === 'keyword_match' && candidate.score >= keywordThreshold)
    )
    .map(candidate => candidate.id)
    .filter(Boolean);
}

function idsFromBackendPrediction(prediction = {}) {
  return {
    locations: Array.isArray(prediction.locationIds) ? prediction.locationIds : [],
    contacts: Array.isArray(prediction.contactIds) ? prediction.contactIds : [],
    tags: Array.isArray(prediction.tagIds) ? prediction.tagIds : [],
  };
}

function pickByIds(candidates = [], ids = []) {
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const seen = new Set();
  return ids
    .filter(id => !seen.has(id) && seen.add(id))
    .map(id => byId.get(id))
    .filter(Boolean);
}

export function buildTeamCaptureCandidates({
  contacts = [],
  locations = [],
  tags = [],
  team = null,
  backlogItems = [],
} = {}) {
  return {
    contacts: compact(contacts.map(localContactCandidate)),
    locations: compact(locations.map(localLocationCandidate)),
    tags: compact(tags.map(localTagCandidate)),
    teams: compact([teamCandidate(team)]),
    backlogItems: compact(backlogItems.map(backlogCandidate)),
  };
}

export function selectAutoAttachedContextClues({
  preExtraction,
  candidates,
  backendPrediction = null,
} = {}) {
  const suggestions = preExtraction?.suggestions || {};
  const backendIds = idsFromBackendPrediction(backendPrediction || {});
  const locationIds = [
    ...idsFromSuggestions(suggestions.locations || [], { keywordThreshold: 90 }),
    ...backendIds.locations,
  ];
  const contactIds = [
    ...idsFromSuggestions(suggestions.contacts || [], { keywordThreshold: 90 }),
    ...backendIds.contacts,
  ];
  const tagIds = [
    ...idsFromSuggestions(suggestions.tags || [], { keywordThreshold: 90 }),
    ...backendIds.tags,
  ];

  return {
    locations: pickByIds(candidates.locations || [], locationIds),
    contacts: pickByIds(candidates.contacts || [], contactIds),
    tags: pickByIds(candidates.tags || [], tagIds),
  };
}

export function runTeamCapturePreExtraction({
  captureText = '',
  candidates = {},
  userId = '',
} = {}) {
  return runPreExtraction({
    captureText,
    candidates,
    userId,
    userSelections: {},
  });
}
