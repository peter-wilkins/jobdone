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
      const parts = request.parts();
      let audioBuffer = null;
      let fileName = 'audio.webm';

      // Iterate through form parts
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'audio') {
          fileName = part.filename;
          const chunks = [];
          
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          
          audioBuffer = Buffer.concat(chunks);
          console.log(`[Transcribe] Received audio file: ${fileName}, size: ${audioBuffer.length} bytes`);
        }
      }

      if (!audioBuffer || audioBuffer.length === 0) {
        console.error('[Transcribe] No audio buffer or empty buffer');
        return reply.status(400).send({ error: 'No audio file provided or file is empty' });
      }

      // Validate
      validateAudioBuffer(audioBuffer);

      // Transcribe
      console.log('[Transcribe] Starting Whisper transcription...');
      const { transcript } = await transcribeAudio(audioBuffer);
      console.log('[Transcribe] Transcription complete');

      // Summarize and extract
      console.log('[Transcribe] Starting Claude summarization...');
      const result = await summarizeAndExtract(transcript);
      console.log('[Transcribe] Summarization complete');

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
