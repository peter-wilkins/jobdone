import { transcribeAudio, validateAudioBuffer } from '../services/transcription.js';
import { summarizeAndExtract } from '../services/summarization.js';

/**
 * Register audio processing routes
 */
export async function registerAudioRoutes(fastify) {
  /**
   * Health check
   */
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  /**
   * POST /api/transcribe
   * Transcribe and summarize audio
   *
   * Expects multipart form data:
   * - audio: audio file blob
   *
   * Returns:
   * {
   *   transcript: string,
   *   summary: string,
   *   materials: string[],
   *   labour_minutes: number | null,
   *   follow_ups: string[],
   *   possible_future_work: string
   * }
   */
  fastify.post('/api/transcribe', async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({ error: 'No audio file provided' });
      }

      // Read file buffer
      const chunks = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);

      // Validate
      validateAudioBuffer(audioBuffer);

      // Transcribe
      const { transcript } = await transcribeAudio(audioBuffer, data.mimetype);

      // Summarize and extract
      const result = await summarizeAndExtract(transcript);

      return {
        transcript,
        summary: result.summary,
        materials: result.materials,
        labour_minutes: result.labour_minutes,
        follow_ups: result.follow_ups,
        possible_future_work: result.possible_future_work,
      };
    } catch (error) {
      console.error('Transcription endpoint error:', error);
      return reply.status(500).send({
        error: error.message || 'Failed to process audio',
      });
    }
  });

  /**
   * POST /api/summarize
   * Summarize and extract from existing transcript
   *
   * Expects JSON:
   * { transcript: string }
   *
   * Returns: same as /api/transcribe but without transcript field
   */
  fastify.post('/api/summarize', async (request, reply) => {
    try {
      const { transcript } = request.body;

      if (!transcript || typeof transcript !== 'string') {
        return reply.status(400).send({ error: 'transcript field required' });
      }

      const result = await summarizeAndExtract(transcript);

      return {
        summary: result.summary,
        materials: result.materials,
        labour_minutes: result.labour_minutes,
        follow_ups: result.follow_ups,
        possible_future_work: result.possible_future_work,
      };
    } catch (error) {
      console.error('Summarization endpoint error:', error);
      return reply.status(500).send({
        error: error.message || 'Failed to summarize transcript',
      });
    }
  });
}
