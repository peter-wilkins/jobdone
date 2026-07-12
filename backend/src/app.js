import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerSyncRoutes } from './routes/sync.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerQueryRoutes } from './routes/queries.js';
import { registerStructureRoutes } from './routes/structure.js';
import { registerLocationRoutes } from './routes/locations.js';
import { registerLocalReplicaRoutes } from './routes/localReplica.js';
import { registerTeamRoutes } from './routes/teams.js';
import { registerWaterWalkRoutes } from './routes/waterWalk.js';
import { registerShinyProjectRoutes } from './routes/shinyProjects.js';
import { registerRequestIdHooks } from './services/requestId.js';
import { BUILD_ID_HEADER, registerBuildInfoHooks } from './services/buildInfo.js';
import { createCorsOriginValidator } from './services/cors.js';

export function createApp(options = {}) {
  const fastify = Fastify({
    logger: true,
    bodyLimit: 25 * 1024 * 1024,
    ...options,
  });

  fastify.register(cors, {
    origin: createCorsOriginValidator(options.allowedCorsOrigins),
    exposedHeaders: ['x-jobdone-request-id', BUILD_ID_HEADER],
  });

  registerRequestIdHooks(fastify);
  registerBuildInfoHooks(fastify, options.buildInfo);

  fastify.register(registerSyncRoutes);
  fastify.register(registerFeedbackRoutes);
  fastify.register(registerQueryRoutes);
  fastify.register(registerStructureRoutes);
  fastify.register(registerLocationRoutes);
  fastify.register(registerLocalReplicaRoutes);
  fastify.register(registerTeamRoutes);
  fastify.register(registerWaterWalkRoutes);
  fastify.register(registerShinyProjectRoutes);

  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'JobDone Backend',
  }));

  fastify.get('/', async () => {
    return {
      service: 'JobDone Backend',
      version: '1.0.0',
      endpoints: {
        health: 'GET /health',
      },
    };
  });

  fastify.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;
    fastify.log.error({
      err: error,
      request_id: request.requestId,
      method: request.method,
      route: request.routeOptions?.url || request.routerPath || request.url,
      error_kind: error.code || error.name || 'Error',
    }, 'request_failed');
    reply.status(statusCode).send({
      error: statusCode === 413 ? 'Request body too large' : 'Internal server error',
      message: process.env.NODE_ENV === 'development' || statusCode === 413 ? error.message : undefined,
    });
  });

  return fastify;
}
