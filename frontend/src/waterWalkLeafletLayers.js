export function bringLayerGroupToFront(layerGroup) {
  if (!layerGroup || typeof layerGroup.eachLayer !== 'function') return;
  layerGroup.eachLayer(layer => {
    if (typeof layer?.bringToFront === 'function') {
      layer.bringToFront();
    }
  });
}
