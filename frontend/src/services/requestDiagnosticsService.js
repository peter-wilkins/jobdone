const API_REQUEST_STORAGE_KEY = 'jobdone-api-request-diagnostics';
const API_ERROR_DETAIL_STORAGE_KEY = 'jobdone-api-error-details';
const DEBUG_STORAGE_KEY = 'jobdone-debug-logs';
const DEBUG_API_DETAILS_STORAGE_KEY = 'jobdone-debug-api-details';
export const API_ERROR_DETAIL_EVENT = 'jobdone-api-error-detail';
const MAX_REQUESTS = 40;
const MAX_ERROR_DETAILS = 10;
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

function loadErrorDetails() {
  try {
    const parsed = JSON.parse(localStorage.getItem(API_ERROR_DETAIL_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveErrorDetails(details) {
  try {
    localStorage.setItem(API_ERROR_DETAIL_STORAGE_KEY, JSON.stringify(details.slice(-MAX_ERROR_DETAILS)));
  } catch {
    // Debug details must not break API calls.
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

function apiErrorDetailsEnabled() {
  try {
    return localStorage.getItem(DEBUG_API_DETAILS_STORAGE_KEY) === 'true'
      || window.__JOBDONE_API_DEBUG__ === true
      || import.meta.env?.VITE_DEBUG_API_DETAILS === 'true';
  } catch {
    return import.meta.env?.VITE_DEBUG_API_DETAILS === 'true';
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

export function recentApiErrorDetails(limit = 5) {
  return loadErrorDetails().slice(-limit);
}

export function setApiErrorDetailsEnabled(enabled) {
  try {
    localStorage.setItem(DEBUG_API_DETAILS_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Debug preference is best-effort.
  }
}

function safeDebugValue(value, depth = 0) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 1000);
  if (depth >= 4) return '[depth-limit]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => safeDebugValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token|authorization|password|secret|audio|blob/i.test(key))
        .slice(0, 40)
        .map(([key, item]) => [key, safeDebugValue(item, depth + 1)])
    );
  }
  return String(value).slice(0, 1000);
}

async function responseBodyForDebug(response) {
  try {
    const clone = response.clone?.();
    if (!clone) return null;
    const contentType = clone.headers?.get?.('content-type') || '';
    if (contentType.includes('application/json')) {
      return safeDebugValue(await clone.json());
    }
    return String(await clone.text()).slice(0, 2000);
  } catch (error) {
    return { unreadable: error?.message || 'Could not read response body' };
  }
}

export function recordApiErrorDetail(detail = {}) {
  const sanitized = safeDebugValue({
    ...detail,
    at: detail.at || new Date().toISOString(),
  });
  const details = loadErrorDetails();
  details.push(sanitized);
  saveErrorDetails(details);
  try {
    window.dispatchEvent(new CustomEvent(API_ERROR_DETAIL_EVENT, { detail: sanitized }));
  } catch {
    // Non-browser tests do not need UI events.
  }
  return sanitized;
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
    const durationMs = nowMs() - startedAt;
    recordApiRequest({
      requestId,
      endpoint,
      method,
      status: response.status,
      ok: response.ok,
      durationMs,
      failureKind: response.ok ? null : 'http_error',
    });
    if (!response.ok && apiErrorDetailsEnabled()) {
      recordApiErrorDetail({
        requestId,
        endpoint,
        method,
        status: response.status,
        statusText: response.statusText || '',
        durationMs: Math.round(durationMs),
        backendBuild: response.headers?.get?.('x-jobdone-build') || null,
        responseRequestId: response.headers?.get?.('x-jobdone-request-id') || null,
        responseBody: await responseBodyForDebug(response),
      });
    }
    return response;
  } catch (error) {
    const durationMs = nowMs() - startedAt;
    const failureKind = error?.name === 'AbortError' ? 'timeout' : 'network_error';
    recordApiRequest({
      requestId,
      endpoint,
      method,
      status: null,
      ok: false,
      durationMs,
      failureKind,
    });
    if (apiErrorDetailsEnabled()) {
      error.debugDetail = recordApiErrorDetail({
        requestId,
        endpoint,
        method,
        status: null,
        durationMs: Math.round(durationMs),
        failureKind,
        errorName: error?.name || 'Error',
        message: error?.message || 'Network request failed',
      });
    }
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
    localStorage.removeItem(API_ERROR_DETAIL_STORAGE_KEY);
    localStorage.removeItem(DEBUG_API_DETAILS_STORAGE_KEY);
  } catch {
    // Ignore test/global environments without localStorage.
  }
}
