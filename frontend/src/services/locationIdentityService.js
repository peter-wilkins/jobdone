export function normalizeLocationIdentityText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function extractPostcode(value) {
  const match = String(value || '').toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return match ? match[1].replace(/\s+/g, '') : '';
}

function firstAddressLine(value) {
  const [line] = String(value || '').split(/[\n,]/);
  return line || '';
}

export function locationIdentityKeys(location = {}) {
  const providerPlaceId = String(
    location.providerPlaceId || location.provider_place_id || location.placeId || location.place_id || ''
  ).trim();
  const displayName = location.displayName || location.display_name || '';
  const placeText = location.placeText || location.place_text || '';
  const addressText = location.addressText || location.address_text || '';
  const combined = [addressText, placeText, displayName].filter(Boolean).join(' ');
  const postcode = extractPostcode(combined);
  const addressLine = normalizeLocationIdentityText(firstAddressLine(addressText || placeText || displayName)
    .replace(new RegExp(postcode, 'i'), ''));
  const display = normalizeLocationIdentityText(displayName || placeText || addressText);
  const latitude = location.latitude === null || location.latitude === undefined ? null : Number(location.latitude);
  const longitude = location.longitude === null || location.longitude === undefined ? null : Number(location.longitude);
  const coordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude.toFixed(6)}:${longitude.toFixed(6)}`
    : '';

  return {
    provider: providerPlaceId ? `provider:${providerPlaceId}` : '',
    address: display && postcode && addressLine ? `address:${display}:${postcode}:${addressLine}` : '',
    coordinates: display && coordinates ? `coordinates:${display}:${coordinates}` : '',
  };
}

export function locationsHaveStrongIdentityMatch(left = {}, right = {}) {
  const leftKeys = locationIdentityKeys(left);
  const rightKeys = locationIdentityKeys(right);
  return Boolean(
    (leftKeys.provider && leftKeys.provider === rightKeys.provider) ||
    (leftKeys.address && leftKeys.address === rightKeys.address) ||
    (leftKeys.coordinates && leftKeys.coordinates === rightKeys.coordinates)
  );
}

export function findReusableLocation(existingLocations = [], draft = {}) {
  return (existingLocations || []).find(location => locationsHaveStrongIdentityMatch(location, draft)) || null;
}
