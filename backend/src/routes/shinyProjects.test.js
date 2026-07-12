import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerShinyProjectRoutes } from './shinyProjects.js';

const OWNER_ID = '01973e36-4c80-7abc-8a72-000000000001';

async function buildApp(store) {
  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });
  await registerShinyProjectRoutes(app, { localReplicaStore: store });
  await app.ready();
  return app;
}

test('Shiny project upload creates and stores a previewed project object', async () => {
  let capturedPush = null;
  const app = await buildApp({
    configured: true,
    push: async (payload) => {
      capturedPush = payload;
      return {
        replicaEpoch: payload.request.replicaEpoch,
        baseT: 0,
        toT: 1,
        results: [{
          intentId: payload.request.intents[0].id,
          status: 'accepted',
          t: 1,
          objectId: payload.request.intents[0].objectId,
          reason: null,
        }],
        objects: [],
      };
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/shiny/projects',
      headers: {
        'content-type': 'application/json',
        'x-jobdone-device-id': 'device-1',
      },
      body: JSON.stringify({
        ownerUserId: OWNER_ID,
        filename: 'dog.jpg',
        mimeType: 'image/jpeg',
        dataBase64: Buffer.from('image bytes').toString('base64'),
      }),
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'previewed');
    assert.equal(body.previewImage.mimeType, 'image/jpeg');

    assert.equal(capturedPush.actorUserId, OWNER_ID);
    assert.equal(capturedPush.actorDeviceId, 'device-1');
    const intent = capturedPush.request.intents[0];
    assert.equal(intent.ownerKind, 'user');
    assert.equal(intent.ownerId, OWNER_ID);
    assert.equal(intent.collection, 'shinyProjects');
    assert.equal(intent.action, 'createObject');
    assert.equal(intent.payloadJson.model.project.ownerUserId, OWNER_ID);
    assert.equal(intent.payloadJson.model.files[0].filename, 'dog.jpg');
    assert.equal(intent.payloadJson.model.files[0].dataBase64, Buffer.from('image bytes').toString('base64'));
  } finally {
    await app.close();
  }
});

test('Shiny project upload rejects non-image uploads', async () => {
  const app = await buildApp({
    configured: true,
    push: async () => {
      throw new Error('store should not be called');
    },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/shiny/projects',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ownerUserId: OWNER_ID,
        filename: 'notes.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('nope').toString('base64'),
      }),
    });

    assert.equal(response.statusCode, 400);
    assert.match(JSON.parse(response.body).error, /image/);
  } finally {
    await app.close();
  }
});
