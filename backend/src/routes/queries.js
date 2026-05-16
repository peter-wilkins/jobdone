import { requireAuth } from '../services/auth.js';
import { saveQuery, getQueries } from '../services/database.js';

export async function registerQueryRoutes(fastify) {
  /**
   * POST /api/queries
   * Saves a new query. Deduplicates by text — re-used queries
   * bubble to the top via updated created_at.
   */
  fastify.post('/api/queries', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const { text } = request.body ?? {};

    if (!text || typeof text !== 'string' || text.trim() === '') {
      return reply.status(400).send({ error: 'text must be a non-empty string' });
    }

    try {
      const result = await saveQuery(user.id, text.trim());
      return { query: result };
    } catch (error) {
      console.error('[Queries] Save error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to save query' });
    }
  });

  /**
   * GET /api/queries
   * Returns up to 50 most recent queries, deduplicated by text.
   */
  fastify.get('/api/queries', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    try {
      const queries = await getQueries(user.id);
      return { queries };
    } catch (error) {
      console.error('[Queries] Fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch queries' });
    }
  });
}
