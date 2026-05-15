import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import dotenv from 'dotenv';
import { registerAudioRoutes } from './routes/audio.js';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Initialize Fastify server
 */
const fastify = Fastify({
  logger: true,
});

/**
 * Register plugins
 */
await fastify.register(cors, {
  origin: true, // Allow all origins in development
});

await fastify.register(multipart, {
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max (Whisper limit)
  },
});

/**
 * Register routes
 */
await registerAudioRoutes(fastify);

/**
 * Root endpoint
 */
fastify.get('/', async (request, reply) => {
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

/**
 * Error handler
 */
fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  reply.status(500).send({
    error: 'Internal server error',
    message: NODE_ENV === 'development' ? error.message : undefined,
  });
});

/**
 * Start server
 */
const start = async () => {
  try {
    // Validate environment variables
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n🚀 JobDone server running at http://localhost:${PORT}`);
    console.log(`📝 Health check: http://localhost:${PORT}/health\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
