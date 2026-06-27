export function waterWalkBoundsKey(candidates = [], areas = []) {
  const candidateKey = candidates
    .map(candidate => `${candidate.id}:${candidate.latitude},${candidate.longitude}`)
    .join('|');
  const areaKey = areas
    .map(area => `${area.id}:${area.rings.flat().map(point => point.join(',')).join(';')}`)
    .join('|');
  return `${candidateKey}::${areaKey}`;
}
