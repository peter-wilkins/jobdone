const ENV = import.meta.env || {};

const DEFAULT_DEBUG_EMAILS = [
  'poppetew@gmail.com',
  'peter.wilkins2@protonmail.com',
];

function configuredDebugEmails() {
  return String(ENV.VITE_DEBUG_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isDebugEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  return new Set([...DEFAULT_DEBUG_EMAILS, ...configuredDebugEmails()]).has(normalized);
}

export function debugApiDetailsEnabledForUser(user) {
  return true;
}
