const DEFAULT_ALLOWED_ORIGINS = [
  'https://jobdone-staging.vercel.app',
  'https://jobdone.continuumkit.org',
  'https://jobdone-frontend-staging.vercel.app',
  'https://jobdone-frontend-production.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
];

function normalizeOrigin(origin) {
  return String(origin || '').trim().replace(/\/+$/, '');
}

export function parseAllowedOrigins(value = process.env.CORS_ALLOWED_ORIGINS) {
  const configured = String(value || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

export function isAllowedCorsOrigin(origin, allowedOrigins = parseAllowedOrigins()) {
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.has(normalized)) return true;

  try {
    const url = new URL(normalized);
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

export function createCorsOriginValidator(allowedOrigins = parseAllowedOrigins()) {
  return (origin, callback) => {
    callback(null, isAllowedCorsOrigin(origin, allowedOrigins));
  };
}
