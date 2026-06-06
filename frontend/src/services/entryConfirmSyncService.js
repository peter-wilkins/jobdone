import { dbService } from './dbService.js';
import { syncOrchestratorService } from './syncOrchestratorService.js';

function hasSyncableText(entry = {}) {
  return Boolean(String(entry.transcript || '').trim() && String(entry.summary || '').trim());
}

export async function syncConfirmedEntryAfterReview({
  entryId,
  entry,
  user,
  db = dbService,
  syncOrchestrator = syncOrchestratorService,
  reason = 'entry_confirm',
} = {}) {
  if (!entry || !hasSyncableText(entry)) {
    return { skipped: true, entry: entry || null, syncResult: null };
  }

  if (!user) {
    console.log('[Sync] Skipped — not logged in. Will retry on login.');
    return { skipped: true, entry, syncResult: null };
  }

  const syncResult = await syncOrchestrator.syncConfirmedData({ reason });
  const refreshedEntry = typeof db.getEntry === 'function'
    ? await db.getEntry(entryId || entry.id)
    : null;

  return {
    skipped: false,
    entry: refreshedEntry ? { ...entry, ...refreshedEntry } : entry,
    syncResult,
  };
}
