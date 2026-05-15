import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';

/**
 * Transcribe audio blob using Whisper API
 * @param {Buffer} audioBuffer - Audio file buffer
 * @returns {Promise<{transcript: string, language: string}>}
 */
export async function transcribeAudio(audioBuffer) {
  try {
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Audio buffer is empty');
    }

    console.log('[Whisper] Buffer size:', audioBuffer.length, 'bytes');

    // Create a temporary file
    const tempFile = `/tmp/audio-${Date.now()}-${Math.random().toString(36).slice(2)}.webm`;
    fs.writeFileSync(tempFile, audioBuffer);
    console.log('[Whisper] Temp file created:', tempFile);

    try {
      const stat = fs.statSync(tempFile);
      console.log('[Whisper] Temp file size:', stat.size, 'bytes');

      // Create FormData for Whisper API
      const form = new FormData();
      form.append('file', fs.createReadStream(tempFile));
      form.append('model', 'whisper-1');
      form.append('language', 'en');

      console.log('[Whisper] Calling OpenAI API...');
      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          timeout: 120000, // 2 minutes for large files
        }
      );

      console.log('[Whisper] Transcription received');

      return {
        transcript: response.data.text,
        language: 'en',
      };
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
        console.log('[Whisper] Temp file cleaned up');
      }
    }
  } catch (error) {
    console.error('Transcription error:', error.response?.data || error.message);
    throw new Error(`Failed to transcribe audio: ${error.response?.data?.error?.message || error.message}`);
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
