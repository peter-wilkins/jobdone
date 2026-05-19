import { findReusableLocation } from './locationIdentityService.js';

export function locationDraftFromLookupCandidate(candidate = {}) {
  const displayName = String(candidate.displayName || candidate.label || candidate.placeText || '').trim();
  if (!displayName) return null;

  return {
    id: null,
    displayName,
    placeText: String(candidate.placeText || displayName).trim(),
    addressText: String(candidate.addressText || '').trim(),
    latitude: candidate.latitude ?? null,
    longitude: candidate.longitude ?? null,
    providerPlaceId: candidate.providerPlaceId || null,
    source: 'address_lookup',
    lookupEvidence: candidate.evidence || {
      provider: candidate.provider || 'address_lookup',
      providerPlaceId: candidate.providerPlaceId || null,
    },
  };
}

export function chooseLookupLocationAction(existingLocations = [], candidate = {}) {
  const draft = locationDraftFromLookupCandidate(candidate);
  if (!draft) return { action: 'invalid', draft: null, existing: null };

  const existing = findReusableLocation(existingLocations, draft);
  if (existing) return { action: 'reuse', draft, existing };
  return { action: 'create', draft, existing: null };
}
