import { requireAuth } from '../services/auth.js';
import { createLocalReplicaStore } from '../services/localReplicaStore.js';
import {
  parsePullRequest,
  parsePullResponse,
  parsePushRequest,
  parsePushResponse,
} from '../contracts/localReplica.js';

const defaultStore = createLocalReplicaStore({
  connectionString: process.env.LOCAL_REPLICA_DB_URL,
  schema: process.env.LOCAL_REPLICA_SCHEMA || 'jobdone_next',
});

function assertParsed(parsed, fallbackError) {
  if (parsed.success) return parsed.data;
  const error = new Error(parsed.error || fallbackError);
  error.statusCode = 400;
  error.errors = parsed.errors;
  throw error;
}

function actorDeviceId(request) {
  return request.headers['x-jobdone-device-id'] || request.headers['x-device-id'] || null;
}

export async function registerLocalReplicaRoutes(fastify, deps = {}) {
  const auth = deps.requireAuth ?? requireAuth;
  const store = deps.localReplicaStore ?? defaultStore;

  fastify.post('/api/local-replica/push', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;
    if (!store?.configured) return reply.status(503).send({ error: 'Local Replica database not configured' });

    try {
      const pushRequest = assertParsed(parsePushRequest(request.body), 'Invalid Local Replica push request');
      const response = await store.push({
        actorUserId: user.id,
        actorEmail: user.email || null,
        actorDeviceId: actorDeviceId(request),
        request: pushRequest,
      });
      return assertParsed(parsePushResponse(response), 'Invalid Local Replica push response');
    } catch (error) {
      if (error.statusCode === 400) {
        return reply.status(400).send({ error: error.message, errors: error.errors || [error.message] });
      }
      request.log.error({ err: error }, 'local_replica_push_failed');
      return reply.status(500).send({ error: error.message || 'Local Replica push failed' });
    }
  });

  fastify.post('/api/local-replica/pull', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;
    if (!store?.configured) return reply.status(503).send({ error: 'Local Replica database not configured' });

    try {
      const pullRequest = assertParsed(parsePullRequest(request.body), 'Invalid Local Replica pull request');
      const response = await store.pull({
        actorUserId: user.id,
        request: pullRequest,
      });
      return assertParsed(parsePullResponse(response), 'Invalid Local Replica pull response');
    } catch (error) {
      if (error.statusCode === 400) {
        return reply.status(400).send({ error: error.message, errors: error.errors || [error.message] });
      }
      request.log.error({ err: error }, 'local_replica_pull_failed');
      return reply.status(500).send({ error: error.message || 'Local Replica pull failed' });
    }
  });
}
