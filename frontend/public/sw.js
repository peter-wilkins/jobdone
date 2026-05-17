const CACHE_VERSION = 'jobdone-app-shell-v2';
const DB_NAME = 'plumber-job-log';
const DB_VERSION = 7;
const ENTRIES_STORE = 'entries';
const FEEDBACK_STORE = 'feedback';
const QUERIES_STORE = 'queries';
const CAPTURES_STORE = 'captures';
const SHARE_TARGET_PATH = '/share-target';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png'
];

function ensureObjectStore(db, name, options, indexes) {
  if (db.objectStoreNames.contains(name)) return;

  const store = db.createObjectStore(name, options);
  indexes.forEach(index => store.createIndex(index.name, index.keyPath, { unique: false }));
  return store;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error(request.error?.message || 'Failed to open database'));
    request.onblocked = () => reject(new Error('Database upgrade blocked'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
      request.onupgradeneeded = event => {
        const db = event.target.result;

      if (db.objectStoreNames.contains('jobs')) {
        db.deleteObjectStore('jobs');
      }

      const entriesStore = ensureObjectStore(db, ENTRIES_STORE, { keyPath: 'id' }, [
        { name: 'status', keyPath: 'status' },
        { name: 'created_at', keyPath: 'created_at' },
        { name: 'sync_status', keyPath: 'syncStatus' },
        { name: 'remoteId', keyPath: 'remoteId' },
        { name: 'captureId', keyPath: 'captureId' },
      ]);
      if (!entriesStore) {
        const existingEntriesStore = event.target.transaction.objectStore(ENTRIES_STORE);
        if (!existingEntriesStore.indexNames.contains('captureId')) {
          existingEntriesStore.createIndex('captureId', 'captureId', { unique: false });
        }
      }
      ensureObjectStore(db, FEEDBACK_STORE, { keyPath: 'id' }, [
        { name: 'status', keyPath: 'status' },
        { name: 'created_at', keyPath: 'created_at' },
      ]);
      ensureObjectStore(db, QUERIES_STORE, { keyPath: 'id' }, [
        { name: 'created_at', keyPath: 'created_at' },
        { name: 'syncStatus', keyPath: 'syncStatus' },
      ]);
      ensureObjectStore(db, CAPTURES_STORE, { keyPath: 'id' }, [
        { name: 'status', keyPath: 'status' },
        { name: 'created_at', keyPath: 'created_at' },
        { name: 'source', keyPath: 'source' },
      ]);
    };
  });
}

function addCapture(capture) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const request = db
      .transaction([CAPTURES_STORE], 'readwrite')
      .objectStore(CAPTURES_STORE)
      .add(capture);

    request.onsuccess = () => resolve(capture.id);
    request.onerror = () => reject(new Error('Failed to create capture'));
  }));
}

function getFormValue(formData, field) {
  const value = formData.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function buildShareCapture(formData) {
  const title = getFormValue(formData, 'title');
  const text = getFormValue(formData, 'text');
  const url = getFormValue(formData, 'url');
  const hasFiles = Array.from(formData.values()).some(value =>
    typeof File !== 'undefined' && value instanceof File && value.size > 0
  );

  if (hasFiles || (!title && !text && !url)) {
    return null;
  }

  const now = new Date().toISOString();
  const payloadType = url ? 'link' : 'text';

  return {
    id: `capture-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    source: 'share_target',
    status: 'ready_for_review',
    errorMessage: null,
    payloads: [{
      type: payloadType,
      title,
      text,
      url,
      received_at: now,
    }],
    created_at: now,
    updated_at: now,
  };
}

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const capture = buildShareCapture(formData);

    if (!capture) {
      return Response.redirect('/share-target?shareTargetError=unsupported', 303);
    }

    await addCapture(capture);
    return Response.redirect(`/share-target?id=${capture.id}`, 303);
  } catch (error) {
    console.warn('[PWA] Share target failed:', error);
    return Response.redirect('/share-target?shareTargetError=failed', 303);
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_URLS' || !Array.isArray(event.data.urls)) return;

  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      const requests = event.data.urls
        .filter(url => typeof url === 'string')
        .map(url => new URL(url, self.location.origin))
        .filter(url => url.origin === self.location.origin && !url.pathname.startsWith('/api/'))
        .map(url => new Request(url.href, { credentials: 'same-origin' }));

      return Promise.allSettled(requests.map(request => cache.add(request)));
    })
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Share target POST handling
  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTarget(request));
    return;
  }

  // Share target GET handling - serve app shell so URL appears valid
  if (request.method === 'GET' && url.pathname === SHARE_TARGET_PATH) {
    event.respondWith(caches.match('/index.html'));
    return;
  }

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (['script', 'style', 'image', 'font'].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;

        return fetch(request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
