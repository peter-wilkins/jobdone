import { saveFeedback, getFeedback } from '../services/database.js';

/**
 * Register feedback routes
 */
export async function registerFeedbackRoutes(fastify) {
  /**
   * POST /api/feedback/save
   * Save a confirmed feedback note to cloud
   *
   * Expects JSON:
   * { userId: string, transcript: string, created_at: ISO string }
   */
  fastify.post('/api/feedback/save', async (request, reply) => {
    try {
      const { userId, transcript, created_at } = request.body;

      if (!userId || !transcript) {
        return reply.status(400).send({ error: 'userId and transcript required' });
      }

      const saved = await saveFeedback(userId, { transcript, created_at });

      return { success: true, feedback: saved };
    } catch (error) {
      console.error('Feedback save error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to save feedback' });
    }
  });

  /**
   * GET /api/feedback/:userId
   * Fetch all feedback for a user
   */
  fastify.get('/api/feedback/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;

      const items = await getFeedback(userId);

      return { success: true, feedback: items };
    } catch (error) {
      console.error('Feedback fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch feedback' });
    }
  });
}
