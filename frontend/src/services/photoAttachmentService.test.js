import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAddMorePhotos,
  createPendingPhotoAttachments,
  formatAttachmentBytes,
  hasPendingPhotoAttachments,
  MAX_PHOTOS_PER_CAPTURE,
  readyPhotoAttachments,
} from './photoAttachmentService.js';

function fakeFile(name, type = 'image/jpeg', size = 1234) {
  return { name, type, size };
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
