export function locationPrimaryLabel(location = {}) {
  return location.displayName || location.display_name || location.placeText || location.place_text || 'Untitled location';
}

export function locationSecondaryDetail(location = {}) {
  const address = location.addressText || location.address_text || '';
  const place = location.placeText || location.place_text || '';
  const primary = locationPrimaryLabel(location);
  if (address && address !== primary) return address;
  if (place && place !== primary) return place;
  if (hasCoordinates(location)) return coordinateLabel(location);
  return 'Needs detail';
}

export function hasCoordinates(location = {}) {
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return !(latitude === 0 && longitude === 0);
}

export function coordinateLabel(location = {}) {
  if (!hasCoordinates(location)) return '';
  return `${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)}`;
}

export function locationMapsUrl(location = {}) {
  if (hasCoordinates(location)) {
    return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
  }

  const query = [
    location.addressText || location.address_text,
    location.placeText || location.place_text,
    location.displayName || location.display_name,
  ].filter(Boolean).join(' ');

  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

export function entryMatchesLocation(entry = {}, location = {}) {
  const locationId = location.id || location.local_id || location.localId;
  if (!locationId) return false;
  if (Array.isArray(entry.locationIds) && entry.locationIds.includes(locationId)) return true;

  return (entry.locationSnapshots || []).some(snapshot =>
    [snapshot.id, snapshot.local_id, snapshot.localId, snapshot.remoteId, snapshot.remote_id]
      .filter(Boolean)
      .some(id => String(id) === String(locationId))
  );
}
