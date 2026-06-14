export function teamScreenId(teamId) {
  return `team/${encodeURIComponent(String(teamId || ''))}`;
}

const READABLE_TEAMS_CACHE_KEY = 'jobdone.readableTeams.v1';

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

export function teamIdFromScreen(screen) {
  const value = String(screen || '');
  if (!value.startsWith('team/')) return null;
  const encodedId = value.slice('team/'.length);
  if (!encodedId) return null;
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return encodedId;
  }
}

export function mergeReadableTeams(ownedTeams = [], memberTeams = []) {
  const byId = new Map();
  for (const team of ownedTeams || []) {
    if (team?.id) byId.set(team.id, { ...team, relationship: 'owner' });
  }
  for (const membership of memberTeams || []) {
    const team = membership?.team || membership;
    if (!team?.id || byId.has(team.id)) continue;
    byId.set(team.id, {
      ...team,
      relationship: membership?.role || 'member',
    });
  }
  return [...byId.values()].sort((a, b) => {
    const aTime = Date.parse(a.created_at || '') || 0;
    const bTime = Date.parse(b.created_at || '') || 0;
    if (aTime !== bTime) return aTime - bTime;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

export function loadCachedReadableTeams({ storage } = {}) {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return [];
  try {
    const parsed = JSON.parse(resolvedStorage.getItem(READABLE_TEAMS_CACHE_KEY) || '[]');
    return Array.isArray(parsed) ? mergeReadableTeams(parsed, []) : [];
  } catch {
    return [];
  }
}

export function saveCachedReadableTeams(teams = [], { storage } = {}) {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.setItem(READABLE_TEAMS_CACHE_KEY, JSON.stringify(mergeReadableTeams(teams, [])));
  } catch {
    // Cache is best effort; navigation still uses live state.
  }
}

export function clearCachedReadableTeams({ storage } = {}) {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return;
  try {
    resolvedStorage.removeItem(READABLE_TEAMS_CACHE_KEY);
  } catch {
    // Cache is best effort; auth state remains authoritative.
  }
}
