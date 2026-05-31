import { createHash } from 'node:crypto';

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_REQUESTS = 8;
const DEFAULT_MAX_DATA_LOSS_REQUESTS = 20;
const buckets = new Map();

function normalizePart(value) {
  return String(value || 'unknown').slice(0, 160);
}

export function hashFeedbackAbuseKey({ ip, userAgent, routeType, buildId }) {
  const raw = [
    normalizePart(ip),
    normalizePart(userAgent),
    normalizePart(routeType),
    normalizePart(buildId),
  ].join('|');

  return createHash('sha256').update(raw).digest('hex');
}

export function feedbackAbuseKeyFromRequest(request, diagnosticBundle = {}) {
  return hashFeedbackAbuseKey({
    ip: request.ip || request.headers['x-forwarded-for']?.split(',')[0]?.trim(),
    userAgent: request.headers['user-agent'],
    routeType: diagnosticBundle.route?.screen || diagnosticBundle.route?.path || 'unknown',
    buildId: diagnosticBundle.build_id || 'unknown',
  });
}

export function checkFeedbackRateLimit(key, {
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
  };
}

export function checkAnonymousFeedbackRateLimit(request, {
  diagnosticBundle = {},
  dataLoss = false,
  now,
} = {}) {
  const abuseKeyHash = feedbackAbuseKeyFromRequest(request, diagnosticBundle);
  const limit = checkFeedbackRateLimit(abuseKeyHash, {
    now,
    maxRequests: dataLoss ? DEFAULT_MAX_DATA_LOSS_REQUESTS : DEFAULT_MAX_REQUESTS,
  });

  return { ...limit, abuseKeyHash };
}

export function resetFeedbackRateLimitsForTests() {
  buckets.clear();
}
