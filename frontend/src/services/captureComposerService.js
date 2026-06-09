const DRAFT_PREFIX = 'jobdone.captureComposerDraft.';

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

export function composerDraftStorageKey(draftKey) {
  const key = String(draftKey || '').trim();
  return key ? `${DRAFT_PREFIX}${key}` : null;
}

export function loadComposerDraft(draftKey, { storage } = {}) {
  const key = composerDraftStorageKey(draftKey);
  const resolvedStorage = resolveStorage(storage);
  if (!key || !resolvedStorage) return null;
  try {
    return resolvedStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveComposerDraft(draftKey, text, { storage } = {}) {
  const key = composerDraftStorageKey(draftKey);
  const resolvedStorage = resolveStorage(storage);
  if (!key || !resolvedStorage) return;
  try {
    resolvedStorage.setItem(key, String(text || ''));
  } catch {
    // Draft persistence is best-effort; caller still owns visible state.
  }
}

export function clearComposerDraft(draftKey, { storage } = {}) {
  const key = composerDraftStorageKey(draftKey);
  const resolvedStorage = resolveStorage(storage);
  if (!key || !resolvedStorage) return;
  try {
    resolvedStorage.removeItem(key);
  } catch {
    // Ignore storage failures. User-visible submit/discard should continue.
  }
}

export function shouldEnableComposerSubmit({
  text = '',
  attachments = [],
  requireText = true,
  busy = false,
} = {}) {
  if (busy) return false;
  if ((attachments || []).some(attachment => attachment?.status === 'pending_compression' || attachment?.status === 'failed')) {
    return false;
  }
  if (!requireText) return true;
  return String(text || '').trim().length > 0;
}

export function appendComposerText(currentText = '', nextText = '') {
  const current = String(currentText || '').trim();
  const next = String(nextText || '').trim();
  if (!next) return currentText || '';
  if (!current) return next;
  if (current.includes(next)) return currentText;
  return `${current}\n\n${next}`;
}

export async function submitCaptureComposerDraft({
  text = '',
  attachments = [],
  draftKey = '',
  onSubmit,
  storage,
  clearDraft = true,
} = {}) {
  if (typeof onSubmit !== 'function') {
    throw new Error('Capture Composer submit adapter is not configured.');
  }
  const result = await onSubmit({ text: String(text || ''), attachments });
  if (clearDraft) clearComposerDraft(draftKey, { storage });
  return result;
}
