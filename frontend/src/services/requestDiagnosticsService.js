const API_REQUEST_STORAGE_KEY = 'jobdone-api-request-diagnostics';
const DEBUG_STORAGE_KEY = 'jobdone-debug-logs';
const MAX_REQUESTS = 40;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{12,80}$/;

function safeRandomBytes(length = 16) {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(length);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes);
  }
  return Array.from({ length }, () => Math.floor(Math.random() * 256));
}

function encodeRequestIdBytes(bytes) {
  return bytes
    .map(byte => byte.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 48);
}

function loadRequests() {
  try {
    const parsed = JSON.parse(localStorage.getItem(API_REQUEST_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRequests(requests) {
  try {
    localStorage.setItem(API_REQUEST_STORAGE_KEY, JSON.stringify(requests.slice(-MAX_REQUESTS)));
  } catch {
    // Request diagnostics must not break API calls.
  }
}

function debugLogsEnabled() {
  try {
    return localStorage.getItem(DEBUG_STORAGE_KEY) === 'true'
      || window.__JOBDONE_QA_DEBUG__ === true
      || import.meta.env?.VITE_DEBUG_LOGS === 'true';
  } catch {
    return import.meta.env?.VITE_DEBUG_LOGS === 'true';
  }
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function createRequestId() {
  return `req_${encodeRequestIdBytes(safeRandomBytes())}`;
}

export function isValidRequestId(value) {
  return REQUEST_ID_PATTERN.test(String(value || ''));
}

export function recordApiRequest({
  requestId,
  endpoint,
  method = 'GET',
  status = null,
  ok = false,
  durationMs = null,
  failureKind = null,
} = {}) {
  if (!isValidRequestId(requestId)) return;
  const diagnostic = {
    request_id: requestId,
    endpoint: String(endpoint || 'unknown').slice(0, 120),
    method: String(method || 'GET').toUpperCase().slice(0, 12),
    status,
    ok: Boolean(ok),
    duration_ms: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
    failure_kind: failureKind ? String(failureKind).slice(0, 80) : null,
    at: new Date().toISOString(),
  };
  const requests = loadRequests();
  requests.push(diagnostic);
  saveRequests(requests);
  if (debugLogsEnabled()) {
    console.info('[JobDone debug]', 'api_request', JSON.stringify(diagnostic));
  }
}

export function recentApiRequests(limit = 25) {
  return loadRequests().slice(-limit);
}

export async function fetchWithRequestDiagnostics(url, options = {}, timeoutMs = null) {
  const requestId = createRequestId();
  const method = options.method || 'GET';
  const endpoint = endpointFromUrl(url);
  const startedAt = nowMs();
  const headers = {
    ...(options.headers || {}),
    'x-jobdone-request-id': requestId,
  };
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = timeoutMs
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller?.signal || options.signal,
    });
    recordApiRequest({
      requestId,
      endpoint,
      method,
      status: response.status,
      ok: response.ok,
      durationMs: nowMs() - startedAt,
      failureKind: response.ok ? null : 'http_error',
    });
    return response;
  } catch (error) {
    recordApiRequest({
      requestId,
      endpoint,
      method,
      status: null,
      ok: false,
      durationMs: nowMs() - startedAt,
      failureKind: error?.name === 'AbortError' ? 'timeout' : 'network_error',
    });
    error.requestId = requestId;
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function endpointFromUrl(url) {
  try {
    return new URL(url, globalThis.location?.origin || 'http://localhost').pathname;
  } catch {
    return String(url || 'unknown').split('?')[0].slice(0, 120);
  }
}

export function resetRequestDiagnosticsForTests() {
  try {
    localStorage.removeItem(API_REQUEST_STORAGE_KEY);
  } catch {
    // Ignore test/global environments without localStorage.
  }
}
