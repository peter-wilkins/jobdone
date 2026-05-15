/**
 * API service for communicating with JobDone backend
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export class APIService {
  /**
   * Check if backend is available
   */
  async checkHealth() {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      return response.ok;
    } catch (error) {
      console.warn('Backend health check failed:', error);
      return false;
    }
  }

  /**
   * Upload audio blob and get transcription + summary
   * @param {Blob} audioBlob - Audio file blob
   * @returns {Promise<{transcript: string, summary: string, materials: string[], labour_minutes: number|null, follow_ups: string[], possible_future_work: string}>}
   */
  async transcribeAudio(audioBlob) {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const response = await fetch(`${API_BASE_URL}/api/transcribe`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Transcription failed');
      }

      return await response.json();
    } catch (error) {
      console.error('Transcription error:', error);
      throw error;
    }
  }

  /**
   * Summarize an existing transcript
   * @param {string} transcript - Transcript text
   * @returns {Promise<{summary: string, materials: string[], labour_minutes: number|null, follow_ups: string[], possible_future_work: string}>}
   */
  async summarizeTranscript(transcript) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcript }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Summarization failed');
      }

      return await response.json();
    } catch (error) {
      console.error('Summarization error:', error);
      throw error;
    }
  }
}

// Singleton instance
export const apiService = new APIService();
