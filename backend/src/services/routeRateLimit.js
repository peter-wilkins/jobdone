import { createHash } from 'node:crypto';

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_REQUESTS = 20;
const DEFAULT_MAX_AUDIO_REQUESTS = 10;
const buckets = new Map();

function normalizePart(value) {
  return String(value || 'unknown').slice(0, 160);
}

export function routeAbuseKeyFromRequest(request, routeType) {
  const raw = [
    normalizePart(request.ip || request.headers['x-forwarded-for']?.split(',')[0]?.trim()),
    normalizePart(request.headers['user-agent']),
    normalizePart(routeType),
  ].join('|');

  return createHash('sha256').update(raw).digest('hex');
}

export function checkRouteRateLimit(key, {
  now = Date.now(),
  windowMs = DEFAULT_WINDOW_MS,
  maxRequests = DEFAULT_MAX_REQUESTS,
} = {}) {
  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  return {
    allowed: bucket.count <= maxRequests,
    remaining: Math.max(0, maxRequests - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function checkCostlyRouteRateLimit(request, {
  routeType,
  now,
  maxRequests,
} = {}) {
  const key = routeAbuseKeyFromRequest(request, routeType);
  return checkRouteRateLimit(key, {
    now,
    maxRequests: maxRequests ?? (routeType === 'transcribe' ? DEFAULT_MAX_AUDIO_REQUESTS : DEFAULT_MAX_REQUESTS),
  });
}

export function sendRateLimitReply(reply, limit) {
  reply.header('retry-after', String(limit.retryAfterSeconds));
  return reply.status(429).send({
    error: 'Too many requests',
    retry_after_seconds: limit.retryAfterSeconds,
  });
}

export function resetRouteRateLimitsForTests() {
  buckets.clear();
}
