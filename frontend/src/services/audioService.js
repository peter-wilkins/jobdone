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
   * Check microphone permission status
   * Returns: 'granted' | 'denied' | 'prompt' | 'unknown'
   */
  async checkPermission() {
    try {
      if (!navigator.permissions || !navigator.permissions.query) {
        // Fallback for browsers without Permissions API
        return 'unknown';
      }

      const status = await navigator.permissions.query({ name: 'microphone' });
      return status.state; // 'granted', 'denied', or 'prompt'
    } catch (error) {
      console.warn('Could not check microphone permission:', error);
      return 'unknown';
    }
  }

  /**
   * Request microphone access explicitly
   * Throws error if denied, returns true if granted
   */
  async requestMicrophoneAccess() {
    try {
      const permission = await this.checkPermission();

      if (permission === 'denied') {
        throw new Error(
          'Microphone access has been denied. Please go to your browser settings and enable microphone access for this site, then refresh the page.'
        );
      }

      // Try to get access (will prompt user if permission status is 'prompt')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Stop the stream since we're just checking permission
      stream.getTracks().forEach(track => track.stop());

      return true;
    } catch (error) {
      throw this.formatMicrophoneError(error);
    }
  }

  formatMicrophoneError(error) {
    if (error.name === 'NotAllowedError' || error.message.includes('denied')) {
      return new Error(
        'Microphone access was denied. Please enable microphone access in your browser settings and try again.',
        { cause: error }
      );
    } else if (error.name === 'NotFoundError') {
      return new Error('No microphone found on this device.', { cause: error });
    } else if (error.name === 'NotSupportedError') {
      return new Error('Microphone access is not supported in your browser.', { cause: error });
    } else if (error.name === 'SecurityError') {
      return new Error(
        'Microphone access is only available over HTTPS. Please use a secure connection.',
        { cause: error }
      );
    }
    return new Error(`Microphone access error: ${error.message}`, { cause: error });
  }

  /**
   * Start recording audio from microphone
   * Automatically requests permission if needed
   */
  async startRecording() {
    try {
      if (this.isRecording) {
        console.warn('Already recording');
        return;
      }

      const permission = await this.checkPermission();
      if (permission === 'denied') {
        throw new Error(
          'Microphone access has been denied. Please go to your browser settings and enable microphone access for this site, then refresh the page.'
        );
      }

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
      console.error('Recording error:', error);
      throw this.formatMicrophoneError(error);
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
    const elapsedMs = this.isRecording ? Date.now() - this.startTime : 0;
    return {
      isRecording: this.isRecording,
      elapsedMs,
      elapsedSeconds: Math.floor(elapsedMs / 1000),
    };
  }
}

// Singleton instance
export const audioService = new AudioService();
