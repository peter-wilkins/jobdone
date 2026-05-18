import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[Database] Supabase not configured. Cloud sync disabled.');
}

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

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

function peopleMatch(existing, incoming) {
  if (existing.local_id && incoming.localId && existing.local_id === incoming.localId) return true;

  const existingEmails = new Set(existing.normalized_emails || []);
  const existingPhones = new Set(existing.normalized_phones || []);
  return (incoming.normalizedEmails || []).some(email => existingEmails.has(email)) ||
    (incoming.normalizedPhones || []).some(phone => existingPhones.has(phone));
}

/**
 * Save a confirmed entry to Supabase
 */
export async function saveEntry(userId, entryData) {
  if (!supabase) {
    console.warn('[DB] Supabase not configured, skipping save');
    return null;
  }

  try {
    const { data, error } = await supabase
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
  if (!supabase) {
    console.warn('[DB] Supabase not configured');
    return null;
  }

  try {
    const { data, error } = await supabase
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
  if (!supabase) {
    console.warn('[DB] Supabase not configured');
    return null;
  }

  try {
    const createdAtIso = new Date(createdAt).toISOString();
    const { data, error } = await supabase
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
  if (!supabase) {
    console.warn('[DB] Supabase not configured, skipping delete');
    return null;
  }

  try {
    const { error: entriesErr } = await supabase
      .from('entries')
      .delete()
      .eq('user_id', userId);
    if (entriesErr) throw entriesErr;

    const { error: peopleErr } = await supabase
      .from('people')
      .delete()
      .eq('user_id', userId);
    if (peopleErr) throw peopleErr;

    const { error: queriesErr } = await supabase
      .from('queries')
      .delete()
      .eq('user_id', userId);
    if (queriesErr) throw queriesErr;

    const { error: feedbackErr } = await supabase
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
  if (!supabase) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[DB] Fetch error:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('[DB] Failed to fetch entries:', error.message);
    throw error;
  }
}

export async function savePerson(userId, personData) {
  if (!supabase) {
    console.warn('[DB] Supabase not configured, skipping person save');
    return null;
  }

  const normalizedEmails = unique(personData.normalizedEmails || personData.normalized_emails);
  const normalizedPhones = unique(personData.normalizedPhones || personData.normalized_phones);
  const existingPeople = await getPeople(userId);
  const existing = existingPeople.find(person => peopleMatch(person, {
    localId: personData.localId || personData.local_id || personData.id,
    normalizedEmails,
    normalizedPhones,
  }));

  const payload = {
    user_id: userId,
    local_id: personData.localId || personData.local_id || personData.id || null,
    status: personData.status || 'confirmed',
    display_name: personData.displayName || personData.display_name || '',
    given_name: personData.givenName || personData.given_name || '',
    family_name: personData.familyName || personData.family_name || '',
    organization: personData.organization || '',
    title: personData.title || '',
    note: personData.note || '',
    phones: personData.phones || [],
    emails: personData.emails || [],
    normalized_phones: normalizedPhones,
    normalized_emails: normalizedEmails,
    primary_phone: personData.primaryPhone || personData.primary_phone || normalizedPhones[0] || null,
    primary_email: personData.primaryEmail || personData.primary_email || normalizedEmails[0] || null,
    source_capture_ids: unique(personData.sourceCaptureIds || personData.source_capture_ids),
    updated_at: new Date().toISOString(),
  };

  if (!existing) {
    const { data, error } = await supabase
      .from('people')
      .insert([{ ...payload, created_at: new Date(personData.created_at || Date.now()).toISOString() }])
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

  const { data, error } = await supabase
    .from('people')
    .update(merged)
    .eq('id', existing.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPeople(userId) {
  if (!supabase) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  const { data, error } = await supabase
    .from('people')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .order('updated_at', { ascending: false });
  if (error) throw error;
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
 * Save a feedback note to Supabase
 */
export async function saveFeedback(userId, { transcript, created_at }) {
  if (!supabase) {
    console.warn('[DB] Supabase not configured, skipping feedback save');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('feedback')
      .insert([{
        user_id: userId,
        transcript,
        created_at: new Date(created_at).toISOString(),
      }])
      .select();

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
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
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
  if (!supabase) return;

  try {
    const { error } = await supabase
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

/**
 * Recall: cosine-similarity search against a user's entries.
 *
 * @param {string} userId
 * @param {number[]} queryEmbedding - 1536-dim vector
 * @param {object} opts
 * @param {number} opts.limit - max results (default 10)
 * @param {number} opts.floor - minimum similarity (default 0.3)
 * @returns {Promise<Array>} rows with similarity score
 */
export async function recallEntries(userId, queryEmbedding, { limit = 10, floor = 0.3 } = {}) {
  if (!supabase) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  try {
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    const { data, error } = await supabase.rpc('match_entries', {
      p_user_id: userId,
      p_query_embedding: vectorLiteral,
      p_match_count: limit,
      p_similarity_floor: floor,
    });

    if (error) {
      console.error('[DB] Recall error:', error);
      throw error;
    }

    return data || [];
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
  if (!supabase) {
    console.warn('[DB] Supabase not configured, skipping query save');
    return null;
  }

  try {
    // Try to find existing query with same text
    const { data: existing } = await supabase
      .from('queries')
      .select('id')
      .eq('user_id', userId)
      .eq('text', text)
      .single();

    if (existing) {
      // Update created_at to bubble to top
      const { data, error } = await supabase
        .from('queries')
        .update({ created_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select();

      if (error) throw error;
      console.log('[DB] Query refreshed:', existing.id);
      return data[0];
    }

    // Insert new query
    const { data, error } = await supabase
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
  if (!supabase) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  try {
    const { data, error } = await supabase
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
