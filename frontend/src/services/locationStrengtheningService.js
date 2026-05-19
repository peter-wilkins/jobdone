export function hasRealCoordinates(location = {}) {
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return !(latitude === 0 && longitude === 0);
}

export function locationHasAnchor(location = {}) {
  const hasAddress = Boolean(String(location.addressText || location.address_text || '').trim());
  const hasCoordinates = hasRealCoordinates(location);
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
