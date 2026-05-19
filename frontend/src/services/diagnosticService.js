import { recentApiRequests } from './requestDiagnosticsService.js';

const EVENT_STORAGE_KEY = 'jobdone-diagnostic-events';
const MAX_EVENTS = 40;
const ENV = import.meta.env || {};
const BUILD_ID = ENV.VITE_DEPLOYMENT_ID || ENV.VITE_BUILD_ID || 'dev';

const PRIVATE_KEYS = new Set([
  'audio',
  'body',
  'contact',
  'contacts',
  'email',
  'emails',
  'entry',
  'entries',
  'name',
  'phone',
  'phones',
  'rawPayload',
  'summary',
  'text',
  'transcript',
]);

function loadEvents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EVENT_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveEvents(events) {
  try {
    localStorage.setItem(EVENT_STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // Diagnostics should never break capture or reporting.
  }
}

function sanitizeDetail(detail = {}) {
  return Object.fromEntries(
    Object.entries(detail || {})
      .filter(([key, value]) => !PRIVATE_KEYS.has(key) && value !== undefined)
      .map(([key, value]) => {
        if (typeof value === 'string') return [key, value.slice(0, 120)];
        if (typeof value === 'number' || typeof value === 'boolean' || value === null) return [key, value];
        if (Array.isArray(value)) return [key, value.slice(0, 10).map(item => String(item).slice(0, 80))];
        return [key, String(value).slice(0, 120)];
      })
  );
}

function browserInfo() {
  const nav = window.navigator;
  return {
    userAgent: nav.userAgent,
    platform: nav.platform || '',
    language: nav.language || '',
    standalone: window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true,
    online: nav.onLine,
    screen: {
      width: window.screen?.width || null,
      height: window.screen?.height || null,
      pixelRatio: window.devicePixelRatio || 1,
    },
  };
}

export const diagnosticService = {
  record(event, detail = {}) {
    const events = loadEvents();
    events.push({
      event,
      detail: sanitizeDetail(detail),
      path: window.location.pathname,
      hash: window.location.hash,
      at: new Date().toISOString(),
    });
    saveEvents(events);
  },

  recentEvents(limit = 25) {
    return loadEvents().slice(-limit);
  },

  async buildBundle({ screen, backendAvailable = null } = {}) {
    return {
      captured_at: new Date().toISOString(),
      build_id: BUILD_ID,
      route: {
        screen,
        path: window.location.pathname,
        hash: window.location.hash,
      },
      environment: browserInfo(),
      backend: {
        available: backendAvailable,
      },
      recent_events: this.recentEvents(),
      recent_api_requests: recentApiRequests(),
      privacy: {
        excludes: [
          'entry content',
          'transcripts outside this report',
          'contact details',
          'shared payload bodies',
          'audio blobs',
        ],
      },
    };
  },
};
