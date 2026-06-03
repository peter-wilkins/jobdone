import { EmptyTranscriptionError, transcribeAudio, validateAudioBuffer } from '../services/transcription.js';
import { summarizeAndExtract } from '../services/summarization.js';
import { classify } from '../services/classify.js';
import { checkCostlyRouteRateLimit, sendRateLimitReply } from '../services/routeRateLimit.js';

function parseCaptureContext(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/**
 * Register audio processing routes
 */
export async function registerAudioRoutes(fastify, deps = {}) {
  const transcriber = deps.transcribeAudio ?? transcribeAudio;
  const summarizer = deps.summarizeAndExtract ?? summarizeAndExtract;
  const classifier = deps.classify ?? classify;
  const rateLimit = deps.checkCostlyRouteRateLimit ?? checkCostlyRouteRateLimit;

  /**
   * Health check
   */
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  /**
   * POST /api/transcribe
   * Transcribe and classify intent. Notes keep raw transcript text until review cleanup.
   *
   * Expects multipart form data:
   * - audio: audio file blob
   *
   * Returns:
   * {
   *   transcript: string,
   *   intent: 'QUERY' | 'NOTE',
   *   summary?: string               // For NOTE, initially the raw transcript
   * }
   */
  fastify.post('/api/transcribe', async (request, reply) => {
    try {
      const limit = rateLimit(request, { routeType: 'transcribe' });
      if (!limit.allowed) return sendRateLimitReply(reply, limit);

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
      const { transcript } = await transcriber(audioBuffer);
      console.log('[Transcribe] Transcription complete');

      // Classify intent (QUERY or NOTE)
      console.log('[Transcribe] Classifying intent...');
      const intent = classifier(transcript);
      console.log(`[Transcribe] Intent: ${intent}`);

      const response = { transcript, intent };

      if (intent === 'NOTE') {
        response.summary = transcript;
      }

      return response;
    } catch (error) {
      if (error instanceof EmptyTranscriptionError || error.code === 'empty_transcription') {
        request.log.info({ code: 'empty_transcription' }, 'No speech detected in uploaded audio');
        return reply.status(422).send({
          code: 'empty_transcription',
          error: 'No speech detected',
        });
      }
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
      const limit = rateLimit(request, { routeType: 'summarize' });
      if (!limit.allowed) return sendRateLimitReply(reply, limit);

      const { transcript, captureContext } = request.body;

      if (!transcript || typeof transcript !== 'string') {
        return reply.status(400).send({ error: 'transcript field required' });
      }

      // Classify intent
      const intent = classifier(transcript);

      const response = { intent };

      // If NOTE, summarize
      if (intent === 'NOTE') {
        const result = await summarizer(transcript, { captureContext: parseCaptureContext(captureContext) });
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
