const INSTALL_PROMPT_DISMISSED_KEY = 'jobdone.installPrompt.dismissed';

let deferredInstallPrompt = null;
const listeners = new Set();

function safeWindow() {
  return typeof window === 'undefined' ? null : window;
}

function safeNavigator() {
  return typeof navigator === 'undefined' ? null : navigator;
}

function notifyListeners() {
  for (const listener of listeners) {
    listener(getInstallState());
  }
}

export function isStandaloneMode() {
  const win = safeWindow();
  const nav = safeNavigator();
  return Boolean(
    win?.matchMedia?.('(display-mode: standalone)')?.matches ||
    nav?.standalone === true
  );
}

export function isInstallPromptDismissed() {
  const win = safeWindow();
  return win?.localStorage?.getItem(INSTALL_PROMPT_DISMISSED_KEY) === 'true';
}

export function dismissInstallPrompt() {
  const win = safeWindow();
  win?.localStorage?.setItem(INSTALL_PROMPT_DISMISSED_KEY, 'true');
  notifyListeners();
}

export function clearInstallPromptDismissal() {
  const win = safeWindow();
  win?.localStorage?.removeItem(INSTALL_PROMPT_DISMISSED_KEY);
  notifyListeners();
}

export function getInstallState() {
  const standalone = isStandaloneMode();
  return {
    standalone,
    dismissed: isInstallPromptDismissed(),
    hasNativePrompt: Boolean(deferredInstallPrompt),
    canShowAction: !standalone,
    canShowOnboardingPrompt: !standalone && !isInstallPromptDismissed(),
  };
}

export function listenForInstallPrompt(listener) {
  const win = safeWindow();
  listeners.add(listener);
  listener(getInstallState());

  if (!win) {
    return () => listeners.delete(listener);
  }

  const handleBeforeInstallPrompt = (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    notifyListeners();
  };

  const handleAppInstalled = () => {
    deferredInstallPrompt = null;
    notifyListeners();
  };

  win.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  win.addEventListener('appinstalled', handleAppInstalled);

  return () => {
    listeners.delete(listener);
    win.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    win.removeEventListener('appinstalled', handleAppInstalled);
  };
}

export async function requestInstall() {
  if (isStandaloneMode()) {
    return { mode: 'installed', outcome: 'installed' };
  }

  if (!deferredInstallPrompt) {
    return { mode: 'manual', outcome: 'manual' };
  }

  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice;
  notifyListeners();

  return {
    mode: 'native',
    outcome: choice?.outcome || 'unknown',
  };
}

export function resetInstallPromptServiceForTests() {
  deferredInstallPrompt = null;
  listeners.clear();
  clearInstallPromptDismissal();
}
