export function locationHasAnchor(location = {}) {
  const hasAddress = Boolean(String(location.addressText || location.address_text || '').trim());
  const hasCoordinates = Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude));
  return hasAddress || hasCoordinates;
}

export function canStrengthenLocationDraft(location = {}) {
  return Boolean(location?.id) && !locationHasAnchor(location);
}

export function strengthenLocationDraftWithClue(location = {}, clue = {}) {
  const payload = clue.payload || {};
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return location;

  return {
    ...location,
    latitude,
    longitude,
    locationStrengthened: true,
    locationStrengthenedAt: payload.capturedAt || clue.created_at || new Date().toISOString(),
  };
}
