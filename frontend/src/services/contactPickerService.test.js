import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contactDraftFromManualInput,
  contactDraftFromPickerResult,
  isContactPickerSupported,
  validateContactDraftForCreation,
} from './contactPickerService.js';

test('builds a Contact draft from native Contact Picker data', () => {
  const draft = contactDraftFromPickerResult({
    name: ['Sarah Jenkins'],
    tel: ['+44 7700 900123'],
    email: ['SARAH@example.com'],
  });

  assert.equal(draft.displayName, 'Sarah Jenkins');
  assert.equal(draft.primaryPhone, '+447700900123');
  assert.equal(draft.primaryEmail, 'sarah@example.com');
  assert.equal(draft.source, 'contact_picker');
});

test('manual Contact creation requires a phone or email evidence key', () => {
  const draft = contactDraftFromManualInput({ displayName: 'Sarah Jenkins' });

  assert.deepEqual(validateContactDraftForCreation(draft), {
    valid: false,
    error: 'Add a phone number or email to create a Contact',
  });
});

test('manual Contact creation accepts deliberate phone evidence', () => {
  const draft = contactDraftFromManualInput({
    displayName: 'Sarah Jenkins',
    phone: '07700 900123',
  });

  assert.equal(draft.primaryPhone, '07700900123');
  assert.deepEqual(validateContactDraftForCreation(draft), { valid: true, error: null });
});

test('unsupported browsers cleanly report no native Contact Picker', () => {
  assert.equal(isContactPickerSupported(), false);
});
