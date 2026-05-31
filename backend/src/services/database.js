import { createClient } from '@supabase/supabase-js';
import { createJobDoneDb } from './postgresDb.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const postgresUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
export const JOBDONE_DB_SCHEMA = process.env.SUPABASE_DB_SCHEMA || 'jobdone';

if (!postgresUrl) {
  console.warn('[Database] Postgres not configured. Cloud sync disabled.');
}

if (!supabaseUrl || !supabaseKey) {
  console.warn('[Database] Supabase Auth not configured. Login disabled.');
}

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export const jobdoneDb = createJobDoneDb({
  connectionString: postgresUrl,
  schema: JOBDONE_DB_SCHEMA,
});

function toVectorLiteral(embedding) {
  if (!Array.isArray(embedding)) return embedding ?? null;
  return `[${embedding.join(',')}]`;
}

function unique(values = []) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function mergeByKey(existingValues = [], incomingValues = []) {
  const merged = [...(existingValues || [])];
  for (const value of incomingValues || []) {
    const key = value?.normalized || value?.value;
    if (!key) continue;
    if (!merged.some(item => (item?.normalized || item?.value) === key)) {
      merged.push(value);
    }
  }
  return merged;
}

function contactsMatch(existing, incoming) {
  if (existing.local_id && incoming.localId && existing.local_id === incoming.localId) return true;

  const existingEmails = new Set(existing.normalized_emails || []);
  const existingPhones = new Set(existing.normalized_phones || []);
  return (incoming.normalizedEmails || []).some(email => existingEmails.has(email)) ||
    (incoming.normalizedPhones || []).some(phone => existingPhones.has(phone));
}

export function normalizeLocationIdentityText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function extractPostcode(value) {
  const match = String(value || '').toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/);
  return match ? match[1].replace(/\s+/g, '') : '';
}

function firstAddressLine(value) {
  const [line] = String(value || '').split(/[\n,]/);
  return line || '';
}

export function locationIdentityKeys(location = {}) {
  const providerPlaceId = String(
    location.providerPlaceId || location.provider_place_id || location.placeId || location.place_id || ''
  ).trim();
  const displayName = location.displayName || location.display_name || '';
  const placeText = location.placeText || location.place_text || '';
  const addressText = location.addressText || location.address_text || '';
  const combined = [addressText, placeText, displayName].filter(Boolean).join(' ');
  const postcode = extractPostcode(combined);
  const addressLine = normalizeLocationIdentityText(firstAddressLine(addressText || placeText || displayName)
    .replace(new RegExp(postcode, 'i'), ''));
  const display = normalizeLocationIdentityText(displayName || placeText || addressText);

  return {
    provider: providerPlaceId ? `provider:${providerPlaceId}` : '',
    address: postcode && addressLine ? `address:${postcode}:${addressLine}` : '',
    display: display ? `display:${display}` : '',
  };
}

export function locationsHaveStrongIdentityMatch(left = {}, right = {}) {
  const leftKeys = locationIdentityKeys(left);
  const rightKeys = locationIdentityKeys(right);
  return Boolean(
    (leftKeys.provider && leftKeys.provider === rightKeys.provider) ||
    (leftKeys.address && leftKeys.address === rightKeys.address) ||
    (leftKeys.display && leftKeys.display === rightKeys.display)
  );
}

export function findReusableLocation(existingLocations = [], draft = {}) {
  return (existingLocations || []).find(location => locationsHaveStrongIdentityMatch(location, draft)) || null;
}

function normalizeLocation(location = {}) {
  const displayName = String(
    location.displayName || location.display_name || location.placeText || location.place_text || location.addressText || location.address_text || ''
  ).trim();
  if (!displayName) return null;

  return {
    local_id: location.localId || location.local_id || location.id || null,
    status: location.status || 'confirmed',
    display_name: displayName,
    place_text: String(location.placeText || location.place_text || displayName).trim(),
    address_text: String(location.addressText || location.address_text || '').trim(),
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    updated_at: new Date().toISOString(),
  };
}

function normalizeTagLabel(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTagKey(value) {
  return normalizeTagLabel(value).toLowerCase();
}

function safeSlug(value) {
  return normalizeTagKey(value)
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'tag';
}

function validateTagLabel(value) {
  if (/[\p{C}]/u.test(String(value || ''))) return null;
  const label = normalizeTagLabel(value);
  if (!label || label.length > 40) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(label)) return null;
  return label;
}

function normalizeTag(tag = {}) {
  const label = validateTagLabel(tag.label || tag.name || tag.displayName || tag);
  if (!label) return null;
  const categoryName = normalizeTagLabel(tag.categoryName || tag.category_name || 'General') || 'General';
  const categorySlug = safeSlug(categoryName);

  return {
    local_id: tag.localId || tag.local_id || tag.id || null,
    label,
    normalized_label: normalizeTagKey(label),
    category_name: categoryName,
    category_slug: categorySlug,
    status: tag.status || 'confirmed',
    created_at: new Date(tag.created_at || Date.now()).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const RESERVED_CONTEXT_CLUE_PAYLOAD_KEYS = new Set([
  'body',
  'description',
  'transcript',
  'contactDetails',
  'rawPayload',
]);

function compactPayload(payload = {}) {
  return Object.fromEntries(
    Object.entries(payload || {}).filter(([key, value]) =>
      !RESERVED_CONTEXT_CLUE_PAYLOAD_KEYS.has(key) && value !== undefined
    )
  );
}

export function normalizeContextClue(clue = {}) {
  const kind = clue.kind || clue.type;
  const source = clue.source;
  if (!kind || !source) return null;

  return {
    local_id: clue.id || clue.localId || clue.local_id || null,
    kind,
    source,
    summary: clue.summary || '',
    payload: compactPayload(clue.payload || {}),
    confidence: clue.confidence ?? null,
    metadata: compactPayload(clue.metadata || {}),
    created_at: new Date(clue.created_at || Date.now()).toISOString(),
  };
}

/**
 * Save a confirmed entry to Supabase
 */
export async function saveEntry(userId, entryData) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured, skipping save');
    return null;
  }

  try {
    const { data, error } = await jobdoneDb
      .from('entries')
      .insert([
        {
          user_id: userId,
          capture_id: entryData.captureId ?? entryData.capture_id ?? null,
          transcript: entryData.transcript,
          summary: entryData.summary,
          created_at: new Date(entryData.created_at).toISOString(),
          embedding: toVectorLiteral(entryData.embedding),
          embedding_model: entryData.embedding_model ?? null,
        },
      ])
      .select();

    if (error) {
      console.error('[DB] Save error:', error);
      throw error;
    }

    console.log('[DB] Entry saved:', data[0]?.id);
    return data[0];
  } catch (error) {
    console.error('[DB] Failed to save entry:', error.message);
    throw error;
  }
}

/**
 * Find an existing confirmed entry by Capture ID.
 */
export async function getEntryByCaptureId(userId, captureId) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured');
    return null;
  }

  try {
    const { data, error } = await jobdoneDb
      .from('entries')
      .select('*')
      .eq('user_id', userId)
      .eq('capture_id', captureId)
      .order('synced_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('[DB] Fetch by capture_id error:', error);
      throw error;
    }

    return data?.[0] || null;
  } catch (error) {
    console.error('[DB] Failed to fetch entry by capture_id:', error.message);
    throw error;
  }
}

/**
 * Find an existing confirmed entry by the local creation timestamp.
 * This makes cloud sync idempotent for retries from the same device.
 */
export async function getEntryByCreatedAt(userId, createdAt) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured');
    return null;
  }

  try {
    const createdAtIso = new Date(createdAt).toISOString();
    const { data, error } = await jobdoneDb
      .from('entries')
      .select('*')
      .eq('user_id', userId)
      .eq('created_at', createdAtIso)
      .order('synced_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('[DB] Fetch by created_at error:', error);
      throw error;
    }

    return data?.[0] || null;
  } catch (error) {
    console.error('[DB] Failed to fetch entry by created_at:', error.message);
    throw error;
  }
}

/**
 * Delete all user data (GDPR right to erasure).
 * Removes entries, queries, and feedback for the given user.
 */
export async function deleteUserData(userId) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured, skipping delete');
    return null;
  }

  try {
    const { error: entriesErr } = await jobdoneDb
      .from('entries')
      .delete()
      .eq('user_id', userId);
    if (entriesErr) throw entriesErr;

    const { error: contactsErr } = await jobdoneDb
      .from('contacts')
      .delete()
      .eq('user_id', userId);
    if (contactsErr) throw contactsErr;

    const { error: locationsErr } = await jobdoneDb
      .from('locations')
      .delete()
      .eq('user_id', userId);
    if (locationsErr) throw locationsErr;

    const { error: tagCategoriesErr } = await jobdoneDb
      .from('tag_categories')
      .delete()
      .eq('user_id', userId);
    if (tagCategoriesErr) throw tagCategoriesErr;

    const { error: queriesErr } = await jobdoneDb
      .from('queries')
      .delete()
      .eq('user_id', userId);
    if (queriesErr) throw queriesErr;

    const { error: feedbackErr } = await jobdoneDb
      .from('feedback')
      .delete()
      .eq('user_id', userId);
    if (feedbackErr) throw feedbackErr;

    console.log('[DB] All user data deleted:', userId);
    return { success: true };
  } catch (error) {
    console.error('[DB] Failed to delete user data:', error.message);
    throw error;
  }
}

/**
 * Get all entries for a user
 */
export async function getEntries(userId) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  try {
    const { data, error } = await jobdoneDb
      .from('entries')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[DB] Fetch error:', error);
      throw error;
    }

    const entries = data || [];
    if (entries.length === 0) return entries;

    const { data: clues, error: cluesError } = await jobdoneDb
      .from('context_clues')
      .select('*')
      .eq('user_id', userId)
      .in('entry_id', entries.map(entry => entry.id))
      .order('created_at', { ascending: false });

    if (cluesError) {
      if (cluesError.code === '42P01' || /context_clues/i.test(cluesError.message || '')) {
        console.warn('[DB] context_clues table not found; returning entries without context clues');
        return entries.map(entry => ({ ...entry, context_clues: [] }));
      }
      console.error('[DB] Context clue fetch error:', cluesError);
      throw cluesError;
    }

    const entryIds = entries.map(entry => entry.id);

    const { data: locationLinks, error: locationsError } = await jobdoneDb
      .from('entry_locations')
      .select('entry_id, created_at, locations(*)')
      .eq('user_id', userId)
      .in('entry_id', entryIds)
      .order('created_at', { ascending: true });

    if (locationsError) {
      if (locationsError.code === '42P01' || /locations|entry_locations/i.test(locationsError.message || '')) {
        console.warn('[DB] locations tables not found; returning entries without locations');
      } else {
        console.error('[DB] Location fetch error:', locationsError);
        throw locationsError;
      }
    }

    const { data: tagLinks, error: tagsError } = await jobdoneDb
      .from('entry_tags')
      .select('entry_id, created_at, tags(*, tag_categories(*))')
      .eq('user_id', userId)
      .in('entry_id', entryIds)
      .order('created_at', { ascending: true });

    if (tagsError) {
      if (tagsError.code === '42P01' || /tags|entry_tags|tag_categories/i.test(tagsError.message || '')) {
        console.warn('[DB] tags tables not found; returning entries without tags');
      } else {
        console.error('[DB] Tag fetch error:', tagsError);
        throw tagsError;
      }
    }

    const { data: contactLinks, error: contactsError } = await jobdoneDb
      .from('entry_contacts')
      .select('entry_id, created_at, contacts(*)')
      .eq('user_id', userId)
      .in('entry_id', entryIds)
      .order('created_at', { ascending: true });

    if (contactsError) {
      if (contactsError.code === '42P01' || /contacts|entry_contacts/i.test(contactsError.message || '')) {
        console.warn('[DB] contact association tables not found; returning entries without contacts');
      } else {
        console.error('[DB] Contact fetch error:', contactsError);
        throw contactsError;
      }
    }

    const cluesByEntry = new Map();
    for (const clue of clues || []) {
      const list = cluesByEntry.get(clue.entry_id) || [];
      list.push(clue);
      cluesByEntry.set(clue.entry_id, list);
    }

    const locationsByEntry = new Map();
    for (const link of locationLinks || []) {
      if (!link.locations) continue;
      const list = locationsByEntry.get(link.entry_id) || [];
      list.push(link.locations);
      locationsByEntry.set(link.entry_id, list);
    }

    const tagsByEntry = new Map();
    for (const link of tagLinks || []) {
      if (!link.tags) continue;
      const list = tagsByEntry.get(link.entry_id) || [];
      list.push({
        ...link.tags,
        category_name: link.tags.tag_categories?.name || 'General',
      });
      tagsByEntry.set(link.entry_id, list);
    }

    const contactsByEntry = new Map();
    for (const link of contactLinks || []) {
      if (!link.contacts) continue;
      const list = contactsByEntry.get(link.entry_id) || [];
      list.push(link.contacts);
      contactsByEntry.set(link.entry_id, list);
    }

    return entries.map(entry => ({
      ...entry,
      context_clues: cluesByEntry.get(entry.id) || [],
      locations: locationsByEntry.get(entry.id) || [],
      contacts: contactsByEntry.get(entry.id) || [],
      tags: tagsByEntry.get(entry.id) || [],
    }));
  } catch (error) {
    console.error('[DB] Failed to fetch entries:', error.message);
    throw error;
  }
}

export async function saveContextClues(userId, entryId, clues = []) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured, skipping context clues save');
    return [];
  }
  if (!entryId || !Array.isArray(clues) || clues.length === 0) return [];

  const rows = clues
    .map(normalizeContextClue)
    .filter(Boolean)
    .map(clue => ({
      user_id: userId,
      entry_id: entryId,
      ...clue,
    }));

  if (rows.length === 0) return [];

  const rowsWithLocalId = rows.filter(row => row.local_id);
  const rowsWithoutLocalId = rows.filter(row => !row.local_id);
  const saved = [];

  if (rowsWithLocalId.length) {
    const { data, error } = await jobdoneDb
      .from('context_clues')
      .upsert(rowsWithLocalId, { onConflict: 'user_id,local_id' })
      .select();
    if (error) throw error;
    saved.push(...(data || []));
  }

  if (rowsWithoutLocalId.length) {
    const { data, error } = await jobdoneDb
      .from('context_clues')
      .insert(rowsWithoutLocalId)
      .select();
    if (error) throw error;
    saved.push(...(data || []));
  }

  return saved;
}

export async function saveEntryLocations(userId, entryId, locations = []) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured, skipping locations save');
    return [];
  }
  if (!entryId || !Array.isArray(locations) || locations.length === 0) return [];

  const saved = [];
  const existingLocations = await getLocations(userId);
  for (const input of locations) {
    const location = normalizeLocation(input);
    if (!location) continue;

    let row = null;
    if (location.local_id) {
      const { data: existing, error: existingError } = await jobdoneDb
      .from('locations')
        .select('*')
        .eq('user_id', userId)
        .eq('local_id', location.local_id)
        .limit(1);
      if (existingError) throw existingError;
      row = existing?.[0] || null;
    }

    if (!row) {
      row = findReusableLocation(existingLocations, location);
    }

    if (!row) {
      const { data, error } = await jobdoneDb
      .from('locations')
        .insert([{ user_id: userId, ...location, created_at: new Date(input.created_at || Date.now()).toISOString() }])
        .select()
        .single();
      if (error) throw error;
      row = data;
      existingLocations.push(row);
    } else {
      const { data, error } = await jobdoneDb
      .from('locations')
        .update({
          status: location.status,
          display_name: location.display_name || row.display_name,
          place_text: location.place_text || row.place_text,
          address_text: location.address_text || row.address_text,
          latitude: location.latitude ?? row.latitude,
          longitude: location.longitude ?? row.longitude,
          updated_at: location.updated_at,
        })
        .eq('id', row.id)
        .select()
        .single();
      if (error) throw error;
      row = data;
    }

    const { error: linkError } = await jobdoneDb
      .from('entry_locations')
      .upsert([{
        user_id: userId,
        entry_id: entryId,
        location_id: row.id,
        created_at: new Date().toISOString(),
      }], { onConflict: 'user_id,entry_id,location_id' });
    if (linkError) throw linkError;

    saved.push(row);
  }

  return saved;
}

export async function saveLocation(userId, input = {}) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured, skipping location save');
    return null;
  }

  const location = normalizeLocation(input);
  if (!location) return null;

  const existingLocations = await getLocations(userId);
  let row = null;
  if (location.local_id) {
    const { data: existing, error: existingError } = await jobdoneDb
      .from('locations')
      .select('*')
      .eq('user_id', userId)
      .eq('local_id', location.local_id)
      .limit(1);
    if (existingError) throw existingError;
    row = existing?.[0] || null;
  }

  if (!row) {
    row = findReusableLocation(existingLocations, location);
  }

  if (!row) {
    const { data, error } = await jobdoneDb
      .from('locations')
      .insert([{ user_id: userId, ...location, created_at: new Date(input.created_at || Date.now()).toISOString() }])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await jobdoneDb
      .from('locations')
    .update({
      status: location.status,
      local_id: row.local_id || location.local_id,
      display_name: location.display_name || row.display_name,
      place_text: location.place_text || row.place_text,
      address_text: location.address_text || row.address_text,
      latitude: location.latitude ?? row.latitude,
      longitude: location.longitude ?? row.longitude,
      updated_at: location.updated_at,
    })
    .eq('id', row.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveEntryContacts(userId, entryId, contacts = []) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured, skipping contacts');
    return [];
  }
  if (!entryId || !Array.isArray(contacts) || contacts.length === 0) return [];

  const savedContacts = [];
  for (const contact of contacts) {
    const saved = await saveContact(userId, contact);
    if (saved?.id) savedContacts.push(saved);
  }

  if (savedContacts.length === 0) return [];

  const rows = savedContacts.map(contact => ({
    user_id: userId,
    entry_id: entryId,
    contact_id: contact.id,
  }));

  const { error } = await jobdoneDb
      .from('entry_contacts')
    .upsert(rows, { onConflict: 'user_id,entry_id,contact_id' });

  if (error) {
    if (error.code === '42P01' || /entry_contacts/i.test(error.message || '')) {
      console.warn('[DB] entry_contacts table not found; saved contacts without Entry associations');
      return savedContacts;
    }
    throw error;
  }

  return savedContacts;
}

export async function saveEntryTags(userId, entryId, tags = []) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured, skipping tags save');
    return [];
  }
  if (!entryId || !Array.isArray(tags) || tags.length === 0) return [];

  const saved = [];
  for (const input of tags) {
    const tag = normalizeTag(input);
    if (!tag) continue;

    const { data: category, error: categoryError } = await jobdoneDb
      .from('tag_categories')
      .upsert([{
        user_id: userId,
        name: tag.category_name,
        slug: tag.category_slug,
        updated_at: tag.updated_at,
      }], { onConflict: 'user_id,slug' })
      .select()
      .single();
    if (categoryError) throw categoryError;

    let row = null;
    if (tag.local_id) {
      const { data: existing, error: existingError } = await jobdoneDb
      .from('tags')
        .select('*')
        .eq('user_id', userId)
        .eq('local_id', tag.local_id)
        .limit(1);
      if (existingError) throw existingError;
      row = existing?.[0] || null;
    }

    if (!row) {
      const { data: existingByLabel, error: existingByLabelError } = await jobdoneDb
      .from('tags')
        .select('*')
        .eq('user_id', userId)
        .eq('category_id', category.id)
        .eq('normalized_label', tag.normalized_label)
        .limit(1);
      if (existingByLabelError) throw existingByLabelError;
      row = existingByLabel?.[0] || null;
    }

    if (!row) {
      const { data, error } = await jobdoneDb
      .from('tags')
        .insert([{
          user_id: userId,
          local_id: tag.local_id,
          category_id: category.id,
          label: tag.label,
          normalized_label: tag.normalized_label,
          status: tag.status,
          created_at: tag.created_at,
          updated_at: tag.updated_at,
        }])
        .select()
        .single();
      if (error) throw error;
      row = data;
    } else {
      const { data, error } = await jobdoneDb
      .from('tags')
        .update({
          category_id: category.id,
          label: tag.label,
          normalized_label: tag.normalized_label,
          status: tag.status,
          updated_at: tag.updated_at,
        })
        .eq('id', row.id)
        .select()
        .single();
      if (error) throw error;
      row = data;
    }

    const { error: linkError } = await jobdoneDb
      .from('entry_tags')
      .upsert([{
        user_id: userId,
        entry_id: entryId,
        tag_id: row.id,
        created_at: new Date().toISOString(),
      }], { onConflict: 'user_id,entry_id,tag_id' });
    if (linkError) throw linkError;

    const { error: vocabularyError } = await jobdoneDb.rpc('increment_tag_vocabulary', {
      p_user_id: userId,
      p_tag_id: row.id,
    });
    if (vocabularyError) {
      const { data: existingVocabulary, error: existingVocabularyError } = await jobdoneDb
      .from('tag_vocabulary')
        .select('*')
        .eq('user_id', userId)
        .eq('tag_id', row.id)
        .limit(1);
      if (existingVocabularyError) throw existingVocabularyError;
      const existing = existingVocabulary?.[0] || null;
      const payload = {
        user_id: userId,
        tag_id: row.id,
        last_used_at: new Date().toISOString(),
        use_count: (existing?.use_count || 0) + 1,
        accepted_count: (existing?.accepted_count || 0) + 1,
        rejected_count: existing?.rejected_count || 0,
      };
      const { error: upsertError } = await jobdoneDb
      .from('tag_vocabulary')
        .upsert([payload], { onConflict: 'user_id,tag_id' });
      if (upsertError) throw upsertError;
    }

    saved.push({
      ...row,
      category_name: category.name,
      use_count: 1,
      accepted_count: 1,
      rejected_count: 0,
    });
  }

  return saved;
}

export async function saveContact(userId, contactData) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured, skipping contact save');
    return null;
  }

  const normalizedEmails = unique(contactData.normalizedEmails || contactData.normalized_emails);
  const normalizedPhones = unique(contactData.normalizedPhones || contactData.normalized_phones);
  const existingContacts = await getContacts(userId);
  const existing = existingContacts.find(contact => contactsMatch(contact, {
    localId: contactData.localId || contactData.local_id || contactData.id,
    normalizedEmails,
    normalizedPhones,
  }));

  const payload = {
    user_id: userId,
    local_id: contactData.localId || contactData.local_id || contactData.id || null,
    status: contactData.status || 'confirmed',
    display_name: contactData.displayName || contactData.display_name || '',
    given_name: contactData.givenName || contactData.given_name || '',
    family_name: contactData.familyName || contactData.family_name || '',
    organization: contactData.organization || '',
    title: contactData.title || '',
    note: contactData.note || '',
    phones: contactData.phones || [],
    emails: contactData.emails || [],
    normalized_phones: normalizedPhones,
    normalized_emails: normalizedEmails,
    primary_phone: contactData.primaryPhone || contactData.primary_phone || normalizedPhones[0] || null,
    primary_email: contactData.primaryEmail || contactData.primary_email || normalizedEmails[0] || null,
    source_capture_ids: unique(contactData.sourceCaptureIds || contactData.source_capture_ids),
    updated_at: new Date().toISOString(),
  };

  if (!existing) {
    const { data, error } = await jobdoneDb
      .from('contacts')
      .insert([{ ...payload, created_at: new Date(contactData.created_at || Date.now()).toISOString() }])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const merged = {
    ...payload,
    local_id: existing.local_id || payload.local_id,
    display_name: payload.display_name || existing.display_name,
    given_name: payload.given_name || existing.given_name,
    family_name: payload.family_name || existing.family_name,
    organization: payload.organization || existing.organization,
    title: payload.title || existing.title,
    note: payload.note || existing.note,
    phones: mergeByKey(existing.phones, payload.phones),
    emails: mergeByKey(existing.emails, payload.emails),
    normalized_phones: unique([...(existing.normalized_phones || []), ...normalizedPhones]),
    normalized_emails: unique([...(existing.normalized_emails || []), ...normalizedEmails]),
    source_capture_ids: unique([...(existing.source_capture_ids || []), ...payload.source_capture_ids]),
  };

  const { data, error } = await jobdoneDb
      .from('contacts')
    .update(merged)
    .eq('id', existing.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getContacts(userId) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  const { data, error } = await jobdoneDb
      .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getLocations(userId) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  const { data, error } = await jobdoneDb
      .from('locations')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export function buildContactLocationCooccurrences(contactLinks = [], locationLinks = []) {
  const contactsByEntry = new Map();
  for (const link of contactLinks || []) {
    if (!link.entry_id || !link.contacts?.id) continue;
    const list = contactsByEntry.get(link.entry_id) || [];
    list.push({
      id: link.contacts.id,
      label: link.contacts.display_name,
      seenAt: link.created_at,
    });
    contactsByEntry.set(link.entry_id, list);
  }

  const byPair = new Map();
  for (const link of locationLinks || []) {
    if (!link.entry_id || !link.locations?.id) continue;
    const contacts = contactsByEntry.get(link.entry_id) || [];
    if (!contacts.length) continue;

    for (const contact of contacts) {
      const pairKey = `${contact.id}:${link.locations.id}`;
      const existing = byPair.get(pairKey) || {
        contactId: contact.id,
        contactLabel: contact.label,
        locationId: link.locations.id,
        locationLabel: link.locations.display_name || link.locations.place_text,
        locationPlaceText: link.locations.place_text || link.locations.display_name,
        locationLatitude: link.locations.latitude,
        locationLongitude: link.locations.longitude,
        count: 0,
        lastSeenAt: null,
      };
      const seenAt = [contact.seenAt, link.created_at]
        .filter(Boolean)
        .sort()
        .at(-1) || null;
      existing.count += 1;
      if (seenAt && (!existing.lastSeenAt || new Date(seenAt) > new Date(existing.lastSeenAt))) {
        existing.lastSeenAt = seenAt;
      }
      byPair.set(pairKey, existing);
    }
  }

  return Array.from(byPair.values());
}

export async function getContactLocationCooccurrences(userId) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  const [{ data: contactLinks, error: contactError }, { data: locationLinks, error: locationError }] = await Promise.all([
    jobdoneDb
      .from('entry_contacts')
      .select('entry_id, created_at, contacts(id, display_name)')
      .eq('user_id', userId),
    jobdoneDb
      .from('entry_locations')
      .select('entry_id, created_at, locations(id, display_name, place_text, latitude, longitude)')
      .eq('user_id', userId),
  ]);

  if (contactError) {
    if (contactError.code === '42P01' || /contacts|entry_contacts/i.test(contactError.message || '')) {
      console.warn('[DB] contact association tables not available; returning no Contact-Location co-occurrences');
      return [];
    }
    throw contactError;
  }

  if (locationError) {
    if (locationError.code === '42P01' || /locations|entry_locations/i.test(locationError.message || '')) {
      console.warn('[DB] location association tables not available; returning no Contact-Location co-occurrences');
      return [];
    }
    throw locationError;
  }

  return buildContactLocationCooccurrences(contactLinks || [], locationLinks || []);
}

export async function getTagVocabulary(userId) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  const { data, error } = await jobdoneDb
      .from('tag_vocabulary')
    .select('*, tags(*, tag_categories(*))')
    .eq('user_id', userId)
    .order('last_used_at', { ascending: false })
    .limit(100);

  if (error) {
    if (error.code === '42P01' || /tag_vocabulary|tags|tag_categories/i.test(error.message || '')) {
      console.warn('[DB] tag vocabulary tables not found; returning no tag candidates');
      return [];
    }
    throw error;
  }

  return data || [];
}

/**
 * Create an anonymous session (no auth needed)
 * Returns a session ID for tracking
 */
export function createAnonymousSession() {
  return `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Save an issue report to Supabase
 */
export async function saveFeedback(userId, {
  transcript,
  created_at,
  diagnostic_bundle,
  identity_class = userId ? 'signed_in' : 'anonymous',
  anonymous_device_id = null,
  abuse_key_hash = null,
} = {}) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured, skipping feedback save');
    return null;
  }

  try {
    const diagnosticBundle = diagnostic_bundle || {};
    const row = {
      user_id: userId,
      identity_class,
      anonymous_device_id,
      abuse_key_hash,
      transcript,
      diagnostic_bundle: diagnosticBundle,
      created_at: new Date(created_at || Date.now()).toISOString(),
    };

    let { data, error } = await jobdoneDb
      .from('feedback')
      .insert([row])
      .select();

    if (error && /identity_class|anonymous_device_id|abuse_key_hash|user_id/i.test(String(error.message || ''))) {
      console.warn('[DB] feedback identity columns missing; saving compatible report shape');
      const compatibilityRow = {
        user_id: userId || `anonymous:${anonymous_device_id || 'unknown'}`,
        transcript: row.transcript,
        diagnostic_bundle: {
          ...diagnosticBundle,
          feedback_identity: {
            identity_class,
            anonymous_device_id,
          },
        },
        created_at: row.created_at,
      };
      const retry = await jobdoneDb
      .from('feedback')
        .insert([compatibilityRow])
        .select();
      data = retry.data;
      error = retry.error;
    }

    if (error && String(error.message || '').includes('diagnostic_bundle')) {
      console.warn('[DB] feedback.diagnostic_bundle missing; saving report without diagnostics');
      const retry = await jobdoneDb
      .from('feedback')
        .insert([{
          user_id: row.user_id || `anonymous:${anonymous_device_id || 'unknown'}`,
          transcript: row.transcript,
          created_at: row.created_at,
        }])
        .select();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw error;

    console.log('[DB] Feedback saved:', data[0]?.id);
    return data[0];
  } catch (error) {
    console.error('[DB] Failed to save feedback:', error.message);
    throw error;
  }
}

/**
 * Get all feedback for a user
 */
export async function getFeedback(userId) {
  if (!jobdoneDb) return [];

  try {
    const { data, error } = await jobdoneDb
      .from('feedback')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('[DB] Failed to fetch feedback:', error.message);
    throw error;
  }
}

/**
 * Update an entry's embedding after it has been saved.
 */
export async function updateEntryEmbedding(entryId, embedding, embeddingModel) {
  if (!jobdoneDb) return;

  try {
    const { error } = await jobdoneDb
      .from('entries')
      .update({
        embedding: `[${embedding.join(',')}]`,
        embedding_model: embeddingModel,
      })
      .eq('id', entryId);

    if (error) {
      console.error('[DB] Failed to update embedding:', error);
    } else {
      console.log('[DB] Embedding stored for entry:', entryId);
    }
  } catch (err) {
    console.error('[DB] updateEntryEmbedding error:', err.message);
  }
}

async function attachEntryStructure(userId, entries = []) {
  const entryIds = entries.map(entry => entry.id).filter(Boolean);
  if (entryIds.length === 0) return entries;

  let locationLinks = [];
  let contactLinks = [];
  let tagLinks = [];

  const { data: locationsData, error: locationsError } = await jobdoneDb
      .from('entry_locations')
    .select('entry_id, created_at, locations(*)')
    .eq('user_id', userId)
    .in('entry_id', entryIds)
    .order('created_at', { ascending: true });

  if (locationsError) {
    if (locationsError.code === '42P01' || /locations|entry_locations/i.test(locationsError.message || '')) {
      console.warn('[DB] Location tables not available; returning recall results without locations');
    } else {
      throw locationsError;
    }
  } else {
    locationLinks = locationsData || [];
  }

  const { data: contactsData, error: contactsError } = await jobdoneDb
      .from('entry_contacts')
    .select('entry_id, created_at, contacts(*)')
    .eq('user_id', userId)
    .in('entry_id', entryIds)
    .order('created_at', { ascending: true });

  if (contactsError) {
    if (contactsError.code === '42P01' || /contacts|entry_contacts/i.test(contactsError.message || '')) {
      console.warn('[DB] Contact association tables not available; returning recall results without contacts');
    } else {
      throw contactsError;
    }
  } else {
    contactLinks = contactsData || [];
  }

  const { data: tagsData, error: tagsError } = await jobdoneDb
      .from('entry_tags')
    .select('entry_id, created_at, tags(*, tag_categories(*))')
    .eq('user_id', userId)
    .in('entry_id', entryIds)
    .order('created_at', { ascending: true });

  if (tagsError) {
    if (tagsError.code === '42P01' || /tags|entry_tags/i.test(tagsError.message || '')) {
      console.warn('[DB] Tag tables not available; returning recall results without tags');
    } else {
      throw tagsError;
    }
  } else {
    tagLinks = tagsData || [];
  }

  const locationsByEntryId = new Map();
  for (const link of locationLinks) {
    const location = link.locations;
    if (!location || location.status !== 'confirmed') continue;
    if (!locationsByEntryId.has(link.entry_id)) locationsByEntryId.set(link.entry_id, []);
    locationsByEntryId.get(link.entry_id).push(location);
  }

  const tagsByEntryId = new Map();
  for (const link of tagLinks) {
    const tag = link.tags;
    if (!tag || tag.status !== 'confirmed') continue;
    if (!tagsByEntryId.has(link.entry_id)) tagsByEntryId.set(link.entry_id, []);
    tagsByEntryId.get(link.entry_id).push(tag);
  }

  const contactsByEntryId = new Map();
  for (const link of contactLinks) {
    const contact = link.contacts;
    if (!contact || contact.status !== 'confirmed') continue;
    if (!contactsByEntryId.has(link.entry_id)) contactsByEntryId.set(link.entry_id, []);
    contactsByEntryId.get(link.entry_id).push(contact);
  }

  return entries.map(entry => ({
    ...entry,
    locations: locationsByEntryId.get(entry.id) || [],
    contacts: contactsByEntryId.get(entry.id) || [],
    tags: tagsByEntryId.get(entry.id) || [],
  }));
}

/**
 * Recall: deterministic SQL search against a user's confirmed Entries.
 *
 * @param {string} userId
 * @param {object} opts
 * @param {string} opts.query - user recall query
 * @param {number} opts.limit - max results (default 10)
 * @returns {Promise<Array>} rows with recall_score and match_reasons
 */
export async function recallEntries(userId, { query = '', limit = 10 } = {}) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  try {
    const { data, error } = await jobdoneDb.recallEntriesSql({ userId, query, limit });

    if (error) {
      console.error('[DB] Recall error:', error);
      throw error;
    }

    const candidates = data || [];
    if (candidates.length === 0) return [];

    return attachEntryStructure(userId, candidates);
  } catch (err) {
    console.error('[DB] recallEntries failed:', err.message);
    throw err;
  }
}

/**
 * Save a query to Supabase. Deduplicates by text — if same text
 * already exists for the user, updates created_at to bubble to top.
 */
export async function saveQuery(userId, text) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured, skipping query save');
    return null;
  }

  try {
    // Try to find existing query with same text
    const { data: existing } = await jobdoneDb
      .from('queries')
      .select('id')
      .eq('user_id', userId)
      .eq('text', text)
      .single();

    if (existing) {
      // Update created_at to bubble to top
      const { data, error } = await jobdoneDb
      .from('queries')
        .update({ created_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select();

      if (error) throw error;
      console.log('[DB] Query refreshed:', existing.id);
      return data[0];
    }

    // Insert new query
    const { data, error } = await jobdoneDb
      .from('queries')
      .insert([{ user_id: userId, text }])
      .select();

    if (error) throw error;
    console.log('[DB] Query saved:', data[0]?.id);
    return data[0];
  } catch (error) {
    console.error('[DB] Failed to save query:', error.message);
    throw error;
  }
}

/**
 * Get up to 50 most recent queries for a user, deduplicated by text.
 * Returns distinct texts ordered by most recent created_at.
 */
export async function getQueries(userId, { limit = 50 } = {}) {
  if (!jobdoneDb) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  try {
    const { data, error } = await jobdoneDb
      .from('queries')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit * 2); // Fetch extra to account for dedup

    if (error) throw error;

    // Deduplicate by text, keeping first occurrence (most recent)
    const seen = new Set();
    const deduped = [];
    for (const q of data || []) {
      if (!seen.has(q.text)) {
        seen.add(q.text);
        deduped.push(q);
        if (deduped.length >= limit) break;
      }
    }

    return deduped;
  } catch (error) {
    console.error('[DB] Failed to fetch queries:', error.message);
    throw error;
  }
}

export { supabase };
