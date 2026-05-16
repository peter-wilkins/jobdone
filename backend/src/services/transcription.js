import { Deepgram } from '@deepgram/sdk';
import { mockTranscribeAudio } from './mocks.js';

const USE_MOCK = process.env.USE_MOCK_APIS === 'true';

/**
 * Transcribe audio blob using Deepgram API
 * @param {Buffer} audioBuffer - Audio file buffer
 * @returns {Promise<{transcript: string, language: string}>}
 */
export async function transcribeAudio(audioBuffer) {
  try {
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Audio buffer is empty');
    }

    // Use mock if enabled
    if (USE_MOCK) {
      return await mockTranscribeAudio();
    }

    console.log('[Deepgram] Buffer size:', audioBuffer.length, 'bytes');

    const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);

    const response = await deepgram.transcription.preRecorded(
      { buffer: audioBuffer, mimetype: 'audio/webm' },
      {
        model: 'nova-3',
        language: 'en',
        smart_format: true,
      }
    );

    const transcript = response.results?.channels?.[0]?.alternatives?.[0]?.transcript;

    if (!transcript) {
      throw new Error('Deepgram returned empty transcription');
    }

    console.log('[Deepgram] Transcription complete');

    return {
      transcript,
      language: 'en',
    };
  } catch (error) {
    console.error('Transcription error:', error.message);
    throw new Error(`Failed to transcribe audio: ${error.message}`);
  }
}

/**
 * Validate audio buffer is not empty
 */
export function validateAudioBuffer(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Audio buffer is empty');
  }
  return true;
}
