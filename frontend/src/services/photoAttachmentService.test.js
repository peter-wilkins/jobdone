import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAddMorePhotos,
  compressPhotoAttachment,
  createPendingPhotoAttachments,
  formatAttachmentBytes,
  hasPendingPhotoAttachments,
  MAX_PHOTOS_PER_CAPTURE,
  readyPhotoAttachments,
} from './photoAttachmentService.js';

function fakeFile(name, type = 'image/jpeg', size = 1234) {
  return { name, type, size };
}

function makeWorkerCtor(responses) {
  const calls = [];
  class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      calls.push(this);
    }

    postMessage(message) {
      this.message = message;
      const response = responses.shift();
      queueMicrotask(() => {
        this.onmessage?.({ data: response });
      });
    }

    terminate() {
      this.terminated = true;
    }
  }
  FakeWorker.calls = calls;
  return FakeWorker;
}

test('photo attachment service caps selected photos for one Capture', () => {
  const files = Array.from({ length: 10 }, (_, index) => fakeFile(`photo-${index}.jpg`));
  const pending = createPendingPhotoAttachments(files, []);

  assert.equal(pending.length, MAX_PHOTOS_PER_CAPTURE);
  assert.equal(canAddMorePhotos(pending), false);
});

test('photo attachment service ignores non-image files', () => {
  const pending = createPendingPhotoAttachments([
    fakeFile('note.txt', 'text/plain'),
    fakeFile('receipt.jpg', 'image/jpeg'),
  ], []);

  assert.equal(pending.length, 1);
  assert.equal(pending[0].originalName, 'receipt.jpg');
});

test('photo attachment service reports pending and ready attachments', () => {
  const attachments = [
    { id: 'pending', kind: 'photo', status: 'pending_compression' },
    { id: 'ready', kind: 'photo', status: 'ready' },
    { id: 'link', kind: 'link', status: 'ready' },
  ];

  assert.equal(hasPendingPhotoAttachments(attachments), true);
  assert.deepEqual(readyPhotoAttachments(attachments).map(item => item.id), ['ready']);
});

test('photo attachment service formats byte counts', () => {
  assert.equal(formatAttachmentBytes(100), '100 B');
  assert.equal(formatAttachmentBytes(2048), '2 KB');
});

test('photo compression retries transient source image decode failures', async () => {
  const WorkerCtor = makeWorkerCtor([
    { ok: false, error: 'The source image could not be decoded.' },
    {
      ok: true,
      blob: new Blob(['compressed'], { type: 'image/jpeg' }),
      metadata: {
        width: 640,
        height: 480,
        mimeType: 'image/jpeg',
        size: 10,
        originalName: 'garden.jpg',
        originalSize: 1234,
        originalType: 'image/jpeg',
      },
    },
  ]);

  const result = await compressPhotoAttachment({
    id: 'attachment-1',
    kind: 'photo',
    status: 'pending_compression',
    originalName: 'garden.jpg',
    originalType: 'image/jpeg',
    originalSize: 1234,
    originalBlob: fakeFile('garden.jpg'),
  }, {
    WorkerCtor,
    retryDelaysMs: [0, 0],
    workerUrl: 'worker.js',
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.width, 640);
  assert.equal(result.originalBlob, null);
  assert.equal(WorkerCtor.calls.length, 2);
});
