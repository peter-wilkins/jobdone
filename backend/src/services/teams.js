import crypto from 'node:crypto';
import { jobdoneDb, supabase } from './database.js';

export const DOGFOOD_TEAM_ID = '00000000-0000-4000-8000-000000000001';
const MAX_PENDING_INVITES_PER_TEAM = 20;
const MAX_INVITES_PER_OWNER_PER_HOUR = 10;

const TEMPLATE_SETTINGS = {
  high_trust: {
    template: 'high_trust',
    points_enabled: false,
    approval_mode: 'auto',
    workers_can_create_backlog_items: true,
  },
  low_trust: {
    template: 'low_trust',
    points_enabled: false,
    approval_mode: 'manual',
    workers_can_create_backlog_items: false,
  },
  family: {
    template: 'family',
    points_enabled: true,
    approval_mode: 'manual',
    workers_can_create_backlog_items: false,
  },
};

function nowIso() {
  return new Date().toISOString();
}

function tokenSecret() {
  return process.env.INVITE_TOKEN_SECRET || process.env.SUPABASE_KEY || process.env.SUPABASE_DB_URL || 'jobdone-mvp-invite-token-secret';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function tokenForInviteId(inviteId) {
  const signature = crypto
    .createHmac('sha256', tokenSecret())
    .update(String(inviteId))
    .digest('base64url');
  return `v1.${inviteId}.${signature}`;
}

function normalizedEmail(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function validateEmail(value) {
  const email = normalizedEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    const error = new Error('Valid email is required');
    error.statusCode = 400;
    throw error;
  }
  return email;
}

function normalizeDescription(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function validateBacklogItemInput(input = {}) {
  const description = normalizeDescription(input.description);
  const rawPoints = input.points === '' || input.points === undefined ? null : input.points;
  const points = rawPoints === null ? null : Number(rawPoints);

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
  if (points !== null && (!Number.isInteger(points) || points < 1 || points > 10)) {
    const error = new Error('Points must be an integer from 1 to 10');
    error.statusCode = 400;
    throw error;
  }

  return { description, points };
}

export function presentBacklogItem(row = {}, team = null) {
  const item = {
    id: row.id,
    team_id: row.team_id,
    description: row.description,
    points: row.points,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    approval_request: row.approval_request || null,
  };
  if (team) {
    item.team = presentTeam(team);
  }
  return item;
}

export function presentTeam(row = {}) {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    points_enabled: Boolean(row.points_enabled),
    approval_mode: row.approval_mode,
    workers_can_create_backlog_items: Boolean(row.workers_can_create_backlog_items),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function inviteUrlFor(row = {}, appBaseUrl = '') {
  const baseUrl = String(appBaseUrl || process.env.FRONTEND_URL || process.env.VITE_APP_URL || 'https://frontend-jobdone1.vercel.app').replace(/\/+$/, '');
  return `${baseUrl}/invite?token=${encodeURIComponent(tokenForInviteId(row.id))}`;
}

export function presentTeamInvite(row = {}, appBaseUrl = '') {
  return {
    id: row.id,
    team_id: row.team_id,
    email: row.email,
    status: row.status,
    invited_by_email: row.invited_by_email,
    accepted_at: row.accepted_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    invite_url: row.status === 'pending' ? inviteUrlFor(row, appBaseUrl) : null,
  };
}

async function sendInviteMagicLink(email, inviteUrl) {
  if (!supabase) {
    const error = new Error('Auth service not configured');
    error.statusCode = 503;
    throw error;
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: inviteUrl,
    },
  });
  if (error) {
    const sendError = new Error(error.message || 'Could not send invite email');
    sendError.statusCode = error.status || 502;
    throw sendError;
  }
}

export function presentTeamMember(row = {}) {
  return {
    id: row.id,
    team_id: row.team_id,
    email: row.email,
    role: row.role,
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

export function teamSettingsFromTemplate(template) {
  return TEMPLATE_SETTINGS[template] || TEMPLATE_SETTINGS.high_trust;
}

export function validateTeamInput(input = {}) {
  const name = String(input.name || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!name) {
    const error = new Error('Team name is required');
    error.statusCode = 400;
    throw error;
  }
  if (name.length > 80) {
    const error = new Error('Team name must be 80 characters or fewer');
    error.statusCode = 400;
    throw error;
  }
  const settings = teamSettingsFromTemplate(input.template);
  return { name, ...settings, updated_at: nowIso() };
}

async function ensureDogfoodTeam(db = jobdoneDb) {
  if (!db) return null;
  const { data: existing, error: existingError } = await db
    .from('teams')
    .select('*')
    .eq('id', DOGFOOD_TEAM_ID)
    .limit(1)
    .single();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data, error } = await db
    .from('teams')
    .insert([{ id: DOGFOOD_TEAM_ID, name: 'Dogfood Team', ...TEMPLATE_SETTINGS.high_trust, updated_at: nowIso() }])
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function ensureTeamOwner(db, teamId, ownerEmail) {
  const email = validateEmail(ownerEmail);
  const timestamp = nowIso();
  const { data, error } = await db
    .from('team_members')
    .upsert([{ team_id: teamId, email, role: 'owner', updated_at: timestamp }], { onConflict: 'team_id,normalized_email' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function pendingInvitesForTeam(db, teamId, appBaseUrl = '') {
  const { data, error } = await db
    .from('team_invites')
    .select('*')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(row => presentTeamInvite(row, appBaseUrl));
}

export async function getTeamSetupState({ db = jobdoneDb, teamId = DOGFOOD_TEAM_ID, ownerEmail = null, appBaseUrl = '' } = {}) {
  if (!db) return { team: null, openBacklogItems: [], submittedApprovalRequests: [] };
  const team = await ensureDogfoodTeam(db);
  if (ownerEmail) await ensureTeamOwner(db, teamId, ownerEmail);

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
    team: presentTeam(team),
    pendingTeamInvites: ownerEmail ? await pendingInvitesForTeam(db, teamId, appBaseUrl) : [],
    inviteAccess: { canCreate: Boolean(ownerEmail) },
    openBacklogItems: (openRows || []).map(presentBacklogItem),
    submittedApprovalRequests: (requestRows || []).map(row => presentApprovalRequest(row, backlogById.get(row.backlog_item_id))),
  };
}

async function latestApprovalRequestsByBacklogId(db, teamId, backlogIds = []) {
  if (!backlogIds.length) return new Map();
  const { data, error } = await db
    .from('approval_requests')
    .select('*')
    .eq('team_id', teamId)
    .in('backlog_item_id', backlogIds)
    .order('submitted_at', { ascending: false });
  if (error) throw error;

  const byBacklogId = new Map();
  for (const row of data || []) {
    if (!byBacklogId.has(row.backlog_item_id)) {
      byBacklogId.set(row.backlog_item_id, presentApprovalRequest(row));
    }
  }
  return byBacklogId;
}

function withApprovalRequest(item, approvalByBacklogId, team = null) {
  return presentBacklogItem({
    ...item,
    approval_request: approvalByBacklogId.get(item.id) || null,
  }, team);
}

export async function getMyWorkState({ db = jobdoneDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) return { team: null, inProgressItems: [], openBacklogItems: [], approvedItems: [] };
  const team = await ensureDogfoodTeam(db);

  const { data: rows, error } = await db
    .from('backlog_items')
    .select('*')
    .eq('team_id', teamId)
    .in('status', ['open', 'claimed', 'submitted', 'needs_more_evidence', 'approved'])
    .order('created_at', { ascending: false });
  if (error) throw error;

  const inProgressRows = (rows || []).filter(row => ['claimed', 'submitted', 'needs_more_evidence'].includes(row.status));
  const approvedRows = (rows || []).filter(row => row.status === 'approved');
  const requestBacklogIds = [...inProgressRows, ...approvedRows].map(row => row.id);
  const approvalByBacklogId = await latestApprovalRequestsByBacklogId(db, teamId, requestBacklogIds);

  return {
    team: presentTeam(team),
    inProgressItems: inProgressRows.map(row => withApprovalRequest(row, approvalByBacklogId, team)),
    openBacklogItems: (rows || []).filter(row => row.status === 'open').map(row => presentBacklogItem(row, team)),
    approvedItems: approvedRows.slice(0, 20).map(row => withApprovalRequest(row, approvalByBacklogId, team)),
  };
}

export async function updateTeamSettings(input, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  await ensureDogfoodTeam(db);
  const values = validateTeamInput(input);
  const { data, error } = await db
    .from('teams')
    .update(values)
    .eq('id', teamId)
    .select('*')
    .single();
  if (error) throw error;
  return presentTeam(data);
}

export async function createTeamInvite(input, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID, ownerEmail, appBaseUrl = '' } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const email = validateEmail(input.email);
  const invitedByEmail = validateEmail(ownerEmail);
  await ensureDogfoodTeam(db);
  await ensureTeamOwner(db, teamId, invitedByEmail);

  const { data: pendingRows, error: pendingError } = await db
    .from('team_invites')
    .select('id')
    .eq('team_id', teamId)
    .eq('status', 'pending');
  if (pendingError) throw pendingError;
  if ((pendingRows || []).length >= MAX_PENDING_INVITES_PER_TEAM) {
    const error = new Error('Team has too many pending invites');
    error.statusCode = 429;
    throw error;
  }

  const { data: recentRows, error: recentError } = await db.query(
    `select id from ${db.schema}.team_invites
     where invited_by_email = $1
       and created_at > now() - interval '1 hour'
     limit ${MAX_INVITES_PER_OWNER_PER_HOUR + 1}`,
    [invitedByEmail]
  );
  if (recentError) throw recentError;
  if ((recentRows || []).length >= MAX_INVITES_PER_OWNER_PER_HOUR) {
    const error = new Error('Too many invites created recently');
    error.statusCode = 429;
    throw error;
  }

  const id = crypto.randomUUID();
  const token = tokenForInviteId(id);
  const timestamp = nowIso();
  const { data, error } = await db
    .from('team_invites')
    .insert([{
      id,
      team_id: teamId,
      email,
      token_hash: hashToken(token),
      status: 'pending',
      invited_by_email: invitedByEmail,
      updated_at: timestamp,
    }])
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      const duplicate = new Error('A pending invite already exists for that email');
      duplicate.statusCode = 409;
      throw duplicate;
    }
    throw error;
  }
  const invite = presentTeamInvite(data, appBaseUrl);
  try {
    await sendInviteMagicLink(email, invite.invite_url);
  } catch (sendError) {
    await db
      .from('team_invites')
      .update({ status: 'revoked', revoked_at: nowIso(), updated_at: nowIso() })
      .eq('id', data.id)
      .eq('status', 'pending');
    throw sendError;
  }
  return invite;
}

export async function revokeTeamInvite(id, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID, ownerEmail } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const invitedByEmail = validateEmail(ownerEmail);
  await ensureDogfoodTeam(db);
  await ensureTeamOwner(db, teamId, invitedByEmail);
  const { data, error } = await db
    .from('team_invites')
    .update({ status: 'revoked', revoked_at: nowIso(), updated_at: nowIso() })
    .eq('id', id)
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .select('*')
    .single();
  if (error) throw error;
  if (!data) {
    const notFound = new Error('Pending invite not found');
    notFound.statusCode = 404;
    throw notFound;
  }
  return presentTeamInvite(data);
}

function parseInviteToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, inviteId] = parts;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inviteId)) return null;
  return { inviteId, tokenHash: hashToken(token) };
}

async function inviteByToken(db, token) {
  const parsed = parseInviteToken(token);
  if (!parsed) return null;
  const { data, error } = await db
    .from('team_invites')
    .select('*')
    .eq('id', parsed.inviteId)
    .eq('token_hash', parsed.tokenHash)
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

export async function inspectTeamInvite(token, { db = jobdoneDb } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const invite = await inviteByToken(db, token);
  if (!invite || invite.status === 'revoked') {
    return { available: false, message: 'This invite is no longer available' };
  }
  const { data: team, error } = await db
    .from('teams')
    .select('*')
    .eq('id', invite.team_id)
    .limit(1)
    .single();
  if (error) throw error;
  if (!team) return { available: false, message: 'This invite is no longer available' };
  return { available: true, invite: presentTeamInvite(invite), team: presentTeam(team) };
}

export async function acceptTeamInvite(token, { db = jobdoneDb, userEmail } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const invite = await inviteByToken(db, token);
  const signedInEmail = normalizedEmail(userEmail);
  if (!invite || invite.status === 'revoked' || signedInEmail !== normalizedEmail(invite.email)) {
    const error = new Error('This invite is no longer available');
    error.statusCode = 404;
    throw error;
  }
  if (invite.status === 'accepted' && invite.accepted_member_id) {
    return { destination: 'my-work', alreadyAccepted: true };
  }

  const timestamp = nowIso();
  const { data: member, error: memberError } = await db
    .from('team_members')
    .upsert([{ team_id: invite.team_id, email: invite.email, role: 'worker', updated_at: timestamp }], { onConflict: 'team_id,normalized_email' })
    .select('*')
    .single();
  if (memberError) throw memberError;

  const { data: acceptedInvite, error: inviteError } = await db
    .from('team_invites')
    .update({ status: 'accepted', accepted_member_id: member.id, accepted_at: timestamp, updated_at: timestamp })
    .eq('id', invite.id)
    .select('*')
    .single();
  if (inviteError) throw inviteError;
  return {
    destination: 'my-work',
    alreadyAccepted: invite.status === 'accepted',
    invite: presentTeamInvite(acceptedInvite),
    teamMember: presentTeamMember(member),
  };
}

export async function createBacklogItem(input, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
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

export async function updateOpenBacklogItem(id, input, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
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

export async function deleteOpenBacklogItem(id, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
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

export async function claimBacklogItem(id, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  await ensureDogfoodTeam(db);
  const { data, error } = await db
    .from('backlog_items')
    .update({ status: 'claimed', updated_at: nowIso() })
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

function validateEvidenceText(value) {
  const evidenceText = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!evidenceText) {
    const error = new Error('Evidence is required');
    error.statusCode = 400;
    throw error;
  }
  if (evidenceText.length > 1000) {
    const error = new Error('Evidence must be 1000 characters or fewer');
    error.statusCode = 400;
    throw error;
  }
  return evidenceText;
}

export async function submitClaimedBacklogItem(id, input = {}, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const team = await ensureDogfoodTeam(db);
  const evidenceText = validateEvidenceText(input.evidence_text || input.evidenceText);
  const nextStatus = team.approval_mode === 'auto' ? 'approved' : 'submitted';
  const timestamp = nowIso();

  const { data: backlogItem, error: backlogError } = await db
    .from('backlog_items')
    .update({ status: nextStatus, updated_at: timestamp })
    .eq('id', id)
    .eq('team_id', teamId)
    .in('status', ['claimed', 'needs_more_evidence'])
    .select('*')
    .single();
  if (backlogError) throw backlogError;
  if (!backlogItem) {
    const notFound = new Error('Claimed Backlog Item not found');
    notFound.statusCode = 404;
    throw notFound;
  }

  const { data: approvalRequest, error: requestError } = await db
    .from('approval_requests')
    .insert([{
      team_id: teamId,
      backlog_item_id: id,
      status: nextStatus === 'approved' ? 'approved' : 'submitted',
      evidence_text: evidenceText,
      submitted_at: timestamp,
      decided_at: nextStatus === 'approved' ? timestamp : null,
      updated_at: timestamp,
    }])
    .select('*')
    .single();
  if (requestError) throw requestError;

  return {
    backlogItem: presentBacklogItem(backlogItem),
    approvalRequest: presentApprovalRequest(approvalRequest, backlogItem),
  };
}

export async function decideApprovalRequest(id, decision, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
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
