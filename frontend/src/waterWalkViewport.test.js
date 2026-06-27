import assert from 'node:assert/strict';
import test from 'node:test';
import { waterWalkBoundsKey } from './waterWalkViewport.js';

test('water walk bounds key changes only when plotted geometry changes', () => {
  const candidates = [
    { id: 'higher-kitehill', latitude: 50.75, longitude: -2.33, score: 12 },
  ];
  const areas = [
    { id: 'eight-acres', rings: [[[50.75, -2.33], [50.76, -2.34], [50.77, -2.32]]] },
  ];

  const beforeSelection = waterWalkBoundsKey(candidates, areas);
  const afterSelectionOnly = waterWalkBoundsKey(
    candidates.map(candidate => ({ ...candidate, selected: true })),
    areas,
  );
  const afterGeometryChange = waterWalkBoundsKey(
    candidates.map(candidate => ({ ...candidate, longitude: -2.35 })),
    areas,
  );

  assert.equal(afterSelectionOnly, beforeSelection);
  assert.notEqual(afterGeometryChange, beforeSelection);
});
