import { saveEntry, getEntries, getEntryByCaptureId, getEntryByCreatedAt, saveContact, getContacts, getContactManifest, pullContactsByClientIds, pushReplicaContacts, saveContactAlias, getContactAliases, getLocationManifest, pullLocationsByClientIds, pushReplicaLocations, saveLocationAlias, getLocationAliases, saveContextClues, saveEntryLocations, saveEntryContacts, saveEntryTags, saveEntryAttachments, deleteUserData, toCanonicalContactRecord, toCanonicalEntry, toCanonicalLocationRecord } from '../services/database.js';
import { requireAuth } from '../services/auth.js';
import { getEmbeddingService, EMBEDDING_MODEL } from '../services/embedding.js';
import { parseEntrySyncPayload } from '../contracts/entrySync.js';
import { parseContactPullPayload, parseContactsPayload } from '../contracts/syncRequests.js';
import { parseContactsResponse, parseEntriesResponse, parseEntrySaveResponse } from '../contracts/syncResponses.js';
import {
  parseLocationReplicaManifestRequest,
  parseLocationReplicaManifestResponse,
  parseLocationReplicaPushRequest,
  parseLocationReplicaPullRequest,
  parseLocationReplicaRecordsResponse,
} from '../contracts/locationReplica.js';

function assertSyncResponse(parsed) {
  if (parsed.success) return parsed.data;
  throw new Error(parsed.error || 'Invalid sync response');
}

function toCanonicalLocationAlias(alias = {}) {
  return {
    collection: 'locations',
    fromClientId: alias.fromClientId,
    toClientId: alias.toClientId,
    reason: alias.reason || 'unknown',
  };
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
    getLocationManifest: deps.getLocationManifest ?? getLocationManifest,
    pullLocationsByClientIds: deps.pullLocationsByClientIds ?? pullLocationsByClientIds,
    pushReplicaLocations: deps.pushReplicaLocations ?? pushReplicaLocations,
    saveLocationAlias: deps.saveLocationAlias ?? saveLocationAlias,
    getLocationAliases: deps.getLocationAliases ?? getLocationAliases,
    saveContextClues: deps.saveContextClues ?? saveContextClues,
    saveEntryLocations: deps.saveEntryLocations ?? saveEntryLocations,
    saveEntryContacts: deps.saveEntryContacts ?? saveEntryContacts,
    saveEntryTags: deps.saveEntryTags ?? saveEntryTags,
    saveEntryAttachments: deps.saveEntryAttachments ?? saveEntryAttachments,
    deleteUserData: deps.deleteUserData ?? deleteUserData,
  };
  const embeddingService = deps.embeddingService ?? getEmbeddingService();
  const legacyEntrySyncDisabled = deps.disableLegacyEntrySync ?? process.env.DISABLE_LEGACY_ENTRY_SYNC === 'true';

  /**
   * POST /api/sync/save
   * Save a confirmed entry to cloud.
   * userId is taken from the validated JWT — not from the request body.
   */
  fastify.post('/api/sync/save', async (request, reply) => {
    if (legacyEntrySyncDisabled) {
      return reply.status(410).send({ error: 'Use /api/local-replica/* for Entry sync' });
    }

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
    if (legacyEntrySyncDisabled) {
      return reply.status(410).send({ error: 'Use /api/local-replica/* for Entry sync' });
    }

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

  fastify.post('/api/local-replica/locations/manifest', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const parsed = parseLocationReplicaManifestRequest(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error, errors: parsed.errors });
      const manifest = await db.getLocationManifest(user.id, parsed.data.locations);
      return assertSyncResponse(parseLocationReplicaManifestResponse({
        success: true,
        locations: manifest.locations || [],
        aliases: (manifest.aliases || []).map(toCanonicalLocationAlias),
      }));
    } catch (error) {
      console.error('Location Replica manifest error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch Location Replica manifest' });
    }
  });

  fastify.post('/api/local-replica/locations/pull', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const parsed = parseLocationReplicaPullRequest(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error, errors: parsed.errors });
      const locations = await db.pullLocationsByClientIds(user.id, parsed.data.ids);
      const aliases = await db.getLocationAliases(user.id);
      return assertSyncResponse(parseLocationReplicaRecordsResponse({
        success: true,
        locations: locations.map(toCanonicalLocationRecord),
        aliases: aliases.map(toCanonicalLocationAlias),
      }));
    } catch (error) {
      console.error('Location Replica pull error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to pull Location Replica records' });
    }
  });

  fastify.post('/api/local-replica/locations/push', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const parsed = parseLocationReplicaPushRequest(request.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error, errors: parsed.errors });
      const result = await db.pushReplicaLocations(user.id, parsed.data.locations);
      return assertSyncResponse(parseLocationReplicaRecordsResponse({
        success: true,
        locations: (result.locations || []).map(toCanonicalLocationRecord),
        aliases: (result.aliases || []).map(toCanonicalLocationAlias),
      }));
    } catch (error) {
      console.error('Location Replica push error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to push Location Replica records' });
    }
  });

  fastify.post('/api/local-replica/locations/aliases', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const aliases = Array.isArray(request.body?.aliases) ? request.body.aliases : [];
      const saved = [];
      for (const alias of aliases) {
        const row = await db.saveLocationAlias(user.id, alias);
        if (row) saved.push(row);
      }
      return { success: true, aliases: saved.map(toCanonicalLocationAlias) };
    } catch (error) {
      console.error('Location Replica alias push error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to push Location Replica aliases' });
    }
  });

  fastify.post('/api/sync/locations', async (_request, reply) =>
    reply.status(410).send({ error: 'Use /api/local-replica/locations/*' })
  );

  fastify.get('/api/sync/locations', async (_request, reply) =>
    reply.status(410).send({ error: 'Use /api/local-replica/locations/*' })
  );

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
