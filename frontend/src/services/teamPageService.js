import { recallLocalEntries } from './localRecallService.js';

const TEAM_PAGE_CACHE_PREFIX = 'jobdone.teamPage.v1.';

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length > 2);
}

function contextTeamName(context = {}) {
  return String(context?.teamName || context?.team_name || context?.team?.name || '').trim().toLowerCase();
}

function contextTeamId(context = {}) {
  return context?.teamId || context?.team_id || context?.team?.id || null;
}

export function selectTeamTimelineEntries(entries = [], teamId = null, teamName = '') {
  const normalizedTeamName = String(teamName || '').trim().toLowerCase();
  return (entries || []).filter(entry => {
    const contexts = Array.isArray(entry.workContexts) ? entry.workContexts : [];
    return contexts.some(context => {
      if (teamId && contextTeamId(context) === teamId) return true;
      return Boolean(normalizedTeamName && contextTeamName(context) === normalizedTeamName);
    });
  });
}

export function resolveTeamPageUser({ user = null, authUser = null } = {}) {
  if (user?.id) return user;
  if (authUser?.id) return authUser;
  return null;
}

export function canLoadTeamPageState({ teamId = null, user = null, authUser = null } = {}) {
  return Boolean(teamId && resolveTeamPageUser({ user, authUser })?.id);
}

export function teamContextSnapshot(team = {}) {
  const teamId = team?.id || null;
  const teamName = String(team?.name || 'Team').trim();
  if (!teamId) return null;
  return {
    id: `team:${teamId}`,
    type: 'team',
    label: teamName,
    description: teamName,
    teamId,
    teamName,
    status: 'team',
  };
}

export function backlogItemContextSnapshot(item = {}) {
  const id = item?.id || null;
  const label = String(item?.description || item?.title || 'Backlog Item').trim();
  if (!id) return null;
  return {
    id,
    type: 'backlog_item',
    label,
    description: item.description || item.title || '',
    teamId: item.team?.id || item.team_id || item.teamId || null,
    teamName: item.team?.name || item.teamName || item.team_name || 'Team',
    status: item.status || null,
  };
}

export function teamPageCacheKey(teamId) {
  const id = String(teamId || '').trim();
  return id ? `${TEAM_PAGE_CACHE_PREFIX}${id}` : null;
}

export function loadCachedTeamPageState(teamId, { storage } = {}) {
  const key = teamPageCacheKey(teamId);
  const resolvedStorage = resolveStorage(storage);
  if (!key || !resolvedStorage) return null;
  try {
    const parsed = JSON.parse(resolvedStorage.getItem(key) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCachedTeamPageState(teamId, state = {}, { storage } = {}) {
  const key = teamPageCacheKey(teamId);
  const resolvedStorage = resolveStorage(storage);
  if (!key || !resolvedStorage) return;
  try {
    resolvedStorage.setItem(key, JSON.stringify({
      ...state,
      cachedAt: new Date().toISOString(),
    }));
  } catch {
    // Cache is best effort; live Team state remains authoritative.
  }
}

export function hasWorkContext(entry = {}) {
  if (Array.isArray(entry.workContextIds) && entry.workContextIds.length > 0) return true;
  return Array.isArray(entry.workContexts) && entry.workContexts.some(context => Boolean(
    context?.id
    || context?.label
    || context?.description
    || contextTeamId(context)
    || contextTeamName(context)
  ));
}

export function selectPrivateTimelineEntries(entries = []) {
  return (entries || []).filter(entry => !hasWorkContext(entry));
}

function backlogSearchText(item = {}) {
  const request = item.approval_request || item.approvalRequest || {};
  return [
    item.description,
    item.title,
    item.status,
    item.team?.name,
    item.teamName,
    item.team_name,
    request.evidence_text,
    request.evidenceText,
  ].filter(Boolean).join(' ');
}

function scoreBacklogItem(query, item) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query);
  if (!normalizedQuery || queryTokens.length === 0) return 0;

  const normalizedBody = normalizeText(backlogSearchText(item));
  if (!normalizedBody) return 0;

  let score = normalizedBody.includes(normalizedQuery) ? 12 : 0;
  const bodyTokens = new Set(tokenize(normalizedBody));
  for (const token of queryTokens) {
    if (bodyTokens.has(token)) {
      score += 4;
    } else if (normalizedBody.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function createdTime(value) {
  return new Date(value || 0).getTime() || 0;
}

function dedupeBacklogItems(items = []) {
  const seen = new Set();
  return (items || []).filter(item => {
    const id = item?.id || item?.backlog_item?.id || item?.backlogItem?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function searchTeamBacklogItems(query, items = [], limit = 10) {
  return dedupeBacklogItems(items)
    .map((item, index) => ({ item, index, score: scoreBacklogItem(query, item) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return createdTime(b.item.createdAt || b.item.created_at) - createdTime(a.item.createdAt || a.item.created_at) || a.index - b.index;
    })
    .slice(0, limit)
    .map(candidate => candidate.item);
}

export function searchTeamEntries(query, entries = [], teamId = null, teamName = '', limit = 10) {
  return recallLocalEntries(query, selectTeamTimelineEntries(entries, teamId, teamName), limit);
}

export function searchTeamContext({
  query = '',
  entries = [],
  team = null,
  teamId = null,
  openBacklogItems = [],
  inProgressItems = [],
  approvedItems = [],
  activeApprovalRequests = [],
} = {}) {
  const resolvedTeamId = teamId || team?.id || null;
  const resolvedTeamName = team?.name || '';
  const requestItems = (activeApprovalRequests || [])
    .map(request => ({
      ...(request.backlog_item || request.backlogItem || {}),
      approval_request: request,
      status: request.status || request.backlog_item?.status,
    }))
    .filter(item => item.id);
  const backlogItems = searchTeamBacklogItems(query, [
    ...openBacklogItems,
    ...inProgressItems,
    ...approvedItems,
    ...requestItems,
  ]);
  const timelineEntries = searchTeamEntries(query, entries, resolvedTeamId, resolvedTeamName);
  return {
    backlogItems,
    entries: timelineEntries,
    hasResults: backlogItems.length > 0 || timelineEntries.length > 0,
  };
}
