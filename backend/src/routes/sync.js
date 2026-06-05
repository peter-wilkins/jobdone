import { saveEntry, getEntries, getEntryByCaptureId, getEntryByCreatedAt, saveContact, getContacts, getContactManifest, pullContactsByClientIds, pushReplicaContacts, saveContactAlias, getContactAliases, saveContextClues, saveEntryLocations, saveEntryContacts, saveEntryTags, saveEntryAttachments, saveLocation, getLocations, deleteUserData, toCanonicalContactRecord, toCanonicalEntry, toCanonicalLocationRecord } from '../services/database.js';
import { requireAuth } from '../services/auth.js';
import { getEmbeddingService, EMBEDDING_MODEL } from '../services/embedding.js';
import { parseEntrySyncPayload } from '../contracts/entrySync.js';
import { parseContactPullPayload, parseContactsPayload, parseLocationsPayload } from '../contracts/syncRequests.js';
import { parseContactsResponse, parseEntriesResponse, parseEntrySaveResponse, parseLocationsResponse } from '../contracts/syncResponses.js';

function assertSyncResponse(parsed) {
  if (parsed.success) return parsed.data;
  throw new Error(parsed.error || 'Invalid sync response');
}

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
    getContactManifest: deps.getContactManifest ?? getContactManifest,
    pullContactsByClientIds: deps.pullContactsByClientIds ?? pullContactsByClientIds,
    pushReplicaContacts: deps.pushReplicaContacts ?? pushReplicaContacts,
    saveContactAlias: deps.saveContactAlias ?? saveContactAlias,
    getContactAliases: deps.getContactAliases ?? getContactAliases,
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
      const parsed = parseEntrySyncPayload(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error, errors: parsed.errors });
      }
      const { entryData } = parsed.data;

      const tagValidation = validateEntryTags(entryData.tags);
      if (!tagValidation.valid) {
        return reply.status(400).send({ error: tagValidation.error });
      }

      const captureId = entryData.captureId || null;
      const existing = captureId
        ? await db.getEntryByCaptureId(user.id, captureId)
        : await db.getEntryByCreatedAt(user.id, entryData.createdAt);
      if (existing) {
        const contextClues = await db.saveContextClues(user.id, existing.id, entryData.contextClues);
        const locations = await db.saveEntryLocations(user.id, existing.id, entryData.locations);
        const contacts = await db.saveEntryContacts(user.id, existing.id, entryData.contacts);
        const tags = await db.saveEntryTags(user.id, existing.id, entryData.tags);
        const incomingAttachments = entryData.attachments;
        const attachments = await db.saveEntryAttachments(user.id, existing.id, incomingAttachments);
        const entry = toCanonicalEntry(existing, { contextClues, locations, contacts, tags, attachments });
        return assertSyncResponse(parseEntrySaveResponse({ success: true, entry }));
      }

      const embedding = await embeddingService.embedText(entryData.summary);
      const saved = await db.saveEntry(user.id, {
        ...entryData,
        embedding,
        embedding_model: EMBEDDING_MODEL,
      });
      const contextClues = await db.saveContextClues(user.id, saved.id, entryData.contextClues);
      const locations = await db.saveEntryLocations(user.id, saved.id, entryData.locations);
      const contacts = await db.saveEntryContacts(user.id, saved.id, entryData.contacts);
      const tags = await db.saveEntryTags(user.id, saved.id, entryData.tags);
      const incomingAttachments = entryData.attachments;
      const attachments = await db.saveEntryAttachments(user.id, saved.id, incomingAttachments);

      const entry = toCanonicalEntry(saved, { contextClues, locations, contacts, tags, attachments });
      return assertSyncResponse(parseEntrySaveResponse({ success: true, entry }));
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
      return assertSyncResponse(parseEntriesResponse({ success: true, entries }));
    } catch (error) {
      console.error('Sync fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch entries' });
    }
  });

  async function handleSaveContacts(request, reply) {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const parsed = parseContactsPayload(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error, errors: parsed.errors });
      const { contacts } = parsed.data;
      const saved = [];
      for (const contact of contacts) {
        saved.push(await db.saveContact(user.id, contact));
      }
      const rows = saved.filter(Boolean);
      return assertSyncResponse(parseContactsResponse({ success: true, contacts: rows.map(toCanonicalContactRecord) }));
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
      return assertSyncResponse(parseContactsResponse({ success: true, contacts: contacts.map(toCanonicalContactRecord) }));
    } catch (error) {
      console.error('Contacts sync fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch contacts' });
    }
  }

  fastify.post('/api/sync/contacts', handleSaveContacts);
  fastify.get('/api/sync/contacts', handleGetContacts);

  fastify.post('/api/sync/contacts/manifest', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      return { success: true, ...(await db.getContactManifest(user.id, request.body?.localManifest || {})) };
    } catch (error) {
      console.error('Contacts manifest error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch contact manifest' });
    }
  });

  fastify.post('/api/sync/contacts/pull', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const parsed = parseContactPullPayload(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error, errors: parsed.errors });
      const { clientIds } = parsed.data;
      const contacts = await db.pullContactsByClientIds(user.id, clientIds);
      const aliases = await db.getContactAliases(user.id);
      return assertSyncResponse(parseContactsResponse({ success: true, contacts: contacts.map(toCanonicalContactRecord), aliases }));
    } catch (error) {
      console.error('Contacts pull error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to pull contacts' });
    }
  });

  fastify.post('/api/sync/contacts/push', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const parsed = parseContactsPayload(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error, errors: parsed.errors });
      const { contacts } = parsed.data;
      const result = await db.pushReplicaContacts(user.id, contacts);
      return assertSyncResponse(parseContactsResponse({
        success: true,
        contacts: (result.contacts || []).map(toCanonicalContactRecord),
        aliases: result.aliases || [],
      }));
    } catch (error) {
      console.error('Contacts push error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to push contacts' });
    }
  });

  fastify.post('/api/sync/contacts/aliases', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const aliases = Array.isArray(request.body?.aliases) ? request.body.aliases : [];
      const saved = [];
      for (const alias of aliases) {
        const row = await db.saveContactAlias(user.id, alias);
        if (row) saved.push(row);
      }
      return { success: true, aliases: saved };
    } catch (error) {
      console.error('Contacts alias push error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to push contact aliases' });
    }
  });

  fastify.post('/api/sync/locations', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const parsed = parseLocationsPayload(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error, errors: parsed.errors });
      const { locations } = parsed.data;
      const saved = [];
      for (const location of locations) {
        saved.push(await db.saveLocation(user.id, location));
      }
      return assertSyncResponse(parseLocationsResponse({
        success: true,
        locations: saved.filter(Boolean).map(toCanonicalLocationRecord),
      }));
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
      return assertSyncResponse(parseLocationsResponse({ success: true, locations: locations.map(toCanonicalLocationRecord) }));
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
