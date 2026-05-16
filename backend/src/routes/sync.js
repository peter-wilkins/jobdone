import { saveJob, getJobs } from '../services/database.js';
import { requireAuth } from '../services/auth.js';

export async function registerSyncRoutes(fastify) {
  /**
   * POST /api/sync/save
   * Save a confirmed job to cloud.
   * userId is taken from the validated JWT — not from the request body.
   */
  fastify.post('/api/sync/save', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    try {
      const { jobData } = request.body;

      if (!jobData) {
        return reply.status(400).send({ error: 'jobData required' });
      }

      const saved = await saveJob(user.id, jobData);

      return { success: true, job: saved };
    } catch (error) {
      console.error('Sync save error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to save job' });
    }
  });

  /**
   * GET /api/sync/jobs
   * Fetch all jobs for the authenticated user.
   */
  fastify.get('/api/sync/jobs', async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    try {
      const jobs = await getJobs(user.id);
      return { success: true, jobs };
    } catch (error) {
      console.error('Sync fetch error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch jobs' });
    }
  });
}
