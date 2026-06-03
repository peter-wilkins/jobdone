import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WHISPER_BASE_EN_Q5_1,
  getSuccessfulCaptureCount,
  isConnectionLikelyMetered,
  maybePreloadWhisperModel,
  preloadWhisperModel,
  recordSuccessfulTranscription,
  resetLocalTranscriptionServiceForTests,
  shouldPreloadWhisperModel,
  tryLocalTranscribeAudio,
} from './localTranscriptionService.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function memoryCaches() {
  const stores = new Map();
  return {
    async open(name) {
      const values = stores.get(name) || new Map();
      stores.set(name, values);
      return {
        async match(key) {
          return values.get(key) || null;
        },
        async put(key, response) {
          values.set(key, response);
        },
      };
    },
  };
}

test('records successful captures before lazy preload is eligible', () => {
  const storage = memoryStorage();

  assert.equal(getSuccessfulCaptureCount(storage), 0);
  assert.equal(recordSuccessfulTranscription(storage), 1);
  assert.equal(recordSuccessfulTranscription(storage), 2);
  assert.equal(getSuccessfulCaptureCount(storage), 2);
});

test('preloads opportunistically on usable unmetered connections', () => {
  assert.equal(shouldPreloadWhisperModel({ online: false }), false);
  assert.equal(shouldPreloadWhisperModel({ connection: { saveData: true } }), false);
  assert.equal(shouldPreloadWhisperModel({ connection: { type: 'cellular' } }), false);
  assert.equal(shouldPreloadWhisperModel({ connection: { effectiveType: '2g' } }), false);
  assert.equal(shouldPreloadWhisperModel({ connection: { effectiveType: '4g' } }), true);
  assert.equal(shouldPreloadWhisperModel({ metrics: { modelCached: true } }), false);
  assert.equal(isConnectionLikelyMetered({ type: 'wifi', effectiveType: '4g' }), false);
  assert.equal(isConnectionLikelyMetered({ type: 'cellular', effectiveType: '4g' }), true);
});

test('preloads and records whisper model cache metrics', async () => {
  const storage = memoryStorage();
  const cacheStorage = memoryCaches();
  let fetchCalls = 0;
  const metrics = await preloadWhisperModel({
    storage,
    cacheStorage,
    now: () => 100,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('model bytes');
    },
  });

  assert.equal(fetchCalls, 1);
  assert.equal(metrics.modelId, WHISPER_BASE_EN_Q5_1.id);
  assert.equal(metrics.modelBytes, 59721011);
  assert.equal(metrics.modelCached, true);
  assert.equal(metrics.status, 'downloaded');

  const cachedMetrics = await preloadWhisperModel({
    storage,
    cacheStorage,
    now: () => 200,
    fetchImpl: async () => {
      throw new Error('should use cache');
    },
  });

  assert.equal(cachedMetrics.status, 'cached');
});

test('reports local transcription runtime as not integrated yet', async () => {
  const result = await tryLocalTranscribeAudio(new Blob(['audio']));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'runtime_not_integrated');
  assert.equal(typeof result.capabilities.hasWebAssembly, 'boolean');
});

test('maybePreloadWhisperModel keeps one preload in flight', async () => {
  resetLocalTranscriptionServiceForTests();
  const storage = memoryStorage();
  const cacheStorage = memoryCaches();
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return new Response('model bytes');
  };

  const first = maybePreloadWhisperModel({
    storage,
    cacheStorage,
    fetchImpl,
  });
  const second = maybePreloadWhisperModel({
    storage,
    cacheStorage,
    fetchImpl,
  });

  assert.equal(first, second);
  await first;
  assert.equal(fetchCalls, 1);
});
