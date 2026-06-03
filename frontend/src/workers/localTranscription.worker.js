import whisperFactory from 'whisper.cpp';

const MODEL_CACHE = 'jobdone-whisper-models-v1';
let modulePromise = null;
let loadedModelId = null;
let printedLines = [];

function transcriptFromLines(lines = []) {
  return lines
    .map(line => String(line || '').trim())
    .filter(line => /^\[\d{2}:\d{2}:\d{2}\.\d{3}\s+-->/.test(line))
    .map(line => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function cachedModelBytes(model) {
  const cache = await caches.open(MODEL_CACHE);
  const cached = await cache.match(model.url);
  if (!cached) return null;
  return new Uint8Array(await cached.arrayBuffer());
}

async function whisperModule() {
  modulePromise ||= whisperFactory({
    print: line => printedLines.push(line),
    printErr: line => printedLines.push(line),
  });
  return modulePromise;
}

async function ensureModelLoaded(model) {
  const Module = await whisperModule();
  if (loadedModelId === model.id) return Module;

  const bytes = await cachedModelBytes(model);
  if (!bytes) {
    return { error: 'model_not_cached' };
  }

  Module.free?.();
  try {
    Module.FS_unlink?.('/jobdone-whisper.bin');
  } catch {
    // File may not exist yet.
  }
  Module.FS_createDataFile('/', 'jobdone-whisper.bin', bytes, true, false, false);
  const loaded = Module.init('/jobdone-whisper.bin');
  if (!loaded) return { error: 'model_load_failed' };
  loadedModelId = model.id;
  return Module;
}

self.addEventListener('message', async (event) => {
  const { id, type } = event.data || {};
  if (!id || type !== 'transcribe') return;

  try {
    const { pcm16k, model } = event.data;
    if (!(pcm16k instanceof Float32Array) || !pcm16k.length) {
      throw new Error('pcm_required');
    }

    const Module = await ensureModelLoaded(model);
    if (Module.error) {
      self.postMessage({
        id,
        result: {
          ok: false,
          reason: Module.error,
          provider: 'whisper.cpp',
          status: 'placeholder',
        },
      });
      return;
    }

    printedLines = [];
    const started = performance.now();
    const code = Module.full_default(pcm16k, 'en', false);
    const transcript = transcriptFromLines(printedLines);
    self.postMessage({
      id,
      result: {
        ok: code === 0 && Boolean(transcript),
        reason: transcript ? null : 'empty_local_transcript',
        provider: 'whisper.cpp',
        status: code === 0 ? 'ok' : 'failed',
        transcript,
        summary: transcript,
        intent: 'NOTE',
        latencyMs: Math.round(performance.now() - started),
      },
    });
  } catch (error) {
    self.postMessage({
      id,
      result: {
        ok: false,
        reason: error?.message || 'runtime_failed',
        provider: 'whisper.cpp',
        status: 'failed',
      },
    });
  }
});
