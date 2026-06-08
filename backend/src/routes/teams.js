import {
  claimBacklogItem,
  acceptTeamInvite,
  createTeamInvite,
  createAndClaimBacklogItem,
  createBacklogItem,
  decideApprovalRequest,
  deleteOwnedTeam,
  deleteOpenBacklogItem,
  getTeamReviewState,
  getTeamSetupState,
  getMyWorkState,
  inspectTeamInvite,
  resendTeamInvite,
  revokeTeamInvite,
  submitClaimedBacklogItem,
  updateTeamSettings,
  updateOpenBacklogItem,
} from '../services/teams.js';
import { optionalAuth, requireAuth } from '../services/auth.js';

function errorReply(reply, error) {
  const statusCode = error.statusCode || 500;
  return reply.status(statusCode).send({
    error: statusCode >= 500 ? 'Team request failed' : error.message,
    message: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
}

function appBaseUrlFromRequest(request) {
  return request.headers.origin || process.env.FRONTEND_URL || process.env.VITE_APP_URL || '';
}

function teamIdFromRequest(request) {
  return request.query?.team_id || request.body?.team_id || null;
}

export async function registerTeamRoutes(fastify, deps = {}) {
  const getSetupState = deps.getTeamSetupState || getTeamSetupState;
  const getReviewState = deps.getTeamReviewState || getTeamReviewState;
  const getWorkState = deps.getMyWorkState || deps.getTeamWorkState || getMyWorkState;
  const updateTeam = deps.updateTeamSettings || updateTeamSettings;
  const createItem = deps.createBacklogItem || createBacklogItem;
  const createAndClaimItem = deps.createAndClaimBacklogItem || createAndClaimBacklogItem;
  const updateItem = deps.updateOpenBacklogItem || updateOpenBacklogItem;
  const deleteTeam = deps.deleteOwnedTeam || deleteOwnedTeam;
  const deleteItem = deps.deleteOpenBacklogItem || deleteOpenBacklogItem;
  const claimItem = deps.claimBacklogItem || claimBacklogItem;
  const submitItem = deps.submitClaimedBacklogItem || submitClaimedBacklogItem;
  const decideRequest = deps.decideApprovalRequest || decideApprovalRequest;
  const createInvite = deps.createTeamInvite || createTeamInvite;
  const resendInvite = deps.resendTeamInvite || resendTeamInvite;
  const revokeInvite = deps.revokeTeamInvite || revokeTeamInvite;
  const inspectInvite = deps.inspectTeamInvite || inspectTeamInvite;
  const acceptInvite = deps.acceptTeamInvite || acceptTeamInvite;
  const maybeAuth = deps.optionalAuth || optionalAuth;
  const mustAuth = deps.requireAuth || requireAuth;

  fastify.get('/api/teams/setup', async (request, reply) => {
    try {
      const user = await maybeAuth(request, reply);
      if (reply.sent) return reply;
      return await getSetupState({ ownerEmail: user?.email || null, teamId: teamIdFromRequest(request), appBaseUrl: appBaseUrlFromRequest(request) });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.patch('/api/teams/setup', async (request, reply) => {
    try {
      const user = await mustAuth(request, reply);
      if (!user) return reply;
      const team = await updateTeam(request.body || {}, { ownerEmail: user.email, teamId: teamIdFromRequest(request) });
      return { team };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.get('/api/teams/review', async (request, reply) => {
    try {
      const user = await maybeAuth(request, reply);
      if (reply.sent) return reply;
      return await getReviewState({ ownerEmail: user?.email || null });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.get('/api/my-work', async (request, reply) => {
    try {
      const user = await maybeAuth(request, reply);
      if (reply.sent) return reply;
      return await getWorkState({ userEmail: user?.email || null });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.get('/api/teams/work', async (request, reply) => {
    try {
      const user = await maybeAuth(request, reply);
      if (reply.sent) return reply;
      return await getWorkState({ userEmail: user?.email || null, teamId: teamIdFromRequest(request) });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.delete('/api/teams/:id', async (request, reply) => {
    try {
      const user = await mustAuth(request, reply);
      if (!user) return reply;
      return await deleteTeam(request.params.id, { ownerEmail: user.email });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/backlog-items', async (request, reply) => {
    try {
      const user = await mustAuth(request, reply);
      if (!user) return reply;
      const backlogItem = await createItem(request.body || {}, { ownerEmail: user.email, teamId: teamIdFromRequest(request) });
      return reply.status(201).send({ backlogItem });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/backlog-items/create-and-claim', async (request, reply) => {
    try {
      const user = await mustAuth(request, reply);
      if (!user) return reply;
      const backlogItem = await createAndClaimItem(request.body || {}, { userEmail: user.email, teamId: teamIdFromRequest(request) });
      return reply.status(201).send({ backlogItem });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.patch('/api/teams/backlog-items/:id', async (request, reply) => {
    try {
      const user = await mustAuth(request, reply);
      if (!user) return reply;
      const backlogItem = await updateItem(request.params.id, request.body || {}, { ownerEmail: user.email, teamId: teamIdFromRequest(request) });
      return { backlogItem };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.delete('/api/teams/backlog-items/:id', async (request, reply) => {
    try {
      const user = await mustAuth(request, reply);
      if (!user) return reply;
      return await deleteItem(request.params.id, { ownerEmail: user.email, teamId: teamIdFromRequest(request) });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/backlog-items/:id/claim', async (request, reply) => {
    try {
      const user = await maybeAuth(request, reply);
      if (reply.sent) return reply;
      const backlogItem = await claimItem(request.params.id, { userEmail: user?.email || null });
      return { backlogItem };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/backlog-items/:id/submit', async (request, reply) => {
    try {
      const user = await maybeAuth(request, reply);
      if (reply.sent) return reply;
      return await submitItem(request.params.id, request.body || {}, { userEmail: user?.email || null });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/approval-requests/:id/decision', async (request, reply) => {
    try {
      const user = await mustAuth(request, reply);
      if (!user) return reply;
      const approvalRequest = await decideRequest(request.params.id, request.body?.decision, { ownerEmail: user.email, teamId: teamIdFromRequest(request) });
      return { approvalRequest };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/invites', async (request, reply) => {
    try {
      const user = await mustAuth(request, reply);
      if (!user) return reply;
      const invite = await createInvite(request.body || {}, {
        ownerEmail: user.email,
        teamId: teamIdFromRequest(request),
        appBaseUrl: appBaseUrlFromRequest(request),
      });
      return reply.status(201).send({ invite });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.delete('/api/teams/invites/:id', async (request, reply) => {
    try {
      const user = await mustAuth(request, reply);
      if (!user) return reply;
      const invite = await revokeInvite(request.params.id, { ownerEmail: user.email, teamId: teamIdFromRequest(request) });
      return { invite };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/invites/:id/resend', async (request, reply) => {
    try {
      const user = await mustAuth(request, reply);
      if (!user) return reply;
      const invite = await resendInvite(request.params.id, {
        ownerEmail: user.email,
        teamId: teamIdFromRequest(request),
        appBaseUrl: appBaseUrlFromRequest(request),
      });
      return { invite };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.get('/api/teams/invites/:token', async (request, reply) => {
    try {
      return await inspectInvite(request.params.token);
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/invites/:token/accept', async (request, reply) => {
    try {
      const user = await mustAuth(request, reply);
      if (!user) return reply;
      return await acceptInvite(request.params.token, { userEmail: user.email });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
}
