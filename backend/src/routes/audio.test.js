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
});
