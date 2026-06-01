import { choremoreDb } from './database.js';

export const DOGFOOD_TEAM_ID = '00000000-0000-4000-8000-000000000001';

function nowIso() {
  return new Date().toISOString();
}

function normalizeDescription(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function validateBacklogItemInput(input = {}) {
  const description = normalizeDescription(input.description);
  const points = Number(input.points);

  if (!description) {
    const error = new Error('Description is required');
    error.statusCode = 400;
    throw error;
  }
  if (description.length > 500) {
    const error = new Error('Description must be 500 characters or fewer');
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isInteger(points) || points < 1 || points > 10) {
    const error = new Error('Points must be an integer from 1 to 10');
    error.statusCode = 400;
    throw error;
  }

  return { description, points };
}

export function presentBacklogItem(row = {}) {
  return {
    id: row.id,
    team_id: row.team_id,
    description: row.description,
    points: row.points,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function presentApprovalRequest(row = {}, backlogItem = null) {
  return {
    id: row.id,
    team_id: row.team_id,
    backlog_item_id: row.backlog_item_id,
    status: row.status,
    evidence_text: row.evidence_text || '',
    submitted_at: row.submitted_at,
    decided_at: row.decided_at,
    backlog_item: backlogItem ? presentBacklogItem(backlogItem) : null,
  };
}

async function ensureDogfoodTeam(db = choremoreDb) {
  if (!db) return null;
  await db
    .from('teams')
    .upsert([{ id: DOGFOOD_TEAM_ID, name: 'Choremore Dogfood' }], { onConflict: 'id' });
}

export async function getParentChoremoreState({ db = choremoreDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) return { openBacklogItems: [], submittedApprovalRequests: [] };
  await ensureDogfoodTeam(db);

  const { data: openRows, error: openError } = await db
    .from('backlog_items')
    .select('*')
    .eq('team_id', teamId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (openError) throw openError;

  const { data: requestRows, error: requestError } = await db
    .from('approval_requests')
    .select('*')
    .eq('team_id', teamId)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false });
  if (requestError) throw requestError;

  const backlogIds = [...new Set((requestRows || []).map(row => row.backlog_item_id).filter(Boolean))];
  const backlogById = new Map();
  if (backlogIds.length) {
    const { data: backlogRows, error: backlogError } = await db
      .from('backlog_items')
      .select('*')
      .eq('team_id', teamId)
      .in('id', backlogIds);
    if (backlogError) throw backlogError;
    for (const row of backlogRows || []) {
      backlogById.set(row.id, row);
    }
  }

  return {
    openBacklogItems: (openRows || []).map(presentBacklogItem),
    submittedApprovalRequests: (requestRows || []).map(row => presentApprovalRequest(row, backlogById.get(row.backlog_item_id))),
  };
}

export async function createBacklogItem(input, { db = choremoreDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) {
    const error = new Error('Choremore database not configured');
    error.statusCode = 503;
    throw error;
  }
  await ensureDogfoodTeam(db);
  const values = validateBacklogItemInput(input);
  const { data, error } = await db
    .from('backlog_items')
    .insert([{ team_id: teamId, ...values, status: 'open', updated_at: nowIso() }])
    .select('*')
    .single();
  if (error) throw error;
  return presentBacklogItem(data);
}

export async function updateOpenBacklogItem(id, input, { db = choremoreDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) {
    const error = new Error('Choremore database not configured');
    error.statusCode = 503;
    throw error;
  }
  const values = validateBacklogItemInput(input);
  const { data, error } = await db
    .from('backlog_items')
    .update({ ...values, updated_at: nowIso() })
    .eq('id', id)
    .eq('team_id', teamId)
    .eq('status', 'open')
    .select('*')
    .single();
  if (error) throw error;
  if (!data) {
    const notFound = new Error('Open Backlog Item not found');
    notFound.statusCode = 404;
    throw notFound;
  }
  return presentBacklogItem(data);
}

export async function deleteOpenBacklogItem(id, { db = choremoreDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) {
    const error = new Error('Choremore database not configured');
    error.statusCode = 503;
    throw error;
  }
  const { data: existing, error: existingError } = await db
    .from('backlog_items')
    .select('id')
    .eq('id', id)
    .eq('team_id', teamId)
    .eq('status', 'open')
    .limit(1)
    .single();
  if (existingError) throw existingError;
  if (!existing) {
    const notFound = new Error('Open Backlog Item not found');
    notFound.statusCode = 404;
    throw notFound;
  }

  const { error } = await db
    .from('backlog_items')
    .delete()
    .eq('id', id)
    .eq('team_id', teamId)
    .eq('status', 'open');
  if (error) throw error;
  return { success: true };
}

export async function decideApprovalRequest(id, decision, { db = choremoreDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) {
    const error = new Error('Choremore database not configured');
    error.statusCode = 503;
    throw error;
  }
  if (!['approved', 'needs_more_evidence'].includes(decision)) {
    const error = new Error('Decision must be approved or needs_more_evidence');
    error.statusCode = 400;
    throw error;
  }

  const { data: request, error: requestError } = await db
    .from('approval_requests')
    .update({ status: decision, decided_at: nowIso(), updated_at: nowIso() })
    .eq('id', id)
    .eq('team_id', teamId)
    .eq('status', 'submitted')
    .select('*')
    .single();
  if (requestError) throw requestError;
  if (!request) {
    const notFound = new Error('Submitted Approval Request not found');
    notFound.statusCode = 404;
    throw notFound;
  }

  const { data: backlogItem, error: backlogError } = await db
    .from('backlog_items')
    .update({ status: decision, updated_at: nowIso() })
    .eq('id', request.backlog_item_id)
    .eq('team_id', teamId)
    .select('*')
    .single();
  if (backlogError) throw backlogError;

  return presentApprovalRequest(request, backlogItem);
}
