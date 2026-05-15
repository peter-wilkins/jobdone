/**
 * Audio recording service using Web Audio API
 * Handles recording, blob creation, and audio metadata
 */

export class AudioService {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.startTime = null;
    this.stream = null;
  }

  /**
   * Start recording audio from microphone
   */
  async startRecording() {
    try {
      if (this.isRecording) {
        console.warn('Already recording');
        return;
      }

      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.mediaRecorder.ondataavailable = (e) => {
        this.audioChunks.push(e.data);
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.startTime = Date.now();

      return true;
    } catch (error) {
      console.error('Microphone access denied:', error);
      throw new Error('Microphone access denied. Please check your browser permissions.');
    }
  }

  /**
   * Stop recording and return audio blob + metadata
   */
  async stopRecording() {
    if (!this.isRecording) {
      console.warn('Not recording');
      return null;
    }

    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm;codecs=opus' });
        const duration = Math.floor((Date.now() - this.startTime) / 1000);

        // Stop all tracks to release microphone
        this.stream.getTracks().forEach(track => track.stop());

        this.isRecording = false;
        this.audioChunks = [];
        this.startTime = null;

        resolve({
          blob: audioBlob,
          duration,
          mimeType: 'audio/webm;codecs=opus',
          size: audioBlob.size,
        });
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Cancel recording without saving
   */
  cancelRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.stream.getTracks().forEach(track => track.stop());
      this.isRecording = false;
      this.audioChunks = [];
      this.startTime = null;
    }
  }

  /**
   * Get current recording status
   */
  getStatus() {
    return {
      isRecording: this.isRecording,
      elapsedSeconds: this.isRecording ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
    };
  }
}

// Singleton instance
export const audioService = new AudioService();
