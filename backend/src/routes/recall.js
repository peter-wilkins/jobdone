import { requireAuth } from '../services/auth.js';
import { recallEntries } from '../services/database.js';

export async function registerRecallRoutes(fastify) {
  /**
   * POST /api/recall
   * Accepts { query: string }.
   * Returns the top Entries ranked by deterministic SQL matches for the authenticated user.
   */
  fastify.post('/api/recall', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const { query } = request.body ?? {};

    if (!query || typeof query !== 'string' || query.trim() === '') {
      return reply.status(400).send({ error: 'query must be a non-empty string' });
    }

    try {
      const trimmedQuery = query.trim();
      const rows = await recallEntries(user.id, { query: trimmedQuery });

      return { entries: rows };
    } catch (error) {
      console.error('[Recall] Error:', error);
      return reply.status(500).send({ error: error.message || 'Recall failed' });
    }
  });
}
