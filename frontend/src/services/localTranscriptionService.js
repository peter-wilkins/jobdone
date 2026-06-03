const CAPTURE_COUNT_KEY = 'jobdone.localTranscription.successfulCaptures.v1';
const METRICS_KEY = 'jobdone.localTranscription.metrics.v1';
const MODEL_CACHE = 'jobdone-whisper-models-v1';

export const WHISPER_BASE_EN_Q5_1 = {
  id: 'base.en-q5_1',
  bytes: 59721011,
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin',
};

let preloadPromise = null;
let workerInstance = null;

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

export function isConnectionLikelyMetered(connection = safeNavigator()?.connection || null) {
  if (!connection) return false;
  if (connection.saveData) return true;
  if (connection.type === 'cellular') return true;
  if (['slow-2g', '2g'].includes(connection.effectiveType)) return true;
  return false;
}

export function shouldPreloadWhisperModel({
  online = safeNavigator()?.onLine !== false,
  connection = safeNavigator()?.connection || null,
  metrics = getLocalTranscriptionMetrics(),
} = {}) {
  if (!online) return false;
  if (metrics?.modelCached) return false;
  if (isConnectionLikelyMetered(connection)) return false;
  return true;
}

export async function preloadWhisperModel({
  cacheStorage = globalThis.caches,
  fetchImpl = globalThis.fetch,
  storage = safeStorage(),
  model = WHISPER_BASE_EN_Q5_1,
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

function getWorker() {
  if (workerInstance) return workerInstance;
  if (typeof Worker !== 'function') return null;
  workerInstance = new Worker(new URL('../workers/localTranscription.worker.js', import.meta.url), { type: 'module' });
  return workerInstance;
}

function askWorker(message, { timeoutMs = 1500 } = {}) {
  const worker = getWorker();
  if (!worker) return null;

  return new Promise((resolve) => {
    const id = `lt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      worker.removeEventListener('message', onMessage);
      resolve({ ok: false, reason: 'runtime_timeout' });
    }, timeoutMs);
    function onMessage(event) {
      if (event.data?.id !== id) return;
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      resolve(event.data.result);
    }
    worker.addEventListener('message', onMessage);
    worker.postMessage({ ...message, id });
  });
}

export async function tryLocalTranscribeAudio(audioBlob, { captureContext = null } = {}) {
  const capabilities = canUseWhisperWasm();
  const workerResult = await askWorker({
    type: 'transcribe',
    audioBlob,
    captureContext,
    model: WHISPER_BASE_EN_Q5_1,
  });
  if (workerResult) {
    return {
      ...workerResult,
      capabilities,
      provider: workerResult.provider || 'whisper.cpp',
    };
  }
  return {
    ok: false,
    reason: 'runtime_not_integrated',
    capabilities,
  };
}

export function resetLocalTranscriptionServiceForTests() {
  preloadPromise = null;
  workerInstance?.terminate?.();
  workerInstance = null;
}
