import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Transcribe audio blob using Whisper
 * @param {Buffer} audioBuffer - Audio file buffer
 * @param {string} mimeType - Audio MIME type (e.g., 'audio/webm')
 * @returns {Promise<{transcript: string, language: string}>}
 */
export async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  try {
    // Create a temporary file since OpenAI SDK expects a file
    const tempFile = `/tmp/audio-${Date.now()}.webm`;
    fs.writeFileSync(tempFile, audioBuffer);

    try {
      const transcript = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFile),
        model: 'whisper-1',
        language: 'en', // Adjust for your plumbers' location
      });

      return {
        transcript: transcript.text,
        language: 'en',
      };
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  } catch (error) {
    console.error('Transcription error:', error);
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
