import { saveFeedback, getFeedback } from '../services/database.js';
import { optionalAuth, requireAuth } from '../services/auth.js';
import { checkAnonymousFeedbackRateLimit } from '../services/feedbackRateLimit.js';

const MAX_CRASH_STACK_CHARS = 3000;
const MAX_CRASH_MESSAGE_CHARS = 300;

function sanitizeAnonymousDeviceId(value) {
  const text = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{12,80}$/.test(text) ? text : null;
}

function hasDataLossSignal(body = {}) {
  const value = body.data_loss ?? body.dataLoss ?? body.diagnostic_bundle?.feedback?.data_loss;
  return value === true || value === 'yes';
}

function compactString(value, limit) {
  return String(value || '').slice(0, limit);
}

function sanitizeCrashReport(value = {}) {
  const error = value.error || {};
  return {
    crash_id: compactString(value.crash_id, 80),
    signature: compactString(value.signature, 160),
    captured_at: compactString(value.captured_at, 40),
    source: compactString(value.source || 'runtime', 40),
    build_id: compactString(value.build_id, 120),
    route: {
      path: compactString(value.route?.path, 160),
      hash: compactString(value.route?.hash, 160),
      screen: compactString(value.route?.screen, 80),
    },
    error: {
      name: compactString(error.name || 'Error', 120),
      message: compactString(error.message || 'Unknown crash', MAX_CRASH_MESSAGE_CHARS),
      stack: compactString(error.stack, MAX_CRASH_STACK_CHARS),
    },
    recent_request_ids: Array.isArray(value.recent_request_ids)
      ? value.recent_request_ids.map(item => compactString(item, 80)).slice(-10)
      : [],
  };
}

function crashTranscript(crashReport) {
  const name = crashReport.error?.name || 'Error';
  const message = crashReport.error?.message || 'Unknown crash';
  return `Crash report: ${name}: ${message}`.slice(0, 500);
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
   * POST /api/crash-reports
   */
  fastify.post('/api/crash-reports', async (request, reply) => {
    try {
      const user = await optional(request, reply);
      if (reply.sent) return;

      const {
        crash_report,
        diagnostic_bundle,
        anonymous_device_id,
      } = request.body || {};

      const crashReport = sanitizeCrashReport(crash_report || {});
      if (!crashReport.signature || !crashReport.error.message) {
        return reply.status(400).send({ error: 'crash_report required' });
      }

      const identityClass = user ? 'signed_in' : 'anonymous';
      const anonymousDeviceId = user ? null : sanitizeAnonymousDeviceId(anonymous_device_id);
      let abuseKeyHash = null;

      if (!user) {
        const limit = rateLimit(request, {
          diagnosticBundle: {
            ...(diagnostic_bundle || {}),
            route: { screen: 'crash_report' },
            crash_signature: crashReport.signature,
          },
          dataLoss: false,
        });
        abuseKeyHash = limit.abuseKeyHash;

        if (!limit.allowed) {
          return reply
            .status(429)
            .header('retry-after', Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)))
            .send({ error: 'Too many crash reports. Try again later.' });
        }
      }

      const saved = await save(user?.id || null, {
        transcript: crashTranscript(crashReport),
        created_at: crashReport.captured_at || new Date().toISOString(),
        diagnostic_bundle: {
          ...(diagnostic_bundle || {}),
          report_type: 'crash_report',
          crash_report: crashReport,
        },
        identity_class: identityClass,
        anonymous_device_id: anonymousDeviceId,
        abuse_key_hash: abuseKeyHash,
      });

      return { success: true, crash_report: saved };
    } catch (error) {
      console.error('Crash report save error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to save crash report' });
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
