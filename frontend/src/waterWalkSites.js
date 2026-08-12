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
  {
    id: 'tumptonics',
    label: 'Tumptonics',
    screen: 'water-walk?site=tumptonics',
    projectId: 'tumptonics-water-restoration',
    remote: true,
    private: true,
    defaultView: {
      latitude: 51.66535,
      longitude: -2.85449,
      zoom: 16,
    },
    searchScope: {
      mode: 'point_pair_buffer',
      radiusMetres: 1500,
      notes: 'Spring and potential pond site near Usk. Use LiDAR DTM for contours, flow paths, slope and pond siting.',
    },
    seedDataset: {
      generatedAt: '2026-08-12T00:00:00.000Z',
      sourceNotes: [
        'Starter pins from Peter: spring at 51.664158, -2.855463 and potential pond site at 51.666552, -2.853509.',
        'Wales LiDAR DTM/DSM is available through DataMapWales/NRW; use DTM for restoration planning.',
      ],
      candidates: [
        {
          id: 'tumptonics-spring',
          title: 'Spring',
          latitude: 51.664158,
          longitude: -2.855463,
          priority: 'high',
          theme: 'historic_water',
          score: 90,
          whyInteresting: [
            'Known spring location and likely water source for restoration planning.',
            'Use LiDAR DTM and field evidence to understand flow path toward lower ground.',
          ],
          lookFor: ['spring flow', 'wet flush', 'historic drainage', 'erosion', 'vegetation change'],
          evidencePrompt: 'Photograph the spring, flow direction, wet ground, and any channels or pipework.',
        },
        {
          id: 'tumptonics-potential-pond',
          title: 'Potential pond site',
          latitude: 51.666552,
          longitude: -2.853509,
          priority: 'high',
          theme: 'water_restoration',
          score: 88,
          whyInteresting: [
            'Candidate pond/restoration location near the spring catchment.',
            'Needs LiDAR slope/contour review and a field check for water-holding feasibility.',
          ],
          lookFor: ['natural hollow', 'soil wetness', 'safe spillway route', 'field access', 'downslope risk'],
          evidencePrompt: 'Photograph the proposed pond footprint, levels, downstream route, and practical access.',
        },
      ],
      areas: [],
      unmappedClayRichFields: [],
    },
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
