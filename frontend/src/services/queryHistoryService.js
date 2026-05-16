import { dbService } from './dbService.js';
import { apiService } from './apiService.js';

/**
 * QueryHistoryService manages query history in IndexedDB and syncs to server.
 * - Local storage fills offline gap
 * - Server is source of truth, merged on login
 */
export class QueryHistoryService {
  /**
   * Save a query locally and sync to server.
   * @param {string} text - Query text
   */
  async add(text) {
    // Save to local IndexedDB
    await dbService.saveQuery(text);

    // Sync to server (non-blocking, apiService handles auth)
    try {
      await apiService.saveQuery(text);
      await dbService.markQuerySynced(text);
    } catch (err) {
      console.warn('[QueryHistory] Server sync failed, saved locally:', err.message);
    }
  }

  /**
   * Get recent queries from local IndexedDB.
   * @returns {Promise<Array>} Recent queries
   */
  async getRecent() {
    const queries = await dbService.getQueries(50);
    return queries;
  }

  /**
   * On login: fetch server queries and merge with local.
   * Server is source of truth — local queries not on server are kept.
   */
  async syncOnLogin() {
    try {
      const serverQueries = await apiService.getQueries();

      // Merge: server queries take priority, local-only queries are kept
      const serverTexts = new Set(serverQueries.map(q => q.text));
      const localQueries = await dbService.getQueries();

      // Mark server queries as synced
      for (const sq of serverQueries) {
        await dbService.saveQuery(sq.text, sq.created_at, true);
      }

      // Keep local queries not on server
      for (const lq of localQueries) {
        if (!serverTexts.has(lq.text)) {
          // Already saved locally, nothing to do
        }
      }
    } catch (err) {
      console.warn('[QueryHistory] Login sync failed:', err.message);
    }
  }
}

export const queryHistoryService = new QueryHistoryService();
