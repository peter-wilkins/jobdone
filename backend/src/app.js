import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { registerAudioRoutes } from './routes/audio.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerRecallRoutes } from './routes/recall.js';
import { registerQueryRoutes } from './routes/queries.js';
import { registerStructureRoutes } from './routes/structure.js';
import { registerLocationRoutes } from './routes/locations.js';
import { registerChoremoreRoutes } from './routes/choremore.js';
import { registerRequestIdHooks } from './services/requestId.js';
import { createCorsOriginValidator } from './services/cors.js';

export function createApp(options = {}) {
  const fastify = Fastify({
    logger: true,
    ...options,
  });

  fastify.register(cors, {
    origin: createCorsOriginValidator(options.allowedCorsOrigins),
  });

  fastify.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024,
    },
  });

  registerRequestIdHooks(fastify);

  fastify.register(registerAudioRoutes);
  fastify.register(registerSyncRoutes);
  fastify.register(registerFeedbackRoutes);
  fastify.register(registerRecallRoutes);
  fastify.register(registerQueryRoutes);
  fastify.register(registerStructureRoutes);
  fastify.register(registerLocationRoutes);
  fastify.register(registerChoremoreRoutes);

  fastify.get('/', async () => {
    return {
      service: 'JobDone Audio Processing',
      version: '1.0.0',
      endpoints: {
        health: 'GET /health',
        transcribe: 'POST /api/transcribe (multipart form with audio file)',
        summarize: 'POST /api/summarize (JSON with transcript)',
      },
    };
  });

  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error({
      err: error,
      request_id: request.requestId,
      method: request.method,
      route: request.routeOptions?.url || request.routerPath || request.url,
      error_kind: error.code || error.name || 'Error',
    }, 'request_failed');
    reply.status(500).send({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  });

  return fastify;
}
