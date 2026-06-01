import {
  claimBacklogItem,
  createBacklogItem,
  decideApprovalRequest,
  deleteOpenBacklogItem,
  getChildChoremoreState,
  getParentChoremoreState,
  submitBacklogItemEvidence,
  updateOpenBacklogItem,
} from '../services/choremore.js';

function errorReply(reply, error) {
  const statusCode = error.statusCode || 500;
  return reply.status(statusCode).send({
    error: statusCode >= 500 ? 'Choremore request failed' : error.message,
    message: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
}

export async function registerChoremoreRoutes(fastify, deps = {}) {
  const getParentState = deps.getParentChoremoreState || getParentChoremoreState;
  const getChildState = deps.getChildChoremoreState || getChildChoremoreState;
  const createItem = deps.createBacklogItem || createBacklogItem;
  const updateItem = deps.updateOpenBacklogItem || updateOpenBacklogItem;
  const deleteItem = deps.deleteOpenBacklogItem || deleteOpenBacklogItem;
  const claimItem = deps.claimBacklogItem || claimBacklogItem;
  const submitEvidence = deps.submitBacklogItemEvidence || submitBacklogItemEvidence;
  const decideRequest = deps.decideApprovalRequest || decideApprovalRequest;

  fastify.get('/api/choremore/parent', async (_request, reply) => {
    try {
      return await getParentState();
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.get('/api/choremore/child', async (_request, reply) => {
    try {
      return await getChildState();
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/choremore/backlog-items', async (request, reply) => {
    try {
      const backlogItem = await createItem(request.body || {});
      return reply.status(201).send({ backlogItem });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.patch('/api/choremore/backlog-items/:id', async (request, reply) => {
    try {
      const backlogItem = await updateItem(request.params.id, request.body || {});
      return { backlogItem };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.delete('/api/choremore/backlog-items/:id', async (request, reply) => {
    try {
      return await deleteItem(request.params.id);
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/choremore/backlog-items/:id/claim', async (request, reply) => {
    try {
      const backlogItem = await claimItem(request.params.id);
      return { backlogItem };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/choremore/backlog-items/:id/submit', async (request, reply) => {
    try {
      return await submitEvidence(request.params.id, request.body || {});
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  fastify.post('/api/choremore/approval-requests/:id/decision', async (request, reply) => {
    try {
      const approvalRequest = await decideRequest(request.params.id, request.body?.decision);
      return { approvalRequest };
    } catch (error) {
      return errorReply(reply, error);
    }
  });
}
