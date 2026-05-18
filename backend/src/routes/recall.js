import { requireAuth } from '../services/auth.js';
import { recallEntries } from '../services/database.js';
import { getEmbeddingService } from '../services/embedding.js';

export async function registerRecallRoutes(fastify) {
  /**
   * POST /api/recall
   * Accepts { query: string }.
   * Returns the top-10 Entries ranked by cosine similarity for the authenticated user.
   * Entries below a similarity floor of ~0.3 are excluded.
   */
  fastify.post('/api/recall', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const { query } = request.body ?? {};

    if (!query || typeof query !== 'string' || query.trim() === '') {
      return reply.status(400).send({ error: 'query must be a non-empty string' });
    }

    try {
      const svc = getEmbeddingService();
      const trimmedQuery = query.trim();
      const queryEmbedding = await svc.embedText(trimmedQuery);
      const rows = await recallEntries(user.id, queryEmbedding, { query: trimmedQuery });

      return { entries: rows };
    } catch (error) {
      console.error('[Recall] Error:', error);
      return reply.status(500).send({ error: error.message || 'Recall failed' });
    }
  });
}
