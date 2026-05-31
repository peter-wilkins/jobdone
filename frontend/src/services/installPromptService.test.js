import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dismissInstallPrompt,
  getInstallState,
  isStandaloneMode,
  listenForInstallPrompt,
  requestInstall,
  resetInstallPromptServiceForTests,
} from './installPromptService.js';

function installWindow({ standalone = false } = {}) {
  const storage = new Map();
  const handlers = new Map();
  globalThis.window = {
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    matchMedia: query => ({ matches: query === '(display-mode: standalone)' ? standalone : false }),
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: type => handlers.delete(type),
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { standalone: false },
    configurable: true,
  });
  return { handlers };
}

function removeWindow() {
  delete globalThis.window;
  delete globalThis.navigator;
}

test('suppresses install actions in standalone mode', () => {
  installWindow({ standalone: true });
  resetInstallPromptServiceForTests();

  assert.equal(isStandaloneMode(), true);
  assert.deepEqual(getInstallState(), {
    standalone: true,
    dismissed: false,
    hasNativePrompt: false,
    canShowAction: false,
    canShowOnboardingPrompt: false,
  });

  removeWindow();
});

test('remembers dismissed onboarding install prompt', () => {
  installWindow();
  resetInstallPromptServiceForTests();

  assert.equal(getInstallState().canShowOnboardingPrompt, true);
  dismissInstallPrompt();
  assert.equal(getInstallState().dismissed, true);
  assert.equal(getInstallState().canShowOnboardingPrompt, false);
  assert.equal(getInstallState().canShowAction, true);

  removeWindow();
});

test('captures beforeinstallprompt and uses native install prompt once', async () => {
  const { handlers } = installWindow();
  resetInstallPromptServiceForTests();
  const states = [];
  const unsubscribe = listenForInstallPrompt(state => states.push(state));
  let promptCalled = false;

  handlers.get('beforeinstallprompt')({
    preventDefault() {},
    prompt: async () => {
      promptCalled = true;
    },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  });

  assert.equal(states.at(-1).hasNativePrompt, true);
  const result = await requestInstall();

  assert.equal(promptCalled, true);
  assert.deepEqual(result, { mode: 'native', outcome: 'accepted' });
  assert.equal(getInstallState().hasNativePrompt, false);

  unsubscribe();
  removeWindow();
});

test('falls back to manual guidance when native prompt is unavailable', async () => {
  installWindow();
  resetInstallPromptServiceForTests();

  assert.deepEqual(await requestInstall(), { mode: 'manual', outcome: 'manual' });

  removeWindow();
});
