export function normalizeRecallEntry(entry) {
  if (!entry) return entry;

  return {
    ...entry,
    remoteId: entry.remoteId || entry.remote_id || entry.id || null,
    captureId: entry.captureId || entry.capture_id || null,
    syncStatus: entry.syncStatus || entry.sync_status || 'synced',
  };
}
