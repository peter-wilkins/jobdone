import { saveEntry, getEntries, getEntryByCaptureId, getEntryByCreatedAt, saveContact, getContacts, saveContextClues, saveEntryLocations, saveEntryContacts, saveEntryTags, saveEntryAttachments, saveLocation, getLocations, deleteUserData } from '../services/database.js';
import { requireAuth } from '../services/auth.js';
import { getEmbeddingService, EMBEDDING_MODEL } from '../services/embedding.js';

function validateTagLabel(value) {
  if (/[\p{C}]/u.test(String(value || ''))) {
    return { valid: false, error: 'Tag label contains unsafe characters' };
  }
  const label = String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label) return { valid: false, error: 'Tag label required' };
  if (label.length > 40) return { valid: false, error: 'Tag label too long' };
  if (/\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above)\s+instructions?\b/i.test(label)) {
    return { valid: false, error: 'Tag label contains unsafe characters' };
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(label)) {
    return { valid: false, error: 'Tag label contains unsafe characters' };
  }
  return { valid: true, label };
}

function validateEntryTags(tags = []) {
  if (!Array.isArray(tags)) return { valid: false, error: 'entryData.tags must be an array' };
  for (const tag of tags) {
    const result = validateTagLabel(tag?.label || tag?.name || tag?.displayName || tag);
    if (!result.valid) return result;
  }
  return { valid: true };
}

export async function registerSyncRoutes(fastify, deps = {}) {
  const auth = deps.requireAuth ?? requireAuth;
  const db = {
    saveEntry: deps.saveEntry ?? saveEntry,
    getEntries: deps.getEntries ?? getEntries,
    getEntryByCaptureId: deps.getEntryByCaptureId ?? getEntryByCaptureId,
    getEntryByCreatedAt: deps.getEntryByCreatedAt ?? getEntryByCreatedAt,
    saveContact: deps.saveContact ?? saveContact,
    getContacts: deps.getContacts ?? getContacts,
    saveContextClues: deps.saveContextClues ?? saveContextClues,
    saveEntryLocations: deps.saveEntryLocations ?? saveEntryLocations,
    saveEntryContacts: deps.saveEntryContacts ?? saveEntryContacts,
    saveEntryTags: deps.saveEntryTags ?? saveEntryTags,
    saveEntryAttachments: deps.saveEntryAttachments ?? saveEntryAttachments,
    saveLocation: deps.saveLocation ?? saveLocation,
    getLocations: deps.getLocations ?? getLocations,
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

      const tagValidation = validateEntryTags(entryData.tags || entryData.tagSnapshots || []);
      if (!tagValidation.valid) {
        return reply.status(400).send({ error: tagValidation.error });
      }

      const captureId = entryData.captureId || entryData.capture_id || null;
      const existing = captureId
        ? await db.getEntryByCaptureId(user.id, captureId)
        : await db.getEntryByCreatedAt(user.id, entryData.created_at);
      if (existing) {
        const contextClues = await db.saveContextClues(user.id, existing.id, entryData.contextClues || entryData.context_clues || []);
        const locations = await db.saveEntryLocations(user.id, existing.id, entryData.locations || entryData.locationSnapshots || []);
        const contacts = await db.saveEntryContacts(user.id, existing.id, entryData.contacts || entryData.contactSnapshots || []);
        const tags = await db.saveEntryTags(user.id, existing.id, entryData.tags || entryData.tagSnapshots || []);
        const incomingAttachments = entryData.attachments || entryData.attachmentSnapshots || [];
        const attachments = await db.saveEntryAttachments(user.id, existing.id, incomingAttachments);
        const entry = { ...existing, context_clues: contextClues, locations, contacts, tags };
        if (attachments.length || incomingAttachments.length) entry.attachments = attachments;
        return { success: true, entry };
      }

      const embedding = await embeddingService.embedText(entryData.summary);
      const saved = await db.saveEntry(user.id, {
        ...entryData,
        embedding,
        embedding_model: EMBEDDING_MODEL,
      });
      const contextClues = await db.saveContextClues(user.id, saved.id, entryData.contextClues || entryData.context_clues || []);
      const locations = await db.saveEntryLocations(user.id, saved.id, entryData.locations || entryData.locationSnapshots || []);
      const contacts = await db.saveEntryContacts(user.id, saved.id, entryData.contacts || entryData.contactSnapshots || []);
      const tags = await db.saveEntryTags(user.id, saved.id, entryData.tags || entryData.tagSnapshots || []);
      const incomingAttachments = entryData.attachments || entryData.attachmentSnapshots || [];
      const attachments = await db.saveEntryAttachments(user.id, saved.id, incomingAttachments);

      const entry = { ...saved, context_clues: contextClues, locations, contacts, tags };
      if (attachments.length || incomingAttachments.length) entry.attachments = attachments;
      return { success: true, entry };
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
      const contacts = Array.isArray(request.body?.contacts) ? request.body.contacts : [];
      const saved = [];
      for (const contact of contacts) {
        saved.push(await db.saveContact(user.id, contact));
      }
      const rows = saved.filter(Boolean);
      return { success: true, contacts: rows };
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
      return { success: true, contacts };
    } catch (error) {
      console.error('Contacts sync fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch contacts' });
    }
  }

  fastify.post('/api/sync/contacts', handleSaveContacts);
  fastify.get('/api/sync/contacts', handleGetContacts);

  fastify.post('/api/sync/locations', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const locations = Array.isArray(request.body?.locations) ? request.body.locations : [];
      const saved = [];
      for (const location of locations) {
        saved.push(await db.saveLocation(user.id, location));
      }
      return { success: true, locations: saved.filter(Boolean) };
    } catch (error) {
      console.error('Locations sync save error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to save locations' });
    }
  });

  fastify.get('/api/sync/locations', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const locations = await db.getLocations(user.id);
      return { success: true, locations };
    } catch (error) {
      console.error('Locations sync fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch locations' });
    }
  });

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
