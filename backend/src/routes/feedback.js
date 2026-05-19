import { saveFeedback, getFeedback } from '../services/database.js';
import { optionalAuth, requireAuth } from '../services/auth.js';
import { checkAnonymousFeedbackRateLimit } from '../services/feedbackRateLimit.js';

function sanitizeAnonymousDeviceId(value) {
  const text = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{12,80}$/.test(text) ? text : null;
}

function hasDataLossSignal(body = {}) {
  const value = body.data_loss ?? body.dataLoss ?? body.diagnostic_bundle?.feedback?.data_loss;
  return value === true || value === 'yes';
}

export async function registerFeedbackRoutes(fastify, deps = {}) {
  const auth = deps.requireAuth || requireAuth;
  const optional = deps.optionalAuth || optionalAuth;
  const save = deps.saveFeedback || saveFeedback;
  const get = deps.getFeedback || getFeedback;
  const rateLimit = deps.checkAnonymousFeedbackRateLimit || checkAnonymousFeedbackRateLimit;
  /**
   * POST /api/feedback/save
   */
  fastify.post('/api/feedback/save', async (request, reply) => {
    try {
      const user = await optional(request, reply);
      if (reply.sent) return;

      const {
        transcript,
        created_at,
        diagnostic_bundle,
        anonymous_device_id,
      } = request.body || {};

      if (!transcript) {
        return reply.status(400).send({ error: 'transcript required' });
      }

      const identityClass = user ? 'signed_in' : 'anonymous';
      const anonymousDeviceId = user ? null : sanitizeAnonymousDeviceId(anonymous_device_id);
      let abuseKeyHash = null;

      if (!user) {
        const limit = rateLimit(request, {
          diagnosticBundle: diagnostic_bundle || {},
          dataLoss: hasDataLossSignal(request.body),
        });
        abuseKeyHash = limit.abuseKeyHash;

        if (!limit.allowed) {
          return reply
            .status(429)
            .header('retry-after', Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)))
            .send({ error: 'Too many anonymous feedback reports. Try again later.' });
        }
      }

      const saved = await save(user?.id || null, {
        transcript,
        created_at,
        diagnostic_bundle,
        identity_class: identityClass,
        anonymous_device_id: anonymousDeviceId,
        abuse_key_hash: abuseKeyHash,
      });

      return { success: true, feedback: saved };
    } catch (error) {
      console.error('Feedback save error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to save feedback' });
    }
  });

  /**
   * GET /api/feedback
   */
  fastify.get('/api/feedback', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const items = await get(user.id);
      return { success: true, feedback: items };
    } catch (error) {
      console.error('Feedback fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch feedback' });
    }
  });
}
