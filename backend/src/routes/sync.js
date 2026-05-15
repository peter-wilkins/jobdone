import { saveJob, getJobs } from '../services/database.js';

/**
 * Register sync routes
 */
export async function registerSyncRoutes(fastify) {
  /**
   * POST /api/sync/save
   * Save a confirmed job to cloud
   *
   * Expects JSON:
   * {
   *   userId: string,
   *   jobData: {
   *     transcript: string,
   *     summary: string,
   *     materials: string[],
   *     labour_minutes: number | null,
   *     follow_ups: string[],
   *     possible_future_work: string,
   *     created_at: ISO string
   *   }
   * }
   */
  fastify.post('/api/sync/save', async (request, reply) => {
    try {
      const { userId, jobData } = request.body;

      if (!userId || !jobData) {
        return reply.status(400).send({
          error: 'userId and jobData required',
        });
      }

      const saved = await saveJob(userId, jobData);

      return {
        success: true,
        job: saved,
      };
    } catch (error) {
      console.error('Sync save error:', error);
      return reply.status(500).send({
        error: error.message || 'Failed to save job',
      });
    }
  });

  /**
   * GET /api/sync/jobs/:userId
   * Fetch all jobs for a user
   */
  fastify.get('/api/sync/jobs/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;

      if (!userId) {
        return reply.status(400).send({
          error: 'userId required',
        });
      }

      const jobs = await getJobs(userId);

      return {
        success: true,
        jobs,
      };
    } catch (error) {
      console.error('Sync fetch error:', error);
      return reply.status(500).send({
        error: error.message || 'Failed to fetch jobs',
      });
    }
  });
}
