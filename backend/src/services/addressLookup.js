const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_COUNTRY_CODES = 'gb';
const DEFAULT_LIMIT = 5;
const cache = new Map();

function normalizeQuery(query) {
  return String(query || '').replace(/\s+/g, ' ').trim();
}

function firstAddressLine(address = {}, displayName = '') {
  const houseAndRoad = [address.house_number, address.road].filter(Boolean).join(' ');
  if (houseAndRoad) return houseAndRoad;
  return String(displayName || '').split(',')[0]?.trim() || '';
}

function compactAddress(address = {}, displayName = '') {
  return [
    firstAddressLine(address, displayName),
    address.suburb || address.village || address.town || address.city,
    address.postcode,
    address.country,
  ].filter(Boolean).join(', ');
}

export function normalizeAddressLookupResults(results = []) {
  return (Array.isArray(results) ? results : [])
    .map(result => {
      const displayName = String(result.display_name || '').trim();
      const latitude = Number(result.lat);
      const longitude = Number(result.lon);
      if (!displayName || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

      const address = result.address || {};
      const line1 = firstAddressLine(address, displayName);
      const addressText = compactAddress(address, displayName) || displayName;
      const providerPlaceId = [
        'nominatim',
        result.osm_type,
        result.osm_id,
        result.place_id,
      ].filter(Boolean).join(':');

      return {
        id: providerPlaceId || `nominatim:${displayName}`,
        displayName: line1 || displayName,
        placeText: displayName,
        addressText,
        latitude,
        longitude,
        provider: 'nominatim',
        providerPlaceId,
        evidence: {
          provider: 'nominatim',
          osmType: result.osm_type || null,
          osmId: result.osm_id || null,
          placeId: result.place_id || null,
          category: result.category || result.class || null,
          type: result.type || null,
          rawDisplayName: displayName,
        },
      };
    })
    .filter(Boolean);
}

export function createAddressLookupService({
  fetchImpl = globalThis.fetch,
  baseUrl = process.env.ADDRESS_LOOKUP_BASE_URL || process.env.NOMINATIM_BASE_URL || DEFAULT_BASE_URL,
  countryCodes = process.env.ADDRESS_LOOKUP_COUNTRY_CODES || DEFAULT_COUNTRY_CODES,
  contact = process.env.ADDRESS_LOOKUP_CONTACT || '',
  userAgent = process.env.ADDRESS_LOOKUP_USER_AGENT || `JobDone/1.0 (${contact || 'https://github.com/peter-wilkins/jobdone'})`,
} = {}) {
  return {
    async search(query) {
      const normalizedQuery = normalizeQuery(query);
      if (normalizedQuery.length < 3) {
        return { candidates: [] };
      }

      const cacheKey = `${baseUrl}|${countryCodes}|${normalizedQuery.toLowerCase()}`;
      if (cache.has(cacheKey)) {
        return { candidates: cache.get(cacheKey) };
      }

      const url = new URL(baseUrl);
      url.searchParams.set('q', normalizedQuery);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('limit', String(DEFAULT_LIMIT));
      url.searchParams.set('layer', 'address');
      if (countryCodes) url.searchParams.set('countrycodes', countryCodes);
      if (contact.includes('@')) url.searchParams.set('email', contact);

      const response = await fetchImpl(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': userAgent,
        },
      });
      if (!response.ok) {
        throw new Error(`Address lookup failed: ${response.status}`);
      }

      const candidates = normalizeAddressLookupResults(await response.json());
      cache.set(cacheKey, candidates);
      return { candidates };
    },
  };
}
