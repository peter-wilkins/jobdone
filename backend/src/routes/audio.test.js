import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import FormData from 'form-data';
import { registerAudioRoutes } from './audio.js';
import { EmptyTranscriptionError } from '../services/transcription.js';

async function buildApp(deps = {}) {
  const app = Fastify({ logger: false });
  await app.register(multipart);
  await app.register(registerAudioRoutes, deps);
  await app.ready();
  return app;
}

function audioMultipartPayload() {
  const form = new FormData();
  form.append('audio', Buffer.from('not-real-audio-but-valid-request-body'), {
    filename: 'recording.webm',
    contentType: 'audio/webm',
  });
  return form;
}

describe('AudioRoute POST /api/transcribe', () => {
  test('returns typed 422 response when no speech is detected', async () => {
    const app = await buildApp({
      transcribeAudio: async () => {
        throw new EmptyTranscriptionError();
      },
    });
    const form = audioMultipartPayload();

    const res = await app.inject({
      method: 'POST',
      url: '/api/transcribe',
      headers: form.getHeaders(),
      payload: form,
    });

    assert.equal(res.statusCode, 422);
    assert.deepEqual(JSON.parse(res.body), {
      code: 'empty_transcription',
      error: 'No speech detected',
    });
  });

  test('keeps provider failures as processing failures', async () => {
    const app = await buildApp({
      transcribeAudio: async () => {
        throw new Error('provider unavailable');
      },
    });
    const form = audioMultipartPayload();

    const res = await app.inject({
      method: 'POST',
      url: '/api/transcribe',
      headers: form.getHeaders(),
      payload: form,
    });

    assert.equal(res.statusCode, 500);
    assert.match(JSON.parse(res.body).error, /provider unavailable/);
  });

  test('rate limits transcribe before calling provider', async () => {
    let transcribeCalls = 0;
    const app = await buildApp({
      checkCostlyRouteRateLimit: () => ({ allowed: false, retryAfterSeconds: 60 }),
      transcribeAudio: async () => {
        transcribeCalls += 1;
        return { transcript: 'fixed the leak' };
      },
    });
    const form = audioMultipartPayload();

    const res = await app.inject({
      method: 'POST',
      url: '/api/transcribe',
      headers: form.getHeaders(),
      payload: form,
    });

    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['retry-after'], '60');
    assert.equal(JSON.parse(res.body).error, 'Too many requests');
    assert.equal(transcribeCalls, 0);
  });

  test('does not summarize or extract before review', async () => {
    let summarizeCalls = 0;
    const app = await buildApp({
      transcribeAudio: async () => ({ transcript: 'trimmed the hedge by the front gate' }),
      summarizeAndExtract: async () => {
        summarizeCalls += 1;
        return { summary: 'should not be used' };
      },
    });
    const form = audioMultipartPayload();
    form.append('captureContext', JSON.stringify({ label: 'gardening and home jobs' }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/transcribe',
      headers: form.getHeaders(),
      payload: form,
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), {
      transcript: 'trimmed the hedge by the front gate',
      intent: 'NOTE',
      summary: 'trimmed the hedge by the front gate',
    });
    assert.equal(summarizeCalls, 0);
  });
});

describe('AudioRoute POST /api/summarize', () => {
  test('rate limits summarize before calling provider', async () => {
    let summarizeCalls = 0;
    const app = await buildApp({
      checkCostlyRouteRateLimit: () => ({ allowed: false, retryAfterSeconds: 30 }),
      summarizeAndExtract: async () => {
        summarizeCalls += 1;
        return { summary: 'Done' };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/summarize',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript: 'Fixed the boiler' }),
    });

    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['retry-after'], '30');
    assert.equal(summarizeCalls, 0);
  });

  test('passes JSON capture context to summarizer', async () => {
    let receivedOptions;
    const app = await buildApp({
      summarizeAndExtract: async (transcript, options) => {
        receivedOptions = options;
        return { summary: transcript };
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/summarize',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        transcript: 'Pruned the apple tree',
        captureContext: { label: 'gardening and home jobs' },
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(receivedOptions, { captureContext: { label: 'gardening and home jobs' } });
  });
});
