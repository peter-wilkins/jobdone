const STORAGE_KEY = 'jobdone-feedback-device-id';
const ID_PATTERN = /^[a-zA-Z0-9_-]{12,80}$/;

function randomBytes(length = 16) {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes);
  }
  return Array.from({ length }, () => Math.floor(Math.random() * 256));
}

function encodeId(bytes) {
  return bytes.map(byte => byte.toString(36).padStart(2, '0')).join('').slice(0, 48);
}

export function createFeedbackDeviceId() {
  return `fbd_${encodeId(randomBytes())}`;
}

export function isValidFeedbackDeviceId(value) {
  return ID_PATTERN.test(String(value || ''));
}

export function getFeedbackDeviceId() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (isValidFeedbackDeviceId(existing)) return existing;

    const next = createFeedbackDeviceId();
    localStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    return createFeedbackDeviceId();
  }
}

export function resetFeedbackDeviceIdForTests() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Test-only helper; no-op when storage is unavailable.
  }
}
