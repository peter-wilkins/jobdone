import { transcribeAudio, validateAudioBuffer } from '../services/transcription.js';
import { summarizeAndExtract } from '../services/summarization.js';
import { classify } from '../services/classify.js';

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
   * Transcribe, classify intent, and (if NOTE) summarize
   *
   * Expects multipart form data:
   * - audio: audio file blob
   *
   * Returns:
   * {
   *   transcript: string,
   *   intent: 'QUERY' | 'NOTE',
   *   summary?: string               // Only if intent='NOTE'
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
      console.log('[Transcribe] Starting Deepgram transcription...');
      const { transcript } = await transcribeAudio(audioBuffer);
      console.log('[Transcribe] Transcription complete');

      // Classify intent (QUERY or NOTE)
      console.log('[Transcribe] Classifying intent...');
      const intent = classify(transcript);
      console.log(`[Transcribe] Intent: ${intent}`);

      // If NOTE, summarize
      const response = { transcript, intent };
      
      if (intent === 'NOTE') {
        console.log('[Transcribe] Starting Claude summarization...');
        const result = await summarizeAndExtract(transcript);
        console.log('[Transcribe] Summarization complete');
        
        response.summary = result.summary;
      }

      return response;
    } catch (error) {
      console.error('Transcription endpoint error:', error);
      return reply.status(500).send({
        error: error.message || 'Failed to process audio',
      });
    }
  });

  /**
   * POST /api/summarize
   * Classify intent and (if NOTE) summarize from transcript
   *
   * Expects JSON:
   * { transcript: string }
   *
   * Returns:
   * {
   *   intent: 'QUERY' | 'NOTE',
   *   summary?: string               // Only if intent='NOTE'
   * }
   */
  fastify.post('/api/summarize', async (request, reply) => {
    try {
      const { transcript } = request.body;

      if (!transcript || typeof transcript !== 'string') {
        return reply.status(400).send({ error: 'transcript field required' });
      }

      // Classify intent
      const intent = classify(transcript);

      const response = { intent };

      // If NOTE, summarize
      if (intent === 'NOTE') {
        const result = await summarizeAndExtract(transcript);
        response.summary = result.summary;
      }

      return response;
    } catch (error) {
      console.error('Summarization endpoint error:', error);
      return reply.status(500).send({
        error: error.message || 'Failed to summarize transcript',
      });
    }
  });
}
