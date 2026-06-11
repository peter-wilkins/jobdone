/**
 * API service for communicating with JobDone backend
 */

import { authService } from './authService.js';
import { normalizeRecallEntry } from './entryMapper.js';
import { getFeedbackDeviceId } from './feedbackIdentityService.js';
import { fetchWithRequestDiagnostics } from './requestDiagnosticsService.js';
import { applyAvailableAppUpdate } from './serviceWorker.js';
import { shouldDeferAppUpdateNow } from './appUpdateGuardService.js';
import {
  parseLocationReplicaManifestRequest,
  parseLocationReplicaManifestResponse,
  parseLocationReplicaPushRequest,
  parseLocationReplicaPullRequest,
  parseLocationReplicaRecordsResponse,
} from '../contracts/locationReplica.js';
import {
  parsePullRequest,
  parsePullResponse,
  parsePushRequest,
  parsePushResponse,
} from '../contracts/localReplica.js';
import { parseContactPullPayload, parseContactsPayload } from '../contracts/syncRequests.js';
import { parseContactsResponse } from '../contracts/syncResponses.js';

const ENV = import.meta.env || {};

export function defaultApiBaseUrl(hostname = globalThis.window?.location?.hostname || '') {
  if (hostname.includes('staging')) return 'https://jobdone-backend-staging.vercel.app';
  if (hostname === 'jobdone.continuumkit.org') return 'https://jobdone-backend-production.vercel.app';
  if (hostname.includes('production')) return 'https://jobdone-backend-production.vercel.app';
  if (hostname.endsWith('.vercel.app')) return 'https://jobdone-gamma.vercel.app';
  return 'http://localhost:3000';
}

const API_BASE_URL = ENV.VITE_API_URL || defaultApiBaseUrl();
const BUILD_ID = ENV.VITE_BUILD_ID || 'dev';
const HEALTH_CHECK_TIMEOUT_MS = 3000;
let updateReloadStarted = false;
const UPDATE_RELOAD_PREFIX = 'jobdone.updateReloadedForBuild.';

function authHeader() {
  const token = authService.getToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export function shouldApplyAppUpdateForBackendBuild(backendBuild, currentBuild = BUILD_ID) {
  return Boolean(backendBuild && backendBuild !== 'dev' && backendBuild !== currentBuild);
}

export function shouldStartBuildMismatchReload(backendBuild, {
  currentBuild = BUILD_ID,
  storage = globalThis.sessionStorage,
} = {}) {
  if (!shouldApplyAppUpdateForBackendBuild(backendBuild, currentBuild)) return false;
  const key = `${UPDATE_RELOAD_PREFIX}${currentBuild}.${backendBuild}`;
  try {
    if (storage?.getItem?.(key)) return false;
    storage?.setItem?.(key, new Date().toISOString());
  } catch {
    return !updateReloadStarted;
  }
  return true;
}

export function shouldApplyAppUpdateForApiResponse(response, {
  currentBuild = BUILD_ID,
  storage = globalThis.sessionStorage,
  updateStarted = updateReloadStarted,
  updateDeferred = shouldDeferAppUpdateNow(),
} = {}) {
  if (updateStarted || updateDeferred) return false;
  const backendBuild = response?.headers?.get?.('x-jobdone-build');
  return shouldStartBuildMismatchReload(backendBuild, { currentBuild, storage });
}

async function apiFetch(...args) {
  const response = await fetchWithRequestDiagnostics(...args);
  if (shouldApplyAppUpdateForApiResponse(response)) {
    updateReloadStarted = true;
    applyAvailableAppUpdate();
  }
  return response;
}

async function throwApiError(response, fallbackMessage) {
  let message = fallbackMessage;
  try {
    const error = await response.json();
    message = error.error || error.message || message;
  } catch {
    // Keep the fallback. Some failed responses are empty or not JSON.
  }
  const apiError = new Error(message);
  apiError.status = response.status;
  throw apiError;
}

function typedSyncResponse(parsed, fallbackMessage) {
  if (parsed.success) return parsed.data;
  throw new Error(parsed.error || fallbackMessage);
}

function typedSyncRequest(parsed, fallbackMessage) {
  if (parsed.success) return parsed.data;
  throw new Error(parsed.error || fallbackMessage);
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

  async getContactManifest(localManifest = { contacts: [] }) {
    const response = await apiFetch(`${API_BASE_URL}/api/sync/contacts/manifest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ localManifest }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Contact manifest failed');
    }
    return response.json();
  }

  async pushContacts(contacts) {
    const payload = typedSyncRequest(parseContactsPayload({ contacts }), 'Invalid contacts sync payload');
    const response = await apiFetch(`${API_BASE_URL}/api/sync/contacts/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Contact push failed');
    }
    return typedSyncResponse(parseContactsResponse(await response.json()), 'Invalid contacts sync response');
  }

  async pullContacts(clientIds) {
    const payload = typedSyncRequest(parseContactPullPayload({ clientIds }), 'Invalid contact pull payload');
    const response = await apiFetch(`${API_BASE_URL}/api/sync/contacts/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Contact pull failed');
    }
    return typedSyncResponse(parseContactsResponse(await response.json()), 'Invalid contacts sync response');
  }

  async pushContactAliases(aliases) {
    const response = await apiFetch(`${API_BASE_URL}/api/sync/contacts/aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ aliases }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Contact alias push failed');
    }
    return response.json();
  }

  async getLocationReplicaManifest(payload = { locations: [] }) {
    const body = typedSyncRequest(parseLocationReplicaManifestRequest(payload), 'Invalid Location Replica manifest request');
    const response = await apiFetch(`${API_BASE_URL}/api/local-replica/locations/manifest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!response.ok) await throwApiError(response, 'Location Replica manifest failed');
    return typedSyncResponse(parseLocationReplicaManifestResponse(await response.json()), 'Invalid Location Replica manifest response');
  }

  async pushLocationsForReplica(locations) {
    const body = typedSyncRequest(parseLocationReplicaPushRequest({ locations }), 'Invalid Location Replica push request');
    const response = await apiFetch(`${API_BASE_URL}/api/local-replica/locations/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!response.ok) await throwApiError(response, 'Location Replica push failed');
    return typedSyncResponse(parseLocationReplicaRecordsResponse(await response.json()), 'Invalid Location Replica push response');
  }

  async pullLocationsForReplica(ids) {
    const body = typedSyncRequest(parseLocationReplicaPullRequest({ ids }), 'Invalid Location Replica pull request');
    const response = await apiFetch(`${API_BASE_URL}/api/local-replica/locations/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!response.ok) await throwApiError(response, 'Location Replica pull failed');
    return typedSyncResponse(parseLocationReplicaRecordsResponse(await response.json()), 'Invalid Location Replica pull response');
  }

  async pushLocationAliases(aliases) {
    const response = await apiFetch(`${API_BASE_URL}/api/local-replica/locations/aliases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ aliases }),
    });
    if (!response.ok) await throwApiError(response, 'Location Replica alias push failed');
    return response.json();
  }

  async pushLocalReplica(request) {
    const body = typedSyncRequest(parsePushRequest(request), 'Invalid Local Replica push request');
    const response = await apiFetch(`${API_BASE_URL}/api/local-replica/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jobdone-device-id': getFeedbackDeviceId(),
        ...authHeader(),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) await throwApiError(response, 'Local Replica push failed');
    return typedSyncResponse(parsePushResponse(await response.json()), 'Invalid Local Replica push response');
  }

  async pullLocalReplica(request) {
    const body = typedSyncRequest(parsePullRequest(request), 'Invalid Local Replica pull request');
    const response = await apiFetch(`${API_BASE_URL}/api/local-replica/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jobdone-device-id': getFeedbackDeviceId(),
        ...authHeader(),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) await throwApiError(response, 'Local Replica pull failed');
    return typedSyncResponse(parsePullResponse(await response.json()), 'Invalid Local Replica pull response');
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
      const result = typedSyncResponse(parseContactsResponse(await response.json()), 'Invalid contacts sync response');
      return result.contacts || [];
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
      const trimmedQuery = String(query || '').trim();
      if (!trimmedQuery) {
        throw new Error('query must be a non-empty string');
      }

      console.log('[API] Recalling entries for query:', trimmedQuery);

      const response = await apiFetch(`${API_BASE_URL}/api/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ query: trimmedQuery }),
      });

      if (!response.ok) {
        await throwApiError(response, 'Recall failed');
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

  async getTeamWorkState(teamId) {
    const query = teamId ? `?team_id=${encodeURIComponent(teamId)}` : '';
    const response = await apiFetch(`${API_BASE_URL}/api/teams/work${query}`, {
      headers: authHeader(),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to load Team Work`);
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

  async createAndClaimTeamBacklogItem({ teamId, description, points = null }) {
    const response = await apiFetch(`${API_BASE_URL}/api/teams/backlog-items/create-and-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ team_id: teamId, description, points }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}: Failed to create and claim Backlog Item`);
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
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({}),
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
