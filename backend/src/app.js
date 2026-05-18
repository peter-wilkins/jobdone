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

export function createApp(options = {}) {
  const fastify = Fastify({
    logger: true,
    ...options,
  });

  fastify.register(cors, {
    origin: true,
  });

  fastify.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024,
    },
  });

  fastify.register(registerAudioRoutes);
  fastify.register(registerSyncRoutes);
  fastify.register(registerFeedbackRoutes);
  fastify.register(registerRecallRoutes);
  fastify.register(registerQueryRoutes);
  fastify.register(registerStructureRoutes);

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
    fastify.log.error(error);
    reply.status(500).send({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  });

  return fastify;
}
