import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOverpassQuery,
  mergeHistoricCandidates,
  overpassElementsToCandidates,
} from './import-osm-historic-water.js';

test('buildOverpassQuery searches bounded spring and water well tags', () => {
  const query = buildOverpassQuery({
    south: 50.1,
    west: -2.2,
    north: 50.2,
    east: -2.1,
  });

  assert.match(query, /"natural"="spring"/);
  assert.match(query, /"man_made"="water_well"/);
  assert.match(query, /"historic"="well"/);
  assert.match(query, /"disused:man_made"="water_well"/);
  assert.match(query, /50\.100000,-2\.200000,50\.200000,-2\.100000/);
});

test('overpassElementsToCandidates converts springs and wells to historic water pins', () => {
  const candidates = overpassElementsToCandidates([
    {
      type: 'node',
      id: 123,
      lat: 50.61,
      lon: -2.46,
      tags: { natural: 'spring', name: 'Old Spring' },
    },
    {
      type: 'way',
      id: 456,
      center: { lat: 50.62, lon: -2.47 },
      tags: { historic: 'well' },
    },
  ]);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].theme, 'historic_water');
  assert.equal(candidates[0].priority, 'low');
  assert.match(candidates[0].evidencePrompt, /unverified/);
  assert.ok(candidates.some(candidate => candidate.title.includes('historic well')));
  assert.ok(candidates.some(candidate => candidate.id === 'osm-way-456'));
});

test('mergeHistoricCandidates appends and dedupes OSM candidates', () => {
  const candidate = {
    id: 'osm-node-1',
    title: 'OSM spring (spring)',
    latitude: 50.61,
    longitude: -2.46,
    priority: 'low',
    theme: 'historic_water',
    score: 18,
    whyInteresting: [],
    lookFor: [],
    evidencePrompt: 'Check.',
  };
  const merged = mergeHistoricCandidates({
    projectId: 'test',
    candidates: [candidate],
    areas: [],
    sourceNotes: [],
    unmappedClayRichFields: [],
  }, [candidate]);

  assert.equal(merged.candidates.length, 1);
  assert.match(merged.sourceNotes.at(-1), /added 1 candidate pins/);
});
