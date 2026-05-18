import { saveEntry, getEntries, getEntryByCaptureId, getEntryByCreatedAt, saveContact, getContacts, saveContextClues, deleteUserData } from '../services/database.js';
import { requireAuth } from '../services/auth.js';
import { getEmbeddingService, EMBEDDING_MODEL } from '../services/embedding.js';

export async function registerSyncRoutes(fastify, deps = {}) {
  const auth = deps.requireAuth ?? requireAuth;
  const db = {
    saveEntry: deps.saveEntry ?? saveEntry,
    getEntries: deps.getEntries ?? getEntries,
    getEntryByCaptureId: deps.getEntryByCaptureId ?? getEntryByCaptureId,
    getEntryByCreatedAt: deps.getEntryByCreatedAt ?? getEntryByCreatedAt,
    saveContact: deps.saveContact ?? deps.savePerson ?? saveContact,
    getContacts: deps.getContacts ?? deps.getPeople ?? getContacts,
    saveContextClues: deps.saveContextClues ?? saveContextClues,
    deleteUserData: deps.deleteUserData ?? deleteUserData,
  };
  const embeddingService = deps.embeddingService ?? getEmbeddingService();

  /**
   * POST /api/sync/save
   * Save a confirmed entry to cloud.
   * userId is taken from the validated JWT — not from the request body.
   */
  fastify.post('/api/sync/save', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const { entryData } = request.body;

      if (!entryData) {
        return reply.status(400).send({ error: 'entryData required' });
      }

      if (!entryData.summary || typeof entryData.summary !== 'string') {
        return reply.status(400).send({ error: 'entryData.summary required' });
      }

      if (!entryData.created_at && !entryData.captureId && !entryData.capture_id) {
        return reply.status(400).send({ error: 'entryData.created_at or captureId required' });
      }

      const captureId = entryData.captureId || entryData.capture_id || null;
      const existing = captureId
        ? await db.getEntryByCaptureId(user.id, captureId)
        : await db.getEntryByCreatedAt(user.id, entryData.created_at);
      if (existing) {
        const contextClues = await db.saveContextClues(user.id, existing.id, entryData.contextClues || entryData.context_clues || []);
        return { success: true, entry: { ...existing, context_clues: contextClues } };
      }

      const embedding = await embeddingService.embedText(entryData.summary);
      const saved = await db.saveEntry(user.id, {
        ...entryData,
        embedding,
        embedding_model: EMBEDDING_MODEL,
      });
      const contextClues = await db.saveContextClues(user.id, saved.id, entryData.contextClues || entryData.context_clues || []);

      return { success: true, entry: { ...saved, context_clues: contextClues } };
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
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const entries = await db.getEntries(user.id);
      return { success: true, entries };
    } catch (error) {
      console.error('Sync fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch entries' });
    }
  });

  async function handleSaveContacts(request, reply) {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const contacts = Array.isArray(request.body?.contacts)
        ? request.body.contacts
        : Array.isArray(request.body?.people)
          ? request.body.people
          : [];
      const saved = [];
      for (const contact of contacts) {
        saved.push(await db.saveContact(user.id, contact));
      }
      const rows = saved.filter(Boolean);
      return { success: true, contacts: rows, people: rows };
    } catch (error) {
      console.error('Contacts sync save error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to save contacts' });
    }
  }

  async function handleGetContacts(request, reply) {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const contacts = await db.getContacts(user.id);
      return { success: true, contacts, people: contacts };
    } catch (error) {
      console.error('Contacts sync fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch contacts' });
    }
  }

  fastify.post('/api/sync/contacts', handleSaveContacts);
  fastify.get('/api/sync/contacts', handleGetContacts);
  fastify.post('/api/sync/people', handleSaveContacts);
  fastify.get('/api/sync/people', handleGetContacts);

  /**
   * DELETE /api/user/data
   * GDPR right to erasure — deletes all entries, queries, and feedback for the user.
   */
  fastify.delete('/api/user/data', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      await db.deleteUserData(user.id);
      return { success: true };
    } catch (error) {
      console.error('Delete user data error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to delete user data' });
    }
  });
}
