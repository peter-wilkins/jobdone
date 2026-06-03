/**
 * API service for communicating with JobDone backend
 */

import { authService } from './authService.js';
import { normalizeRecallEntry } from './entryMapper.js';
import { getFeedbackDeviceId } from './feedbackIdentityService.js';
import { fetchWithRequestDiagnostics } from './requestDiagnosticsService.js';
import { checkForAndApplyAppUpdate } from './serviceWorker.js';

function defaultApiBaseUrl() {
  const hostname = globalThis.window?.location?.hostname || '';
  if (hostname.endsWith('.vercel.app')) return 'https://jobdone-gamma.vercel.app';
  return 'http://localhost:3000';
}

const API_BASE_URL = import.meta.env.VITE_API_URL || defaultApiBaseUrl();
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const AUDIO_UPLOAD_TIMEOUT_MS = 60000;

function authHeader() {
  const token = authService.getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function apiFetch(...args) {
  const response = await fetchWithRequestDiagnostics(...args);
  if (response.ok) {
    checkForAndApplyAppUpdate().catch(error => {
      console.warn('[PWA] Background update check failed:', error);
    });
  }
  return response;
}

export class APIService {
  /**
   * Check if backend is available
   */
  async checkHealth() {
    try {
      const response = await apiFetch(`${API_BASE_URL}/health`, {}, HEALTH_CHECK_TIMEOUT_MS);
      return response.ok;
    } catch (error) {
      console.warn('Backend health check failed:', error);
      return false;
    }
  }

  /**
   * Upload audio blob and get transcription + summary
   * @param {Blob} audioBlob - Audio file blob
   * @returns {Promise<{transcript: string, summary: string}>}
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

      const response = await apiFetch(`${API_BASE_URL}/api/transcribe`, {
        method: 'POST',
        body: formData,
      }, AUDIO_UPLOAD_TIMEOUT_MS);

      console.log('[API] Response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        const message = error.error || `HTTP ${response.status}: Transcription failed`;
        const transcriptionError = new Error(message);
        transcriptionError.code = error.code || null;
        transcriptionError.status = response.status;
        throw transcriptionError;
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
   * @returns {Promise<{summary: string}>}
   */
  async summarizeTranscript(transcript) {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/summarize`, {
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

      const response = await apiFetch(`${API_BASE_URL}/api/sync/save`, {
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
      const response = await apiFetch(`${API_BASE_URL}/api/sync/entries`, {
        headers: authHeader(),
      });
      if (!response.ok) return [];
      const result = await response.json();
      return result.entries || [];
    } catch {
      return [];
    }
  }

  async syncContacts(contacts) {
    const response = await apiFetch(`${API_BASE_URL}/api/sync/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ contacts }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Contacts sync failed');
    }
    return response.json();
  }

  async syncLocations(locations) {
    const response = await apiFetch(`${API_BASE_URL}/api/sync/locations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ locations }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Locations sync failed');
    }
    return response.json();
  }

  async lookupLocations(query) {
    const params = new URLSearchParams({ q: query });
    const response = await apiFetch(`${API_BASE_URL}/api/locations/lookup?${params.toString()}`, {
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Address lookup failed');
    }
    return response.json();
  }

  async getCloudContacts() {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/sync/contacts`, {
        headers: authHeader(),
      });
      if (!response.ok) return [];
      const result = await response.json();
      return result.contacts || [];
    } catch {
      return [];
    }
  }

  async getCloudLocations() {
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/sync/locations`, {
        headers: authHeader(),
      });
      if (!response.ok) return [];
      const result = await response.json();
      return result.locations || [];
    } catch {
      return [];
    }
  }

  async predictStructure({ entryData, contextClues = [] }) {
    const response = await apiFetch(`${API_BASE_URL}/api/structure/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ entryData, contextClues }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Structure prediction failed`);
    }
    return response.json();
  }

  /**
   * Save confirmed feedback to cloud
   * @param {{ transcript: string, created_at: string, diagnostic_bundle?: Object }} payload
   */
  async saveFeedback(payload) {
    try {
      const body = {
        ...payload,
        anonymous_device_id: getFeedbackDeviceId(),
      };
      const response = await apiFetch(`${API_BASE_URL}/api/feedback/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(body),
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
   * Save a privacy-bounded crash report to cloud.
   * @param {{ crash_report: Object, diagnostic_bundle?: Object }} payload
   */
  async saveCrashReport(payload) {
    try {
      const body = {
        ...payload,
        anonymous_device_id: getFeedbackDeviceId(),
      };
      const response = await apiFetch(`${API_BASE_URL}/api/crash-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save crash report');
      }
      return await response.json();
    } catch (error) {
      console.error('Crash report save error:', error);
      throw error;
    }
  }

  /**
   * Save a query to the server
   * @param {string} text - Query text
   * @returns {Promise<Object>} Saved query
   */
  async saveQuery(text) {
    const response = await apiFetch(`${API_BASE_URL}/api/queries`, {
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
      const response = await apiFetch(`${API_BASE_URL}/api/queries`, {
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
    const response = await apiFetch(`${API_BASE_URL}/api/user/data`, {
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

      const response = await apiFetch(`${API_BASE_URL}/api/recall`, {
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
      return (result.entries || []).map(normalizeRecallEntry);
    } catch (error) {
      console.error('Recall error:', error);
      throw error;
    }
  }

  async getTeamSetupState(teamId = null) {
    const query = teamId ? `?team_id=${encodeURIComponent(teamId)}` : '';
    const response = await apiFetch(`${API_BASE_URL}/api/teams/setup${query}`, {
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to load Team`);
    }
    return response.json();
  }

  async getTeamReviewState() {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/review`, {
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to load Team Review`);
    }
    return response.json();
  }

  async updateTeamSetup({ id = null, name, template, requireOwnerSelfReview = false, createNewTeam = false }) {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/setup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ team_id: id, name, template, require_owner_self_review: requireOwnerSelfReview, create_new_team: createNewTeam }),
    });
    if (!response.ok) {
      const error = await response.json();
      const requestError = new Error(error.error || `HTTP ${response.status}: Failed to update Team`);
      requestError.status = response.status;
      throw requestError;
    }
    return response.json();
  }

  async deleteTeam(id) {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to delete Team`);
    }
    return response.json();
  }

  async getMyWorkState() {
    const response = await apiFetch(`${API_BASE_URL}/api/my-work`, {
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to load My Work`);
    }
    return response.json();
  }

  async createTeamBacklogItem({ teamId, description, points }) {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/backlog-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ team_id: teamId, description, points }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to create Backlog Item`);
    }
    return response.json();
  }

  async updateTeamBacklogItem(id, { teamId, description, points }) {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/backlog-items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ team_id: teamId, description, points }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to update Backlog Item`);
    }
    return response.json();
  }

  async deleteTeamBacklogItem(id, teamId = null) {
    const query = teamId ? `?team_id=${encodeURIComponent(teamId)}` : '';
    const response = await apiFetch(`${API_BASE_URL}/api/teams/backlog-items/${id}${query}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to delete Backlog Item`);
    }
    return response.json();
  }

  async claimTeamBacklogItem(id) {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/backlog-items/${id}/claim`, {
      method: 'POST',
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to claim Backlog Item`);
    }
    return response.json();
  }

  async submitTeamBacklogItem(id, { evidence_text }) {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/backlog-items/${id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ evidence_text }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to submit evidence`);
    }
    return response.json();
  }

  async decideTeamApprovalRequest(id, decision, teamId = null) {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/approval-requests/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ team_id: teamId, decision }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to decide Approval Request`);
    }
    return response.json();
  }

  async createTeamInvite({ teamId, email }) {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ team_id: teamId, email }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to create invite`);
    }
    return response.json();
  }

  async revokeTeamInvite(id, teamId = null) {
    const query = teamId ? `?team_id=${encodeURIComponent(teamId)}` : '';
    const response = await apiFetch(`${API_BASE_URL}/api/teams/invites/${id}${query}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to remove invite`);
    }
    return response.json();
  }

  async resendTeamInvite(id, teamId = null) {
    const query = teamId ? `?team_id=${encodeURIComponent(teamId)}` : '';
    const response = await apiFetch(`${API_BASE_URL}/api/teams/invites/${id}/resend${query}`, {
      method: 'POST',
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to resend invite`);
    }
    return response.json();
  }

  async inspectTeamInvite(token) {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/invites/${encodeURIComponent(token)}`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to load invite`);
    }
    return response.json();
  }

  async acceptTeamInvite(token) {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to accept invite`);
    }
    return response.json();
  }
}

// Singleton instance
export const apiService = new APIService();
