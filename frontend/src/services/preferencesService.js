const FAST_CAPTURE_KEY = 'jobdone.fastCapture';

export const preferencesService = {
  isFastCaptureEnabled() {
    return window.localStorage.getItem(FAST_CAPTURE_KEY) === 'true';
  },

  setFastCaptureEnabled(enabled) {
    window.localStorage.setItem(FAST_CAPTURE_KEY, enabled ? 'true' : 'false');
  },
};
