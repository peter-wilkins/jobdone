import { createApp } from './app.js';

const PORT = process.env.PORT || 3000;

const start = async () => {
  const fastify = createApp();

  try {
    const USE_MOCK = process.env.USE_MOCK_APIS === 'true';

    if (!USE_MOCK) {
      if (!process.env.VOYAGE_API_KEY) {
        console.warn('VOYAGE_API_KEY is not configured; legacy embedding paths may fail.');
      }
    }

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`JobDone server running at http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    if (USE_MOCK) {
      console.log('MOCK MODE ENABLED - using hardcoded API responses');
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
