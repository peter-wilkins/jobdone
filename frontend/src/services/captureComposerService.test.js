import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendComposerText,
  clearComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
  shouldEnableComposerSubmit,
  submitCaptureComposerDraft,
} from './captureComposerService.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('Capture Composer drafts persist by stable key until cleared', () => {
  const storage = memoryStorage();
  saveComposerDraft('team-evidence:item-1', 'Finished pond survey', { storage });

  assert.equal(loadComposerDraft('team-evidence:item-1', { storage }), 'Finished pond survey');

  clearComposerDraft('team-evidence:item-1', { storage });

  assert.equal(loadComposerDraft('team-evidence:item-1', { storage }), null);
});

test('Capture Composer appends suggested evidence once', () => {
  assert.equal(appendComposerText('', 'Photo taken'), 'Photo taken');
  assert.equal(appendComposerText('Existing note', 'Photo taken'), 'Existing note\n\nPhoto taken');
  assert.equal(appendComposerText('Existing note\n\nPhoto taken', 'Photo taken'), 'Existing note\n\nPhoto taken');
});

test('Capture Composer submit adapter clears draft only after successful submit', async () => {
  const storage = memoryStorage();
  saveComposerDraft('team-evidence:item-2', 'Done', { storage });

  await submitCaptureComposerDraft({
    draftKey: 'team-evidence:item-2',
    text: 'Done',
    storage,
    onSubmit: async ({ text }) => {
      assert.equal(text, 'Done');
      return { ok: true };
    },
  });

  assert.equal(loadComposerDraft('team-evidence:item-2', { storage }), null);
});

test('Capture Composer keeps draft when submit adapter fails', async () => {
  const storage = memoryStorage();
  saveComposerDraft('team-evidence:item-3', 'Still important', { storage });

  await assert.rejects(
    () => submitCaptureComposerDraft({
      draftKey: 'team-evidence:item-3',
      text: 'Still important',
      storage,
      onSubmit: async () => {
        throw new Error('network down');
      },
    }),
    /network down/,
  );

  assert.equal(loadComposerDraft('team-evidence:item-3', { storage }), 'Still important');
});

test('Capture Composer submit is disabled for empty required text and pending attachments', () => {
  assert.equal(shouldEnableComposerSubmit({ text: '', requireText: true }), false);
  assert.equal(shouldEnableComposerSubmit({ text: 'Evidence', requireText: true }), true);
  assert.equal(shouldEnableComposerSubmit({ text: '', requireText: false }), false);
  assert.equal(shouldEnableComposerSubmit({
    text: '',
    requireText: false,
    attachments: [{ kind: 'photo', status: 'ready' }],
  }), true);
  assert.equal(shouldEnableComposerSubmit({
    text: 'Evidence',
    attachments: [{ status: 'pending_compression' }],
  }), false);
});
