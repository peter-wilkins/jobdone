import {
  claimBacklogItem,
  acceptTeamInvite,
  createTeamInvite,
  createBacklogItem,
  decideApprovalRequest,
  deleteOpenBacklogItem,
  getTeamSetupState,
  getMyWorkState,
  inspectTeamInvite,
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

export async function registerTeamRoutes(fastify, deps = {}) {
  const getSetupState = deps.getTeamSetupState || getTeamSetupState;
  const getWorkState = deps.getMyWorkState || deps.getTeamWorkState || getMyWorkState;
  const updateTeam = deps.updateTeamSettings || updateTeamSettings;
  const createItem = deps.createBacklogItem || createBacklogItem;
  const updateItem = deps.updateOpenBacklogItem || updateOpenBacklogItem;
  const deleteItem = deps.deleteOpenBacklogItem || deleteOpenBacklogItem;
  const claimItem = deps.claimBacklogItem || claimBacklogItem;
  const submitItem = deps.submitClaimedBacklogItem || submitClaimedBacklogItem;
  const decideRequest = deps.decideApprovalRequest || decideApprovalRequest;
  const createInvite = deps.createTeamInvite || createTeamInvite;
  const revokeInvite = deps.revokeTeamInvite || revokeTeamInvite;
  const inspectInvite = deps.inspectTeamInvite || inspectTeamInvite;
  const acceptInvite = deps.acceptTeamInvite || acceptTeamInvite;
  const maybeAuth = deps.optionalAuth || optionalAuth;
  const mustAuth = deps.requireAuth || requireAuth;

  fastify.get('/api/teams/setup', async (request, reply) => {
    try {
      const user = await maybeAuth(request, reply);
      if (reply.sent) return reply;
      return await getSetupState({ ownerEmail: user?.email || null, appBaseUrl: appBaseUrlFromRequest(request) });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.patch('/api/teams/setup', async (request, reply) => {
    try {
      const team = await updateTeam(request.body || {});
      return { team };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.get('/api/my-work', async (_request, reply) => {
    try {
      return await getWorkState();
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.get('/api/teams/work', async (_request, reply) => {
    try {
      return await getWorkState();
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/backlog-items', async (request, reply) => {
    try {
      const backlogItem = await createItem(request.body || {});
      return reply.status(201).send({ backlogItem });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.patch('/api/teams/backlog-items/:id', async (request, reply) => {
    try {
      const backlogItem = await updateItem(request.params.id, request.body || {});
      return { backlogItem };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.delete('/api/teams/backlog-items/:id', async (request, reply) => {
    try {
      return await deleteItem(request.params.id);
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/backlog-items/:id/claim', async (request, reply) => {
    try {
      const backlogItem = await claimItem(request.params.id);
      return { backlogItem };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/backlog-items/:id/submit', async (request, reply) => {
    try {
      return await submitItem(request.params.id, request.body || {});
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/teams/approval-requests/:id/decision', async (request, reply) => {
    try {
      const approvalRequest = await decideRequest(request.params.id, request.body?.decision);
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
      const invite = await revokeInvite(request.params.id, { ownerEmail: user.email });
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
