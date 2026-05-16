import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Now import other modules after dotenv has loaded
const { default: Fastify } = await import('fastify');
const corsModule = await import('@fastify/cors');
const multipartModule = await import('@fastify/multipart');
const { registerAudioRoutes } = await import('./routes/audio.js');
const { registerSyncRoutes } = await import('./routes/sync.js');
const { registerFeedbackRoutes } = await import('./routes/feedback.js');
const { registerRecallRoutes } = await import('./routes/recall.js');
const { registerQueryRoutes } = await import('./routes/queries.js');

const cors = corsModule.default;
const multipart = multipartModule.default;

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
await registerSyncRoutes(fastify);
await registerFeedbackRoutes(fastify);
await registerRecallRoutes(fastify);
await registerQueryRoutes(fastify);

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
    const USE_MOCK = process.env.USE_MOCK_APIS === 'true';

    // Validate environment variables (skip if using mocks)
    if (!USE_MOCK) {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable is required');
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required');
      }
    }

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`\n🚀 JobDone server running at http://localhost:${PORT}`);
    console.log(`📝 Health check: http://localhost:${PORT}/health`);
    if (USE_MOCK) {
      console.log(`🎭 MOCK MODE ENABLED - using hardcoded API responses\n`);
    } else {
      console.log(`📡 Using real Deepgram/Anthropic APIs\n`);
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
