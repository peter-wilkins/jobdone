import axios from 'axios';
import { mockTranscribeAudio } from './mocks.js';

const USE_MOCK = process.env.USE_MOCK_APIS === 'true';

/**
 * Transcribe audio blob using Deepgram API (nova-3)
 * @param {Buffer} audioBuffer - Audio file buffer
 * @returns {Promise<{transcript: string, language: string}>}
 */
export async function transcribeAudio(audioBuffer) {
  try {
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Audio buffer is empty');
    }

    if (USE_MOCK) {
      return await mockTranscribeAudio();
    }

    console.log('[Deepgram] Buffer size:', audioBuffer.length, 'bytes');

    const response = await axios.post(
      'https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true',
      audioBuffer,
      {
        headers: {
          'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'audio/webm',
        },
        timeout: 120000,
      }
    );

    const transcript = response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;

    if (!transcript) {
      throw new Error('Deepgram returned empty transcription');
    }

    console.log('[Deepgram] Transcription complete');

    return {
      transcript,
      language: 'en',
    };
  } catch (error) {
    const msg = error.response?.data || error.message;
    console.error('Transcription error:', msg);
    throw new Error(`Failed to transcribe audio: ${msg}`);
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
