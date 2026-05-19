const GEOLOCATION_TIMEOUT_MS = 6000;

function geolocationAvailable() {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

async function geolocationPermissionState() {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';

  try {
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return result.state || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: GEOLOCATION_TIMEOUT_MS,
      maximumAge: 60_000,
    });
  });
}

function positionToContextClue(position, { permissionState, promptRequested }) {
  const { coords } = position;
  const capturedAt = new Date().toISOString();

  return {
    kind: 'device_location',
    source: 'device_location',
    summary: 'Current location at capture time',
    payload: {
      locationText: 'Current location',
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy ?? null,
      capturedAt,
    },
    confidence: 0.55,
    metadata: {
      permissionState,
      promptRequested,
    },
    created_at: capturedAt,
  };
}

export const locationClueService = {
  async getPermissionState() {
    if (!geolocationAvailable()) return 'unsupported';
    return geolocationPermissionState();
  },

  async captureCurrentLocation({ allowPrompt = false } = {}) {
    if (!geolocationAvailable()) {
      return { ok: false, reason: 'unsupported' };
    }

    const permissionState = await geolocationPermissionState();
    if (!allowPrompt && permissionState !== 'granted') {
      return { ok: false, reason: permissionState };
    }

    try {
      const position = await getCurrentPosition();
      return {
        ok: true,
        clue: positionToContextClue(position, {
          permissionState,
          promptRequested: allowPrompt && permissionState !== 'granted',
        }),
      };
    } catch (error) {
      return {
        ok: false,
        reason: error?.code === 1 ? 'denied' : 'unavailable',
        error,
      };
    }
  },
};
