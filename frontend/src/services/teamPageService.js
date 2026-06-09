import { recallLocalEntries } from './localRecallService.js';

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
