import { optionalAuth } from '../services/auth.js';
import { saveTranscriptionEvaluation } from '../services/database.js';

function cleanDeviceId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 160) return null;
  return id;
}

export async function registerTranscriptionEvaluationRoutes(fastify, deps = {}) {
  const auth = deps.optionalAuth ?? optionalAuth;
  const saveEvaluation = deps.saveTranscriptionEvaluation ?? saveTranscriptionEvaluation;

  fastify.post('/api/transcription-evaluations', async (request, reply) => {
    const user = await auth(request, reply);
    if (reply.sent) return;

    try {
      const body = request.body || {};
      const anonymousDeviceId = cleanDeviceId(body.anonymous_device_id);
      if (!user?.id && !anonymousDeviceId) {
        return reply.status(400).send({ error: 'anonymous_device_id required' });
      }

      const evaluation = await saveEvaluation({
        userId: user?.id || null,
        anonymousDeviceId,
      }, body);

      return { success: true, evaluation };
    } catch (error) {
      console.error('Transcription evaluation save error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to save transcription evaluation' });
    }
  });
}
