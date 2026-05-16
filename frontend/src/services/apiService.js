/**
 * API service for communicating with JobDone backend
 */

import { authService } from './authService.js';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function authHeader() {
  const token = authService.getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export class APIService {
  /**
   * Check if backend is available
   */
  async checkHealth() {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      return response.ok;
    } catch (error) {
      console.warn('Backend health check failed:', error);
      return false;
    }
  }

  /**
   * Upload audio blob and get transcription + summary
   * @param {Blob} audioBlob - Audio file blob
   * @returns {Promise<{transcript: string, summary: string, materials: string[], labour_minutes: number|null, follow_ups: string[], possible_future_work: string}>}
   */
  async transcribeAudio(audioBlob) {
    try {
      console.log('[API] Transcribing audio:', {
        size: audioBlob.size,
        type: audioBlob.type,
      });

      if (!audioBlob || audioBlob.size === 0) {
        throw new Error('Audio blob is empty');
      }

      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      console.log('[API] Sending to backend:', `${API_BASE_URL}/api/transcribe`);

      const response = await fetch(`${API_BASE_URL}/api/transcribe`, {
        method: 'POST',
        body: formData,
      });

      console.log('[API] Response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}: Transcription failed`);
      }

      const result = await response.json();
      console.log('[API] Transcription successful');
      return result;
    } catch (error) {
      console.error('Transcription error:', error);
      throw error;
    }
  }

  /**
   * Summarize an existing transcript
   * @param {string} transcript - Transcript text
   * @returns {Promise<{summary: string, materials: string[], labour_minutes: number|null, follow_ups: string[], possible_future_work: string}>}
   */
  async summarizeTranscript(transcript) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcript }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Summarization failed');
      }

      return await response.json();
    } catch (error) {
      console.error('Summarization error:', error);
      throw error;
    }
  }

  /**
   * Save a confirmed entry to cloud
   * @param {Object} payload - {entryData}
   * @returns {Promise<{success: boolean, entry: Object}>}
   */
  async syncSave(payload) {
    try {
      console.log('[API] Syncing entry to cloud');

      const response = await fetch(`${API_BASE_URL}/api/sync/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Sync failed');
      }

      const result = await response.json();
      console.log('[API] Sync successful');
      return result;
    } catch (error) {
      console.error('Sync error:', error);
      throw error;
    }
  }

  /** Fetch all cloud entries for the logged-in user */
  async getCloudEntries() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/sync/entries`, {
        headers: authHeader(),
      });
      if (!response.ok) return [];
      const result = await response.json();
      return result.entries || [];
    } catch {
      return [];
    }
  }

  /**
   * Save confirmed feedback to cloud
   * @param {{ userId: string, transcript: string, created_at: string }} payload
   */
  async saveFeedback(payload) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/feedback/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save feedback');
      }
      return await response.json();
    } catch (error) {
      console.error('Feedback save error:', error);
      throw error;
    }
  }

  /**
   * Save a query to the server
   * @param {string} text - Query text
   * @returns {Promise<Object>} Saved query
   */
  async saveQuery(text) {
    const response = await fetch(`${API_BASE_URL}/api/queries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to save query`);
    }
    const result = await response.json();
    return result.query;
  }

  /**
   * Fetch query history from server
   * @returns {Promise<Array>} Recent queries
   */
  async getQueries() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/queries`, {
        headers: authHeader(),
      });
      if (!response.ok) return [];
      const result = await response.json();
      return result.queries || [];
    } catch {
      return [];
    }
  }

  /**
   * Delete all user data (GDPR)
   */
  async deleteUserData() {
    const response = await fetch(`${API_BASE_URL}/api/user/data`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to delete user data`);
    }
    return true;
  }

  /**
   * Recall entries matching a query
   * @param {string} query - Query text
   * @returns {Promise<Array>} Matching entries ordered by relevance
   */
  async recall(query) {
    try {
      console.log('[API] Recalling entries for query:', query);

      const response = await fetch(`${API_BASE_URL}/api/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `HTTP ${response.status}: Recall failed`);
      }

      const result = await response.json();
      console.log('[API] Recall successful, entries:', result.entries?.length || 0);
      return result.entries || [];
    } catch (error) {
      console.error('Recall error:', error);
      throw error;
    }
  }
}

// Singleton instance
export const apiService = new APIService();
