import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWaterWalkDataset } from './contracts/waterWalkDataset.js';

test('water walk dataset accepts historic water candidate theme', () => {
  const result = parseWaterWalkDataset({
    projectId: 'test-water-walk',
    candidates: [{
      id: 'old-spring',
      title: 'Old spring',
      latitude: 50.61,
      longitude: -2.46,
      priority: 'low',
      theme: 'historic_water',
      score: 12,
      whyInteresting: ['Mapped as a historic spring'],
      lookFor: ['seepage', 'stonework'],
      evidencePrompt: 'Check whether this historic water source still has visible ground evidence.',
    }],
    areas: [],
    sourceNotes: [],
    unmappedClayRichFields: [],
  });

  assert.equal(result.success, true);
  assert.equal(result.data.candidates[0].theme, 'historic_water');
});
