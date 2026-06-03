const CAPTURE_COUNT_KEY = 'jobdone.localTranscription.successfulCaptures.v1';
const METRICS_KEY = 'jobdone.localTranscription.metrics.v1';
const MODEL_CACHE = 'jobdone-whisper-models-v1';

export const WHISPER_TINY_EN_Q5_1 = {
  id: 'tiny.en-q5_1',
  bytes: 32166155,
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin',
};

let preloadPromise = null;

function safeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function safeNavigator() {
  return typeof navigator === 'undefined' ? null : navigator;
}

function nowMs() {
  return globalThis.performance?.now?.() || Date.now();
}

function readJson(storage, key, fallback) {
  if (!storage) return fallback;
  try {
    return JSON.parse(storage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage, key, value) {
  if (!storage) return;
  storage.setItem(key, JSON.stringify(value));
}

export function getSuccessfulCaptureCount(storage = safeStorage()) {
  return Number(readJson(storage, CAPTURE_COUNT_KEY, 0)) || 0;
}

export function getLocalTranscriptionMetrics(storage = safeStorage()) {
  return readJson(storage, METRICS_KEY, null);
}

export function recordSuccessfulTranscription(storage = safeStorage()) {
  const next = getSuccessfulCaptureCount(storage) + 1;
  writeJson(storage, CAPTURE_COUNT_KEY, next);
  return next;
}

export function canUseWhisperWasm(global = globalThis) {
  return {
    hasWebAssembly: typeof global.WebAssembly === 'object',
    hasSharedArrayBuffer: typeof global.SharedArrayBuffer === 'function',
    hasWorker: typeof global.Worker === 'function',
    hasAudioContext: typeof global.AudioContext === 'function' || typeof global.webkitAudioContext === 'function',
  };
}

export function shouldPreloadWhisperModel({
  successfulCaptures = getSuccessfulCaptureCount(),
  online = safeNavigator()?.onLine !== false,
  connection = safeNavigator()?.connection || null,
  metrics = getLocalTranscriptionMetrics(),
} = {}) {
  if (successfulCaptures < 2) return false;
  if (!online) return false;
  if (metrics?.modelCached) return false;
  if (connection?.saveData) return false;
  if (['slow-2g', '2g'].includes(connection?.effectiveType)) return false;
  return true;
}

export async function preloadWhisperModel({
  cacheStorage = globalThis.caches,
  fetchImpl = globalThis.fetch,
  storage = safeStorage(),
  model = WHISPER_TINY_EN_Q5_1,
  now = nowMs,
} = {}) {
  if (!cacheStorage || !fetchImpl) {
    const metrics = {
      modelId: model.id,
      modelBytes: model.bytes,
      modelCached: false,
      status: 'unavailable',
      reason: 'cache_or_fetch_unavailable',
      checkedAt: new Date().toISOString(),
    };
    writeJson(storage, METRICS_KEY, metrics);
    return metrics;
  }

  const started = now();
  const cache = await cacheStorage.open(MODEL_CACHE);
  const cached = await cache.match(model.url);
  if (cached) {
    const metrics = {
      modelId: model.id,
      modelBytes: model.bytes,
      modelCached: true,
      status: 'cached',
      durationMs: Math.round(now() - started),
      checkedAt: new Date().toISOString(),
    };
    writeJson(storage, METRICS_KEY, metrics);
    return metrics;
  }

  try {
    const response = await fetchImpl(model.url, { cache: 'force-cache', mode: 'cors' });
    if (!response?.ok) throw new Error(`model fetch failed: ${response?.status || 'unknown'}`);
    await cache.put(model.url, response.clone());
    const metrics = {
      modelId: model.id,
      modelBytes: model.bytes,
      modelCached: true,
      status: 'downloaded',
      durationMs: Math.round(now() - started),
      checkedAt: new Date().toISOString(),
    };
    writeJson(storage, METRICS_KEY, metrics);
    return metrics;
  } catch (error) {
    const metrics = {
      modelId: model.id,
      modelBytes: model.bytes,
      modelCached: false,
      status: 'failed',
      reason: error?.message || 'model_preload_failed',
      durationMs: Math.round(now() - started),
      checkedAt: new Date().toISOString(),
    };
    writeJson(storage, METRICS_KEY, metrics);
    return metrics;
  }
}

export function maybePreloadWhisperModel(options = {}) {
  if (!shouldPreloadWhisperModel(options)) return null;
  preloadPromise ||= preloadWhisperModel(options).finally(() => {
    preloadPromise = null;
  });
  return preloadPromise;
}

export async function tryLocalTranscribeAudio() {
  const capabilities = canUseWhisperWasm();
  return {
    ok: false,
    reason: 'runtime_not_integrated',
    capabilities,
  };
}

export function resetLocalTranscriptionServiceForTests() {
  preloadPromise = null;
}
