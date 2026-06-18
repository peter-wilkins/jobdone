import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAddMorePhotos,
  compressPhotoAttachment,
  createPendingPhotoAttachmentsFromFiles,
  createPendingPhotoAttachments,
  formatAttachmentBytes,
  hasPendingPhotoAttachments,
  MAX_PHOTOS_PER_CAPTURE,
  readyPhotoAttachments,
} from './photoAttachmentService.js';

function fakeFile(name, type = 'image/jpeg', size = 1234) {
  return { name, type, size };
}

function realImageFile(name = 'garden.jpg') {
  return new File(['image-bytes'], name, { type: 'image/jpeg' });
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

test('photo attachment service copies picker files to stable Blobs', async () => {
  const pending = await createPendingPhotoAttachmentsFromFiles([realImageFile()], []);

  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, 'pending_compression');
  assert.equal(pending[0].originalBlob instanceof Blob, true);
  assert.equal(pending[0].originalSize, 11);
});

test('photo compression falls back to saving the original Blob when compression fails', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};

  let result;
  try {
    result = await compressPhotoAttachment({
      id: 'attachment-1',
      kind: 'photo',
      status: 'pending_compression',
      originalName: 'garden.jpg',
      originalType: 'image/jpeg',
      originalSize: 11,
      originalBlob: realImageFile(),
    }, {
      compressor: async () => {
        throw new Error('The source image could not be decoded.');
      },
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(result.status, 'ready');
  assert.equal(result.compressionStatus, 'fallback_original');
  assert.equal(result.compressionError, 'The source image could not be decoded.');
  assert.equal(result.blob instanceof Blob, true);
  assert.equal(result.dataBase64, 'aW1hZ2UtYnl0ZXM=');
  assert.equal(result.originalBlob, null);
});
