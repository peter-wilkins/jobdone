import assert from 'node:assert/strict';
import test from 'node:test';

import { bringLayerGroupToFront } from './waterWalkLeafletLayers.js';

test('bringLayerGroupToFront safely lifts child layers', () => {
  const calls = [];
  const layerGroup = {
    eachLayer(callback) {
      callback({ bringToFront: () => calls.push('polygon') });
      callback({});
      callback({ bringToFront: () => calls.push('marker') });
    },
  };

  assert.doesNotThrow(() => bringLayerGroupToFront(layerGroup));
  assert.deepEqual(calls, ['polygon', 'marker']);
});

test('bringLayerGroupToFront ignores missing groups', () => {
  assert.doesNotThrow(() => bringLayerGroupToFront(null));
  assert.doesNotThrow(() => bringLayerGroupToFront({}));
});
