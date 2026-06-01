import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRICTION_EVENTS,
  dismissContextSourcePrompt,
  getActiveContextSourcePrompts,
  getFrictionCounters,
  recordContextSourceFriction,
  resetContextSourcePromptStateForTests,
  shouldShowContextSourcePrompt,
} from './contextSourcePromptService.js';

function installLocalStorage() {
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    },
  };
}

beforeEach(() => {
  installLocalStorage();
  resetContextSourcePromptStateForTests();
});

test('does not show optional source prompts on first run', () => {
  assert.deepEqual(getFrictionCounters(), {});
  assert.deepEqual(getActiveContextSourcePrompts(), []);
});

test('shows Location prompt after repeated blank Locations', () => {
  recordContextSourceFriction(FRICTION_EVENTS.BLANK_LOCATION);
  recordContextSourceFriction(FRICTION_EVENTS.BLANK_LOCATION);

  assert.equal(shouldShowContextSourcePrompt('location'), false);

  recordContextSourceFriction(FRICTION_EVENTS.BLANK_LOCATION);

  assert.equal(shouldShowContextSourcePrompt('location'), true);
  assert.deepEqual(getActiveContextSourcePrompts().map(prompt => prompt.id), ['location']);
});

test('shows Location prompt after repeated manual Location correction', () => {
  recordContextSourceFriction(FRICTION_EVENTS.MANUAL_LOCATION);
  recordContextSourceFriction(FRICTION_EVENTS.MANUAL_LOCATION);

  assert.equal(shouldShowContextSourcePrompt('location'), true);
});

test('shows Contact prompt after repeated Contact correction', () => {
  recordContextSourceFriction(FRICTION_EVENTS.CONTACT_CORRECTION);
  recordContextSourceFriction(FRICTION_EVENTS.CONTACT_CORRECTION);

  assert.deepEqual(getActiveContextSourcePrompts().map(prompt => prompt.id), ['contact']);
});

test('dismissed prompts do not repeat aggressively', () => {
  recordContextSourceFriction(FRICTION_EVENTS.BLANK_LOCATION);
  recordContextSourceFriction(FRICTION_EVENTS.BLANK_LOCATION);
  recordContextSourceFriction(FRICTION_EVENTS.BLANK_LOCATION);

  dismissContextSourcePrompt('location');

  assert.equal(shouldShowContextSourcePrompt('location'), false);
  assert.deepEqual(getActiveContextSourcePrompts(), []);
});
