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
    urls: ['/', '/index.html', ...getLoadedAssetUrls()],
  });
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register('/sw.js');

    if (document.readyState === 'complete') {
      const registration = await navigator.serviceWorker.ready;
      await cacheLoadedAssets(registration);
      return;
    }

    window.addEventListener('load', async () => {
      const registration = await navigator.serviceWorker.ready;
      cacheLoadedAssets(registration);
    }, { once: true });
  } catch (error) {
    console.warn('[PWA] Service worker registration failed:', error);
  }
}
