const updateListeners = new Set();

let registrationPromise = null;
let updateRegistration = null;
let lastUpdateCheckAt = 0;
let updateCheckPromise = null;

const APP_UPDATE_CHECK_INTERVAL_MS = 60_000;

function getLoadedAssetUrls() {
  const sameOrigin = new URL(window.location.href).origin;
  const wantedTypes = new Set(['script', 'link', 'img', 'css', 'font']);

  return performance
    .getEntriesByType('resource')
    .filter(entry => wantedTypes.has(entry.initiatorType))
    .map(entry => entry.name)
    .filter(url => {
      try {
        const parsed = new URL(url);
        return parsed.origin === sameOrigin && !parsed.pathname.startsWith('/api/');
      } catch {
        return false;
      }
    });
}

async function cacheLoadedAssets(registration) {
  const worker = registration.active;
  if (!worker) return;

  worker.postMessage({
    type: 'CACHE_URLS',
    urls: getLoadedAssetUrls(),
  });
}

function notifyUpdateAvailable(registration) {
  updateRegistration = registration;
  updateListeners.forEach(listener => listener(registration));
}

function watchRegistration(registration) {
  if (registration.waiting) {
    notifyUpdateAvailable(registration);
  }

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;

    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        notifyUpdateAvailable(registration);
      }
    });
  });
}

export function onServiceWorkerUpdate(listener) {
  updateListeners.add(listener);
  if (updateRegistration) listener(updateRegistration);
  return () => updateListeners.delete(listener);
}

export async function applyServiceWorkerUpdate(registration = updateRegistration) {
  if (!registration?.waiting) return false;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export async function checkForAppUpdate() {
  const registration = await registrationPromise;
  if (!registration) return false;

  await registration.update();
  if (registration.waiting) {
    notifyUpdateAvailable(registration);
    return true;
  }

  const response = await fetch(`/index.html?update-check=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  });
  const html = await response.text();
  const currentBuild = import.meta.env.VITE_BUILD_ID || 'dev';
  const remoteBuild = html.match(/<meta name="jobdone-build" content="([^"]+)"/)?.[1];
  return Boolean(remoteBuild && remoteBuild !== currentBuild);
}

export async function checkForAndApplyAppUpdate({ force = false } = {}) {
  if (!globalThis.navigator?.serviceWorker) return false;

  const now = Date.now();
  if (!force && now - lastUpdateCheckAt < APP_UPDATE_CHECK_INTERVAL_MS) return false;
  if (updateCheckPromise) return updateCheckPromise;

  lastUpdateCheckAt = now;
  updateCheckPromise = (async () => {
    try {
      const hasUpdate = await checkForAppUpdate();
      if (updateRegistration?.waiting) {
        return applyServiceWorkerUpdate(updateRegistration);
      }
      if (hasUpdate) {
        window.location.reload();
        return true;
      }
      return false;
    } catch (error) {
      console.warn('[PWA] Update check failed:', error);
      return false;
    } finally {
      updateCheckPromise = null;
    }
  })();

  return updateCheckPromise;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    registrationPromise = navigator.serviceWorker.register('/sw.js', {
      updateViaCache: 'none',
    });
    const registration = await registrationPromise;
    watchRegistration(registration);

    if (document.readyState === 'complete') {
      const readyRegistration = await navigator.serviceWorker.ready;
      await cacheLoadedAssets(readyRegistration);
      return;
    }

    window.addEventListener('load', async () => {
      const readyRegistration = await navigator.serviceWorker.ready;
      cacheLoadedAssets(readyRegistration);
    }, { once: true });
  } catch (error) {
    console.warn('[PWA] Service worker registration failed:', error);
  }
}
