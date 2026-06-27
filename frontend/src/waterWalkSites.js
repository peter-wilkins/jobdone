export const WATER_WALK_SITES = [
  {
    id: 'dewlish',
    label: 'Dewlish',
    screen: 'water-walk?site=dewlish',
    projectId: 'dewlish-water-walk',
    remote: true,
    private: true,
    defaultView: {
      latitude: 50.788,
      longitude: -2.33,
      zoom: 14,
    },
  },
  {
    id: '85-dover-road',
    label: '85 Dover Road',
    screen: 'water-walk?site=85-dover-road',
    projectId: '85-dover-road-water-walk',
    remote: false,
    private: false,
    defaultView: {
      latitude: 50.61,
      longitude: -2.46,
      zoom: 16,
    },
    sourceNotes: ['Home garden test site. Coordinates come from captured GPS, not hard-coded address data.'],
  },
];

export function waterWalkSiteById(siteId = '') {
  return WATER_WALK_SITES.find(site => site.id === siteId) || WATER_WALK_SITES[0];
}

export function waterWalkSiteIdFromHash(hash = '') {
  const [, query = ''] = String(hash || '').replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  return params.get('site') || 'dewlish';
}

export function waterWalkSiteFromHash(hash = '') {
  return waterWalkSiteById(waterWalkSiteIdFromHash(hash));
}

export function waterWalkScreenForSite(siteId = '') {
  return waterWalkSiteById(siteId).screen;
}
