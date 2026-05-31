import { diagnosticService } from './diagnosticService.js';
import { recentApiRequests } from './requestDiagnosticsService.js';

const STORAGE_KEY = 'jobdone-crash-reports';
const RATE_LIMIT_KEY = 'jobdone-crash-report-rate-limit';
const MAX_PENDING = 10;
const MAX_STACK_CHARS = 3000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const ENV = import.meta.env || {};
const BUILD_ID = ENV.VITE_DEPLOYMENT_ID || ENV.VITE_BUILD_ID || 'dev';

let installed = false;
let flushInFlight = false;

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix = 'crash') {
  const bytes = new Uint8Array(12);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const encoded = Array.from(bytes).map(byte => byte.toString(36).padStart(2, '0')).join('').slice(0, 32);
  return `${prefix}_${encoded}`;
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function compactString(value, limit) {
  return String(value || '').slice(0, limit);
}

function routeInfo() {
  return {
    path: window.location.pathname,
    hash: window.location.hash,
    screen: window.location.hash.replace('#', '').split('?')[0] || 'home',
  };
}

function loadJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Crash reporting must never crash the app.
  }
}

function loadPending() {
  const reports = loadJson(STORAGE_KEY, []);
  return Array.isArray(reports) ? reports : [];
}

function savePending(reports) {
  saveJson(STORAGE_KEY, reports.slice(-MAX_PENDING));
}

function loadRateLimit() {
  const value = loadJson(RATE_LIMIT_KEY, {});
  return value && typeof value === 'object' ? value : {};
}

function saveRateLimit(value) {
  saveJson(RATE_LIMIT_KEY, value);
}

function isRateLimited(signature, atMs = Date.now()) {
  const limits = loadRateLimit();
  const key = `${BUILD_ID}:${signature}`;
  const lastSentAt = limits[key]?.last_sent_at || 0;
  return atMs - lastSentAt < RATE_LIMIT_WINDOW_MS;
}

function markSent(signature, atMs = Date.now()) {
  const limits = loadRateLimit();
  const key = `${BUILD_ID}:${signature}`;
  limits[key] = {
    last_sent_at: atMs,
    count: (limits[key]?.count || 0) + 1,
  };
  saveRateLimit(limits);
}

function errorFromUnhandledRejection(event) {
  const reason = event?.reason;
  if (reason instanceof Error) return reason;
  return {
    name: 'UnhandledRejection',
    message: typeof reason === 'string' ? reason : 'Unhandled promise rejection',
    stack: reason?.stack || '',
  };
}

export function buildCrashReport(error, { source = 'runtime' } = {}) {
  const name = compactString(error?.name || 'Error', 120);
  const message = compactString(error?.message || 'Unknown crash', 300);
  const stack = compactString(error?.stack || '', MAX_STACK_CHARS);
  const route = routeInfo();
  const signature = hashText([BUILD_ID, name, message, route.screen].join('|'));
  return {
    crash_id: randomId(),
    signature,
    captured_at: nowIso(),
    source,
    build_id: BUILD_ID,
    route,
    error: { name, message, stack },
    recent_request_ids: recentApiRequests(10).map(request => request.request_id),
  };
}

export function sanitizeCrashDiagnosticBundle(bundle = {}) {
  return {
    ...bundle,
    report_type: 'crash_report',
    recent_events: (bundle.recent_events || []).filter(event => {
      const name = String(event?.event || '');
      return !name.startsWith('report_issue_') && !name.startsWith('issue_report_');
    }),
    privacy: {
      ...(bundle.privacy || {}),
      excludes: Array.from(new Set([
        ...(bundle.privacy?.excludes || []),
        'entry content',
        'capture payloads',
        'feedback text/audio',
        'contact details',
        'location labels and addresses',
        'transcripts',
        'auth/session data',
        'raw API bodies',
        'localStorage dumps',
        'IndexedDB dumps',
      ])),
    },
  };
}

export function captureCrash(error, { source = 'runtime', onStatus } = {}) {
  const report = buildCrashReport(error, { source });
  const pending = loadPending();
  if (!pending.some(item => item.signature === report.signature)) {
    pending.push(report);
    savePending(pending);
  }
  diagnosticService.record('crash_report_captured', {
    source,
    crashId: report.crash_id,
    signature: report.signature,
  });
  onStatus?.({ kind: 'captured', message: 'A crash report was captured and will be sent automatically.' });
  return report;
}

export async function flushCrashReports({ api, onStatus } = {}) {
  if (!api || flushInFlight) return { sent: 0, skipped: 0, failed: 0 };
  flushInFlight = true;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const pending = loadPending();
    const remaining = [];

    for (const report of pending) {
      if (isRateLimited(report.signature)) {
        skipped += 1;
        continue;
      }

      try {
        const diagnosticBundle = sanitizeCrashDiagnosticBundle(await diagnosticService.buildBundle({
          screen: 'crash_report',
          backendAvailable: null,
        }));
        await api.saveCrashReport({
          crash_report: report,
          diagnostic_bundle: diagnosticBundle,
        });
        markSent(report.signature);
        sent += 1;
      } catch {
        failed += 1;
        remaining.push(report);
      }
    }

    savePending(remaining);
    if (sent > 0) {
      onStatus?.({ kind: 'sent', message: `${sent} crash report${sent === 1 ? '' : 's'} sent automatically.` });
    } else if (failed > 0) {
      onStatus?.({ kind: 'failed', message: 'A crash report is waiting to send.' });
    }
    return { sent, skipped, failed };
  } finally {
    flushInFlight = false;
  }
}

export function startCrashReporting({ api, onStatus } = {}) {
  if (installed || typeof window === 'undefined') {
    return () => {};
  }
  installed = true;

  const handleError = event => {
    captureCrash(event.error || {
      name: 'Error',
      message: event.message || 'Unhandled window error',
      stack: '',
    }, { source: 'window_error', onStatus });
    window.setTimeout(() => flushCrashReports({ api, onStatus }), 250);
  };

  const handleRejection = event => {
    captureCrash(errorFromUnhandledRejection(event), { source: 'unhandledrejection', onStatus });
    window.setTimeout(() => flushCrashReports({ api, onStatus }), 250);
  };

  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleRejection);
  window.setTimeout(() => flushCrashReports({ api, onStatus }), 500);

  return () => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
    installed = false;
  };
}

export function resetCrashReportsForTests() {
  installed = false;
  flushInFlight = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(RATE_LIMIT_KEY);
  } catch {
    // Test-only helper.
  }
}

export const crashReportService = {
  start: startCrashReporting,
  capture: captureCrash,
  flush: flushCrashReports,
};
