const CACHE_VERSION = 'jobdone-app-shell-v3';
const DB_NAME = 'plumber-job-log';
const DB_VERSION = 8;
const ENTRIES_STORE = 'entries';
const FEEDBACK_STORE = 'feedback';
const QUERIES_STORE = 'queries';
const CAPTURES_STORE = 'captures';
const PEOPLE_STORE = 'people';
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
  const openOnce = () => new Promise((resolve, reject) => {
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
        { name: 'kind', keyPath: 'kind' },
      ]);
      ensureObjectStore(db, PEOPLE_STORE, { keyPath: 'id' }, [
        { name: 'status', keyPath: 'status' },
        { name: 'created_at', keyPath: 'created_at' },
        { name: 'updated_at', keyPath: 'updated_at' },
      ]);
    };
  });

  return openOnce().catch(async (error) => {
    console.warn('[PWA] IndexedDB open failed, resetting local database:', error.message);
    await new Promise((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => resolve();
      deleteRequest.onblocked = () => resolve();
    });
    return openOnce();
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

function looksLikeContactText(text) {
  const content = String(text || '').trim();
  if (!content) return false;
  if (/BEGIN:VCARD/i.test(content)) return true;

  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(content);
  const hasPhone = /(?:\+?\d[\d\s().-]{6,}\d)/.test(content);
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.length <= 6 && (hasEmail || hasPhone);
}

function splitVCardBlocks(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  const matches = normalized.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi);
  return matches && matches.length ? matches.map(block => block.trim()) : [];
}

async function readFileText(file) {
  return typeof file.text === 'function' ? file.text() : '';
}

async function buildShareCapture(formData) {
  const title = getFormValue(formData, 'title');
  const text = getFormValue(formData, 'text');
  const url = getFormValue(formData, 'url');
  const files = Array.from(formData.values()).filter(value =>
    typeof File !== 'undefined' && value instanceof File && value.size > 0
  );
  const hasFiles = files.length > 0;
  const combinedText = [title, text, url].filter(Boolean).join('\n');

  const contactLikeFiles = hasFiles && files.every(file =>
    /vcard|contact/i.test(file.type || '') || /\.vcf$/i.test(file.name || '')
  );
  const contactLikeText = !hasFiles && looksLikeContactText(combinedText);

  if (hasFiles && !contactLikeFiles) {
    return null;
  }

  if (!hasFiles && !title && !text && !url) {
    return null;
  }

  if (contactLikeFiles || contactLikeText) {
    const now = new Date().toISOString();
    const payloads = [];

    if (contactLikeFiles) {
      for (const [index, file] of files.entries()) {
        const rawText = await readFileText(file);
        const blocks = splitVCardBlocks(rawText);
        if (blocks.length > 0) {
          for (const [blockIndex, block] of blocks.entries()) {
            payloads.push({
              type: 'vcard',
              format: 'vcard',
              title: file.name || title,
              text: block,
              rawText: block,
              filename: file.name,
              mimeType: file.type || 'text/vcard',
              received_at: now,
              sourceIndex: `${index}.${blockIndex}`,
            });
          }
        } else {
          payloads.push({
            type: 'vcard',
            format: 'vcard',
            title: file.name || title,
            text: rawText,
            rawText,
            filename: file.name,
            mimeType: file.type || 'text/vcard',
            received_at: now,
            sourceIndex: String(index),
          });
        }
      }
    } else {
      payloads.push({
        type: 'contact_text',
        format: 'text',
        title,
        text,
        rawText: combinedText,
        received_at: now,
        sourceIndex: '0',
      });
    }

    return {
      id: `capture-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      source: 'share_target',
      kind: 'person',
      status: 'ready_for_review',
      errorMessage: null,
      payloads,
      created_at: now,
      updated_at: now,
    };
  }

  if (hasFiles || (!title && !text && !url)) {
    return null;
  }

  const now = new Date().toISOString();
  const payloadType = url ? 'link' : 'text';

  return {
    id: `capture-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    source: 'share_target',
    kind: 'entry',
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
    const capture = await buildShareCapture(formData);

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
