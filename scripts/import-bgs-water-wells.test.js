import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bgsFeatureCollectionToCandidates,
  bgsFeatureToCandidate,
  mergeBgsCandidates,
} from './import-bgs-water-wells.js';

test('bgsFeatureToCandidate converts GeoIndex water wells to historic water pins', () => {
  const candidate = bgsFeatureToCandidate({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-2.4535, 50.6062] },
    properties: {
      OBJECTID: 59872,
      GDI_HYDRO_ID: 46750,
      REFERENCE: 'SY67/3A',
      REGNO: 'SY67NE220/BJ',
      LOCATION: 'THE BREWERY WEYMOUTH',
      DEPTH: 6.1,
      YEAR: '1901',
      AQUIFER: 'CORALLIAN GROUP',
    },
  });

  assert.equal(candidate.id, 'bgs-water-well-46750');
  assert.equal(candidate.theme, 'historic_water');
  assert.equal(candidate.priority, 'low');
  assert.equal(candidate.latitude, 50.6062);
  assert.equal(candidate.longitude, -2.4535);
  assert.match(candidate.title, /THE BREWERY WEYMOUTH/);
  assert.match(candidate.whyInteresting.join(' '), /depth 6.1 m/);
});

test('bgsFeatureCollectionToCandidates ignores features without usable coordinates', () => {
  const candidates = bgsFeatureCollectionToCandidates({
    features: [
      {
        geometry: { type: 'Point', coordinates: [-2.4, 50.7] },
        properties: { OBJECTID: 1, LOCATION: 'A' },
      },
      {
        geometry: null,
        properties: { OBJECTID: 2, LOCATION: 'B' },
      },
    ],
  });

  assert.equal(candidates.length, 1);
});

test('mergeBgsCandidates appends and dedupes BGS candidates', () => {
  const candidate = {
    id: 'bgs-water-well-1',
    title: 'Well',
    latitude: 50.61,
    longitude: -2.46,
    priority: 'low',
    theme: 'historic_water',
    score: 18,
    whyInteresting: [],
    lookFor: [],
    evidencePrompt: 'Check.',
  };
  const merged = mergeBgsCandidates({
    projectId: 'test',
    candidates: [candidate],
    areas: [],
    sourceNotes: [],
    unmappedClayRichFields: [],
  }, [candidate]);

  assert.equal(merged.candidates.length, 1);
  assert.match(merged.sourceNotes.at(-1), /added 1 candidate pins/);
});
