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
    require_owner_self_review: false,
  },
  low_trust: {
    template: 'low_trust',
    points_enabled: false,
    approval_mode: 'manual',
    workers_can_create_backlog_items: false,
    require_owner_self_review: false,
  },
  family: {
    template: 'family',
    points_enabled: true,
    approval_mode: 'manual',
    workers_can_create_backlog_items: false,
    require_owner_self_review: false,
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

function alreadyDoneError(message = 'You have already done this one. Did you mean to resend it?') {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
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
    claimed_by_email: row.claimed_by_email || null,
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
    require_owner_self_review: Boolean(row.require_owner_self_review),
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

export function teamInviteEmailData({ inviteUrl, teamName, inviterEmail } = {}) {
  return {
    email_kind: 'team_invite',
    app_name: 'JobDone',
    team_name: String(teamName || 'a JobDone Team').slice(0, 120),
    inviter_email: String(inviterEmail || '').slice(0, 254),
    invite_url: inviteUrl,
    action_text: 'Join Team',
    headline: `Join ${String(teamName || 'a JobDone Team').slice(0, 120)} on JobDone`,
    message: 'You have been invited to a Team on JobDone. Tap the link to sign in and see your Backlog.',
  };
}

async function sendInviteMagicLink(email, inviteUrl, inviteContext = {}) {
  if (!supabase) {
    const error = new Error('Auth service not configured');
    error.statusCode = 503;
    throw error;
  }
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: inviteUrl,
      data: teamInviteEmailData({ inviteUrl, ...inviteContext }),
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
  return {
    name,
    ...settings,
    require_owner_self_review: Boolean(input.require_owner_self_review),
    updated_at: nowIso(),
  };
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

async function ownedTeamForEmail(db, ownerEmail) {
  const email = normalizedEmail(ownerEmail);
  if (!email) return null;
  const { data, error } = await db.query(
    `select t.*
       from ${db.schema}.team_members tm
       join ${db.schema}.teams t on t.id = tm.team_id
      where tm.normalized_email = $1
        and tm.role = 'owner'
        and not exists (
          select 1
            from ${db.schema}.team_invites ti
           where ti.team_id = tm.team_id
             and ti.normalized_email = tm.normalized_email
             and ti.status = 'accepted'
        )
      order by t.created_at asc
      limit 1`,
    [email]
  );
  if (error) throw error;
  return (data || [])[0] || null;
}

async function teamById(db, teamId) {
  if (!teamId) return null;
  const { data, error } = await db
    .from('teams')
    .select('*')
    .eq('id', teamId)
    .limit(1)
    .single();
  if (error) throw error;
  return data || null;
}

async function teamMembershipsForEmail(db, ownerEmail) {
  const email = normalizedEmail(ownerEmail);
  if (!email) return { ownedTeams: [], memberTeams: [] };
  const { data, error } = await db.query(
    `select
        t.*,
        tm.role as member_role,
        exists (
          select 1
            from ${db.schema}.team_invites ti
           where ti.team_id = tm.team_id
             and ti.normalized_email = tm.normalized_email
             and ti.status = 'accepted'
        ) as joined_by_invite
       from ${db.schema}.team_members tm
       join ${db.schema}.teams t on t.id = tm.team_id
      where tm.normalized_email = $1
      order by t.created_at asc`,
    [email]
  );
  if (error) throw error;
  const ownedTeams = [];
  const memberTeams = [];
  for (const row of data || []) {
    const team = presentTeam(row);
    if (row.member_role === 'owner' && !row.joined_by_invite) {
      ownedTeams.push(team);
    } else {
      memberTeams.push({ team, role: row.member_role || 'worker' });
    }
  }
  return { ownedTeams, memberTeams };
}

async function isTeamOwner(db, teamId, ownerEmail) {
  const email = normalizedEmail(ownerEmail);
  if (!email) return false;
  const { data, error } = await db.query(
    `select tm.id
       from ${db.schema}.team_members tm
      where tm.team_id = $1
        and tm.normalized_email = $2
        and tm.role = 'owner'
        and not exists (
          select 1
            from ${db.schema}.team_invites ti
           where ti.team_id = tm.team_id
             and ti.normalized_email = tm.normalized_email
             and ti.status = 'accepted'
        )
      limit 1`,
    [teamId, email]
  );
  if (error) throw error;
  return Boolean((data || []).length);
}

async function assertTeamOwner(db, teamId, ownerEmail) {
  const allowed = await isTeamOwner(db, teamId, ownerEmail);
  if (!allowed) {
    const error = new Error('Only the Team Owner can manage Team Setup.');
    error.statusCode = 403;
    throw error;
  }
}

async function requireOwnedTeam(db, ownerEmail, teamId = null) {
  if (teamId) {
    await assertTeamOwner(db, teamId, ownerEmail);
    const team = await teamById(db, teamId);
    if (team) return team;
  }
  const team = await ownedTeamForEmail(db, ownerEmail);
  if (!team) {
    const error = new Error('Create a Team first.');
    error.statusCode = 400;
    throw error;
  }
  return team;
}

async function teamsForWorkEmail(db, userEmail) {
  const email = normalizedEmail(userEmail);
  if (!email) return [];
  const { data, error } = await db.query(
    `select t.*
       from ${db.schema}.team_members tm
       join ${db.schema}.teams t on t.id = tm.team_id
      where tm.normalized_email = $1
      order by t.created_at asc`,
    [email]
  );
  if (error) throw error;
  return data || [];
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

async function membersForTeam(db, teamId) {
  const { data, error } = await db
    .from('team_members')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(presentTeamMember);
}

export async function getTeamSetupState({ db = jobdoneDb, teamId = DOGFOOD_TEAM_ID, ownerEmail = null, appBaseUrl = '' } = {}) {
  const empty = { team: null, ownedTeams: [], memberTeams: [], teamMembers: [], inviteAccess: { canCreate: false }, canManage: false, pendingTeamInvites: [], openBacklogItems: [], submittedApprovalRequests: [] };
  if (!db) return empty;
  if (!ownerEmail) return empty;
  const memberships = await teamMembershipsForEmail(db, ownerEmail);
  const selectedOwnedTeam = teamId
    ? memberships.ownedTeams.find(team => team.id === teamId)
    : null;
  const team = selectedOwnedTeam || memberships.ownedTeams[0] || null;
  if (!team) {
    return { ...empty, ...memberships, canManage: true };
  }
  const setupTeamId = team.id || teamId;

  const { data: openRows, error: openError } = await db
    .from('backlog_items')
    .select('*')
    .eq('team_id', setupTeamId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (openError) throw openError;

  const { data: requestRows, error: requestError } = await db
    .from('approval_requests')
    .select('*')
    .eq('team_id', setupTeamId)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false });
  if (requestError) throw requestError;

  const backlogIds = [...new Set((requestRows || []).map(row => row.backlog_item_id).filter(Boolean))];
  const backlogById = new Map();
  if (backlogIds.length) {
    const { data: backlogRows, error: backlogError } = await db
      .from('backlog_items')
      .select('*')
      .eq('team_id', setupTeamId)
      .in('id', backlogIds);
    if (backlogError) throw backlogError;
    for (const row of backlogRows || []) {
      backlogById.set(row.id, row);
    }
  }

  return {
    team: presentTeam(team),
    ownedTeams: memberships.ownedTeams,
    memberTeams: memberships.memberTeams,
    teamMembers: await membersForTeam(db, setupTeamId),
    canManage: true,
    pendingTeamInvites: await pendingInvitesForTeam(db, setupTeamId, appBaseUrl),
    inviteAccess: { canCreate: true },
    openBacklogItems: (openRows || []).map(presentBacklogItem),
    submittedApprovalRequests: (requestRows || []).map(row => presentApprovalRequest(row, backlogById.get(row.backlog_item_id))),
  };
}

export async function getTeamReviewState({ db = jobdoneDb, ownerEmail = null } = {}) {
  const empty = { ownedTeams: [], canManage: false, activeApprovalRequests: [], recentDecisions: [] };
  if (!db || !ownerEmail) return empty;
  const memberships = await teamMembershipsForEmail(db, ownerEmail);
  const ownedTeams = memberships.ownedTeams || [];
  if (!ownedTeams.length) {
    return { ...empty, ownedTeams, canManage: true };
  }

  const teamIds = ownedTeams.map(team => team.id);
  const teamById = new Map(ownedTeams.map(team => [team.id, team]));
  const { data: requestRows, error: requestError } = await db
    .from('approval_requests')
    .select('*')
    .in('team_id', teamIds)
    .in('status', ['submitted', 'needs_more_evidence'])
    .order('submitted_at', { ascending: true });
  if (requestError) throw requestError;

  const backlogIds = [...new Set((requestRows || []).map(row => row.backlog_item_id).filter(Boolean))];
  const backlogById = new Map();
  if (backlogIds.length) {
    const { data: backlogRows, error: backlogError } = await db
      .from('backlog_items')
      .select('*')
      .in('team_id', teamIds)
      .in('id', backlogIds);
    if (backlogError) throw backlogError;
    for (const row of backlogRows || []) {
      backlogById.set(row.id, row);
    }
  }

  return {
    ownedTeams,
    canManage: true,
    activeApprovalRequests: (requestRows || []).map(row => {
      const backlogItem = backlogById.get(row.backlog_item_id);
      const presented = presentApprovalRequest(row, backlogItem);
      presented.team = presentTeam(teamById.get(row.team_id) || {});
      return presented;
    }),
    recentDecisions: [],
  };
}

async function latestApprovalRequestsByBacklogId(db, teamIds, backlogIds = []) {
  if (!backlogIds.length) return new Map();
  const query = db
    .from('approval_requests')
    .select('*')
    .in('backlog_item_id', backlogIds)
    .order('submitted_at', { ascending: false });
  if (Array.isArray(teamIds)) {
    query.in('team_id', teamIds);
  } else {
    query.eq('team_id', teamIds);
  }
  const { data, error } = await query;
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

export function shouldAutoApproveSubmission(team = {}, { submitterEmail = null, claimedByEmail = null, isSubmitterOwner = false } = {}) {
  if (team.approval_mode === 'auto') return true;
  if (!isSubmitterOwner || team.require_owner_self_review) return false;
  const submitter = normalizedEmail(submitterEmail);
  const claimant = normalizedEmail(claimedByEmail);
  return Boolean(submitter && claimant && submitter === claimant);
}

export function isBacklogItemClaimedByEmail(row = {}, userEmail = null) {
  const email = normalizedEmail(userEmail);
  if (!email) return true;
  return normalizedEmail(row.claimed_by_email) === email;
}

export async function getMyWorkState({ db = jobdoneDb, teamId = DOGFOOD_TEAM_ID, userEmail = null } = {}) {
  if (!db) return { team: null, inProgressItems: [], openBacklogItems: [], approvedItems: [] };
  const teams = userEmail ? await teamsForWorkEmail(db, userEmail) : [await ensureDogfoodTeam(db)];
  const visibleTeams = teams.length ? teams : [];
  const teamIds = visibleTeams.map(team => team.id);
  const teamByIdMap = new Map(visibleTeams.map(team => [team.id, team]));
  if (!teamIds.length) {
    return { team: null, inProgressItems: [], openBacklogItems: [], approvedItems: [] };
  }

  const query = db
    .from('backlog_items')
    .select('*')
    .in('status', ['open', 'claimed', 'submitted', 'needs_more_evidence', 'approved'])
    .order('created_at', { ascending: false });
  if (userEmail) {
    query.in('team_id', teamIds);
  } else {
    query.eq('team_id', teamId);
  }
  const { data: rows, error } = await query;
  if (error) throw error;

  const inProgressRows = (rows || []).filter(row =>
    ['claimed', 'submitted', 'needs_more_evidence'].includes(row.status) &&
    isBacklogItemClaimedByEmail(row, userEmail)
  );
  const approvedRows = (rows || []).filter(row =>
    row.status === 'approved' &&
    isBacklogItemClaimedByEmail(row, userEmail)
  );
  const requestBacklogIds = [...inProgressRows, ...approvedRows].map(row => row.id);
  const approvalByBacklogId = await latestApprovalRequestsByBacklogId(db, userEmail ? teamIds : teamId, requestBacklogIds);
  const teamForRow = row => teamByIdMap.get(row.team_id) || visibleTeams[0] || null;

  return {
    team: visibleTeams.length === 1 ? presentTeam(visibleTeams[0]) : null,
    teams: visibleTeams.map(presentTeam),
    inProgressItems: inProgressRows.map(row => withApprovalRequest(row, approvalByBacklogId, teamForRow(row))),
    openBacklogItems: (rows || []).filter(row => row.status === 'open').map(row => presentBacklogItem(row, teamForRow(row))),
    approvedItems: approvedRows.slice(0, 20).map(row => withApprovalRequest(row, approvalByBacklogId, teamForRow(row))),
  };
}

export async function deleteOwnedTeam(id, { db = jobdoneDb, ownerEmail } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  await assertTeamOwner(db, id, ownerEmail);
  const { data: existing, error: existingError } = await db
    .from('teams')
    .select('*')
    .eq('id', id)
    .limit(1)
    .single();
  if (existingError) throw existingError;
  if (!existing) {
    const error = new Error('Team not found');
    error.statusCode = 404;
    throw error;
  }
  const { error } = await db
    .from('teams')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return { success: true, team: presentTeam(existing) };
}

export async function updateTeamSettings(input, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID, ownerEmail } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const values = validateTeamInput(input);
  const ownedTeam = input.create_new_team ? null : (teamId ? await requireOwnedTeam(db, ownerEmail, teamId) : await ownedTeamForEmail(db, ownerEmail));
  if (!ownedTeam) {
    const id = crypto.randomUUID();
    const { data: team, error: teamError } = await db
      .from('teams')
      .insert([{ id, ...values }])
      .select('*')
      .single();
    if (teamError) throw teamError;
    await ensureTeamOwner(db, id, ownerEmail);
    return presentTeam(team);
  }
  const setupTeamId = ownedTeam.id || teamId;
  await assertTeamOwner(db, setupTeamId, ownerEmail);
  const { data, error } = await db
    .from('teams')
    .update(values)
    .eq('id', setupTeamId)
    .select('*')
    .single();
  if (error) throw error;
  return presentTeam(data);
}

export async function createTeamInvite(input, { db = jobdoneDb, ownerEmail, teamId: selectedTeamId = null, appBaseUrl = '' } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const email = validateEmail(input.email);
  const invitedByEmail = validateEmail(ownerEmail);
  const ownedTeam = await requireOwnedTeam(db, invitedByEmail, input.team_id || selectedTeamId);
  const teamId = ownedTeam.id;

  const { data: existingMemberRows, error: existingMemberError } = await db
    .from('team_members')
    .select('id')
    .eq('team_id', teamId)
    .eq('normalized_email', email)
    .limit(1);
  if (existingMemberError) throw existingMemberError;
  if ((existingMemberRows || []).length) {
    throw alreadyDoneError('This person is already in the Team.');
  }

  const { data: existingInviteRows, error: existingInviteError } = await db
    .from('team_invites')
    .select('id')
    .eq('team_id', teamId)
    .eq('normalized_email', email)
    .eq('status', 'pending')
    .limit(1);
  if (existingInviteError) throw existingInviteError;
  if ((existingInviteRows || []).length) {
    throw alreadyDoneError();
  }

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
      throw alreadyDoneError();
    }
    throw error;
  }
  const invite = presentTeamInvite(data, appBaseUrl);
  try {
    await sendInviteMagicLink(email, invite.invite_url, {
      teamName: ownedTeam.name,
      inviterEmail: invitedByEmail,
    });
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

export async function resendTeamInvite(id, { db = jobdoneDb, ownerEmail, teamId: selectedTeamId = null, appBaseUrl = '' } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const invitedByEmail = validateEmail(ownerEmail);
  const ownedTeam = await requireOwnedTeam(db, invitedByEmail, selectedTeamId);
  const teamId = ownedTeam.id;

  const { data, error } = await db
    .from('team_invites')
    .select('*')
    .eq('id', id)
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .limit(1)
    .single();
  if (error) throw error;
  if (!data) {
    const notFound = new Error('Pending invite not found');
    notFound.statusCode = 404;
    throw notFound;
  }

  const invite = presentTeamInvite(data, appBaseUrl);
  await sendInviteMagicLink(invite.email, invite.invite_url, {
    teamName: ownedTeam.name,
    inviterEmail: invitedByEmail,
  });
  return invite;
}

export async function revokeTeamInvite(id, { db = jobdoneDb, ownerEmail, teamId: selectedTeamId = null } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const invitedByEmail = validateEmail(ownerEmail);
  const ownedTeam = await requireOwnedTeam(db, invitedByEmail, selectedTeamId);
  const teamId = ownedTeam.id;
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

export async function createBacklogItem(input, { db = jobdoneDb, ownerEmail, teamId: selectedTeamId = null } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const ownedTeam = await requireOwnedTeam(db, ownerEmail, selectedTeamId);
  const teamId = ownedTeam.id;
  const values = validateBacklogItemInput(input);
  const { data, error } = await db
    .from('backlog_items')
    .insert([{ team_id: teamId, ...values, status: 'open', updated_at: nowIso() }])
    .select('*')
    .single();
  if (error) throw error;
  return presentBacklogItem(data);
}

export async function updateOpenBacklogItem(id, input, { db = jobdoneDb, ownerEmail, teamId: selectedTeamId = null } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const ownedTeam = await requireOwnedTeam(db, ownerEmail, selectedTeamId);
  const teamId = ownedTeam.id;
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

export async function deleteOpenBacklogItem(id, { db = jobdoneDb, ownerEmail, teamId: selectedTeamId = null } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const ownedTeam = await requireOwnedTeam(db, ownerEmail, selectedTeamId);
  const teamId = ownedTeam.id;
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

export async function claimBacklogItem(id, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID, userEmail = null } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const visibleTeams = userEmail ? await teamsForWorkEmail(db, userEmail) : [await ensureDogfoodTeam(db)];
  const teamIds = visibleTeams.map(team => team.id);
  if (!teamIds.length) {
    const notFound = new Error('Open Backlog Item not found');
    notFound.statusCode = 404;
    throw notFound;
  }
  const query = db
    .from('backlog_items')
    .update({ status: 'claimed', claimed_by_email: normalizedEmail(userEmail) || null, updated_at: nowIso() })
    .eq('id', id)
    .eq('status', 'open')
    .select('*')
    .single();
  if (userEmail) {
    query.in('team_id', teamIds);
  } else {
    query.eq('team_id', teamId);
  }
  const { data, error } = await query;
  if (error) throw error;
  if (!data) {
    const notFound = new Error('Great news! Someone else just claimed this task.');
    notFound.statusCode = 409;
    throw notFound;
  }
  const team = visibleTeams.find(candidate => candidate.id === data.team_id) || visibleTeams[0] || null;
  return presentBacklogItem(data, team);
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

export async function submitClaimedBacklogItem(id, input = {}, { db = jobdoneDb, teamId = DOGFOOD_TEAM_ID, userEmail = null } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const visibleTeams = userEmail ? await teamsForWorkEmail(db, userEmail) : [await ensureDogfoodTeam(db)];
  const teamIds = visibleTeams.map(team => team.id);
  if (!teamIds.length) {
    const notFound = new Error('Claimed Backlog Item not found');
    notFound.statusCode = 404;
    throw notFound;
  }
  const evidenceText = validateEvidenceText(input.evidence_text || input.evidenceText);
  const timestamp = nowIso();

  const existingQuery = db
    .from('backlog_items')
    .select('*')
    .eq('id', id)
    .in('status', ['claimed', 'needs_more_evidence'])
    .limit(1)
    .single();
  if (userEmail) {
    existingQuery.in('team_id', teamIds);
  } else {
    existingQuery.eq('team_id', teamId);
  }
  const { data: existingBacklogItem, error: existingError } = await existingQuery;
  if (existingError) throw existingError;
  if (!existingBacklogItem) {
    const notFound = new Error('Claimed Backlog Item not found');
    notFound.statusCode = 404;
    throw notFound;
  }

  const team = visibleTeams.find(candidate => candidate.id === existingBacklogItem.team_id) || visibleTeams[0];
  const isSubmitterOwner = await isTeamOwner(db, existingBacklogItem.team_id, userEmail);
  const autoApprove = shouldAutoApproveSubmission(team, {
    submitterEmail: userEmail,
    claimedByEmail: existingBacklogItem.claimed_by_email,
    isSubmitterOwner,
  });
  const nextStatus = autoApprove ? 'approved' : 'submitted';

  const { data: backlogItem, error: backlogError } = await db
    .from('backlog_items')
    .update({ status: nextStatus, updated_at: timestamp })
    .eq('id', id)
    .eq('team_id', existingBacklogItem.team_id)
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
      team_id: existingBacklogItem.team_id,
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
    backlogItem: presentBacklogItem(backlogItem, team),
    approvalRequest: presentApprovalRequest(approvalRequest, backlogItem),
  };
}

export async function decideApprovalRequest(id, decision, { db = jobdoneDb, ownerEmail, teamId: selectedTeamId = null } = {}) {
  if (!db) {
    const error = new Error('Team database not configured');
    error.statusCode = 503;
    throw error;
  }
  const ownedTeam = await requireOwnedTeam(db, ownerEmail, selectedTeamId);
  const teamId = ownedTeam.id;
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
