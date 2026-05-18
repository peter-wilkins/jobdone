import { saveFeedback, getFeedback } from '../services/database.js';
import { requireAuth } from '../services/auth.js';

export async function registerFeedbackRoutes(fastify, deps = {}) {
  const auth = deps.requireAuth || requireAuth;
  const save = deps.saveFeedback || saveFeedback;
  const get = deps.getFeedback || getFeedback;
  /**
   * POST /api/feedback/save
   */
  fastify.post('/api/feedback/save', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    try {
      const { transcript, created_at, diagnostic_bundle } = request.body;

      if (!transcript) {
        return reply.status(400).send({ error: 'transcript required' });
      }

      const saved = await save(user.id, { transcript, created_at, diagnostic_bundle });

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
