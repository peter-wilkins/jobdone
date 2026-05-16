import { saveEntry, getEntries, updateEntryEmbedding } from '../services/database.js';
import { requireAuth } from '../services/auth.js';
import { getEmbeddingService, EMBEDDING_MODEL } from '../services/embedding.js';

export async function registerSyncRoutes(fastify) {
  /**
   * POST /api/sync/save
   * Save a confirmed entry to cloud.
   * userId is taken from the validated JWT — not from the request body.
   */
  fastify.post('/api/sync/save', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    try {
      const { entryData } = request.body;

      if (!entryData) {
        return reply.status(400).send({ error: 'entryData required' });
      }

      const saved = await saveEntry(user.id, entryData);

      // Fire embedding in the background — failures must not block the response.
      if (saved?.id && entryData.summary) {
        (async () => {
          try {
            const svc = getEmbeddingService();
            const vector = await svc.embedText(entryData.summary);
            await updateEntryEmbedding(saved.id, vector, EMBEDDING_MODEL);
          } catch (embErr) {
            console.error('[Sync] Embedding failed (non-fatal):', embErr.message);
          }
        })();
      }

      return { success: true, entry: saved };
    } catch (error) {
      console.error('Sync save error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to save entry' });
    }
  });

  /**
   * GET /api/sync/entries
   * Fetch all entries for the authenticated user.
   */
  fastify.get('/api/sync/entries', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    try {
      const entries = await getEntries(user.id);
      return { success: true, entries };
    } catch (error) {
      console.error('Sync fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch entries' });
    }
  });
}
