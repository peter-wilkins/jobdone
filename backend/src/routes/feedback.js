import { saveFeedback, getFeedback } from '../services/database.js';
import { requireAuth } from '../services/auth.js';

export async function registerFeedbackRoutes(fastify) {
  /**
   * POST /api/feedback/save
   */
  fastify.post('/api/feedback/save', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    try {
      const { transcript, created_at } = request.body;

      if (!transcript) {
        return reply.status(400).send({ error: 'transcript required' });
      }

      const saved = await saveFeedback(user.id, { transcript, created_at });

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
    const user = await requireAuth(request, reply);
    if (!user) return;

    try {
      const items = await getFeedback(user.id);
      return { success: true, feedback: items };
    } catch (error) {
      console.error('Feedback fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch feedback' });
    }
  });
}
