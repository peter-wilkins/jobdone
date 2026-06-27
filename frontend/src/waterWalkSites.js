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
    searchScope: {
      mode: 'site_buffer',
      radiusMetres: 2500,
      notes: 'Use the private farm/site geometry when available, then buffer it for nearby old wells, springs and watercourses.',
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
    searchScope: {
      mode: 'point_radius',
      radiusMetres: 1000,
      notes: 'Home garden test scope. Keep external old-well/spring searches local around the default view or captured GPS anchor.',
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
