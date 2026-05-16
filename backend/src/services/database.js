import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[Database] Supabase not configured. Cloud sync disabled.');
}

const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey)
  : null;

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
          transcript: entryData.transcript,
          summary: entryData.summary,
          materials: entryData.materials,
          labour_minutes: entryData.labour_minutes,
          follow_ups: entryData.follow_ups,
          possible_future_work: entryData.possible_future_work,
          created_at: new Date(entryData.created_at).toISOString(),
          embedding: entryData.embedding ?? null,
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

export { supabase };
