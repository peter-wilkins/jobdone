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
 * Save a confirmed job to Supabase
 */
export async function saveJob(userId, jobData) {
  if (!supabase) {
    console.warn('[DB] Supabase not configured, skipping save');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('jobs')
      .insert([
        {
          user_id: userId,
          transcript: jobData.transcript,
          summary: jobData.summary,
          materials: jobData.materials,
          labour_minutes: jobData.labour_minutes,
          follow_ups: jobData.follow_ups,
          possible_future_work: jobData.possible_future_work,
          created_at: new Date(jobData.created_at).toISOString(),
        },
      ])
      .select();

    if (error) {
      console.error('[DB] Save error:', error);
      throw error;
    }

    console.log('[DB] Job saved:', data[0]?.id);
    return data[0];
  } catch (error) {
    console.error('[DB] Failed to save job:', error.message);
    throw error;
  }
}

/**
 * Get all jobs for a user
 */
export async function getJobs(userId) {
  if (!supabase) {
    console.warn('[DB] Supabase not configured');
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[DB] Fetch error:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('[DB] Failed to fetch jobs:', error.message);
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

export { supabase };
