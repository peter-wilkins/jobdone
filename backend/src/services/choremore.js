import { choremoreDb } from './database.js';

export const DOGFOOD_TEAM_ID = '00000000-0000-4000-8000-000000000001';
export const DOGFOOD_TEAM_MEMBER_ID = 'dogfood-child';

function nowIso() {
  return new Date().toISOString();
}

function normalizeDescription(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizeEvidenceText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function startOfWeekIso(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
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
    claimed_by: row.claimed_by,
    claimed_at: row.claimed_at,
    submitted_at: row.submitted_at,
    approved_at: row.approved_at,
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

export function validateEvidenceText(input = {}) {
  const evidenceText = normalizeEvidenceText(input.evidence_text || input.evidenceText);
  if (!evidenceText) {
    const error = new Error('Evidence text is required');
    error.statusCode = 400;
    throw error;
  }
  if (evidenceText.length > 2000) {
    const error = new Error('Evidence text must be 2000 characters or fewer');
    error.statusCode = 400;
    throw error;
  }
  return evidenceText;
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

export async function getChildChoremoreState({
  db = choremoreDb,
  teamId = DOGFOOD_TEAM_ID,
  teamMemberId = DOGFOOD_TEAM_MEMBER_ID,
  weekStart = startOfWeekIso(),
} = {}) {
  if (!db) {
    return {
      claimedItems: [],
      openBacklogItems: [],
      approvedThisWeek: [],
      weeklyPoints: 0,
    };
  }
  await ensureDogfoodTeam(db);

  const { data: claimedRows, error: claimedError } = await db
    .from('backlog_items')
    .select('*')
    .eq('team_id', teamId)
    .eq('claimed_by', teamMemberId)
    .in('status', ['claimed', 'submitted', 'needs_more_evidence'])
    .order('updated_at', { ascending: false });
  if (claimedError) throw claimedError;

  const { data: openRows, error: openError } = await db
    .from('backlog_items')
    .select('*')
    .eq('team_id', teamId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (openError) throw openError;

  const { data: approvedRows, error: approvedError } = await db.query(
    `select *
     from choremore.backlog_items
     where team_id = $1
       and claimed_by = $2
       and status = 'approved'
       and approved_at >= $3::timestamptz
     order by approved_at desc, updated_at desc`,
    [teamId, teamMemberId, weekStart]
  );
  if (approvedError) throw approvedError;

  const approvedThisWeek = (approvedRows || []).map(presentBacklogItem);
  return {
    claimedItems: (claimedRows || []).map(presentBacklogItem),
    openBacklogItems: (openRows || []).map(presentBacklogItem),
    approvedThisWeek,
    weeklyPoints: approvedThisWeek.reduce((total, item) => total + Number(item.points || 0), 0),
    weekStart,
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

export async function claimBacklogItem(id, {
  db = choremoreDb,
  teamId = DOGFOOD_TEAM_ID,
  teamMemberId = DOGFOOD_TEAM_MEMBER_ID,
} = {}) {
  if (!db) {
    const error = new Error('Choremore database not configured');
    error.statusCode = 503;
    throw error;
  }
  const claimedAt = nowIso();
  const { data, error } = await db
    .from('backlog_items')
    .update({
      status: 'claimed',
      claimed_by: teamMemberId,
      claimed_at: claimedAt,
      updated_at: claimedAt,
    })
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

export async function submitBacklogItemEvidence(id, input, {
  db = choremoreDb,
  teamId = DOGFOOD_TEAM_ID,
  teamMemberId = DOGFOOD_TEAM_MEMBER_ID,
} = {}) {
  if (!db) {
    const error = new Error('Choremore database not configured');
    error.statusCode = 503;
    throw error;
  }
  const evidenceText = validateEvidenceText(input);

  const { data: item, error: itemError } = await db
    .from('backlog_items')
    .update({
      status: 'submitted',
      submitted_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq('id', id)
    .eq('team_id', teamId)
    .eq('claimed_by', teamMemberId)
    .in('status', ['claimed', 'needs_more_evidence'])
    .select('*')
    .single();
  if (itemError) throw itemError;
  if (!item) {
    const notFound = new Error('Claimed Backlog Item not found');
    notFound.statusCode = 404;
    throw notFound;
  }

  const { data: existingRequests, error: existingError } = await db
    .from('approval_requests')
    .select('*')
    .eq('team_id', teamId)
    .eq('backlog_item_id', id)
    .limit(1);
  if (existingError) throw existingError;

  const existing = existingRequests?.[0] || null;
  const submittedAt = nowIso();
  const combinedEvidence = existing?.evidence_text
    ? `${existing.evidence_text}\n\n${evidenceText}`
    : evidenceText;
  const requestPatch = {
    team_id: teamId,
    backlog_item_id: id,
    status: 'submitted',
    evidence_text: combinedEvidence,
    submitted_at: submittedAt,
    decided_at: null,
    updated_at: submittedAt,
  };

  const requestResult = existing
    ? await db
      .from('approval_requests')
      .update(requestPatch)
      .eq('id', existing.id)
      .select('*')
      .single()
    : await db
      .from('approval_requests')
      .insert([requestPatch])
      .select('*')
      .single();
  if (requestResult.error) throw requestResult.error;

  return {
    backlogItem: presentBacklogItem(item),
    approvalRequest: presentApprovalRequest(requestResult.data, item),
  };
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
    .update({
      status: decision,
      approved_at: decision === 'approved' ? nowIso() : null,
      updated_at: nowIso(),
    })
    .eq('id', request.backlog_item_id)
    .eq('team_id', teamId)
    .select('*')
    .single();
  if (backlogError) throw backlogError;

  return presentApprovalRequest(request, backlogItem);
}
