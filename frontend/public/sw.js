const CACHE_VERSION = 'jobdone-app-shell-v4';
const DB_NAME = 'plumber-job-log';
const DB_VERSION = 15;
const ENTRIES_STORE = 'entries';
const FEEDBACK_STORE = 'feedback';
const QUERIES_STORE = 'queries';
const CAPTURES_STORE = 'captures';
const CONTEXT_CLUES_STORE = 'contextClues';
const LOCATIONS_STORE = 'locations';
const ENTRY_LOCATIONS_STORE = 'entryLocations';
const TAG_CATEGORIES_STORE = 'tagCategories';
const TAGS_STORE = 'tags';
const TAG_VOCABULARY_STORE = 'tagVocabulary';
const ENTRY_TAGS_STORE = 'entryTags';
const CONTACTS_STORE = 'contacts';
const CONTACT_ALIASES_STORE = 'contactClientAliases';
const SHARE_TARGET_PATH = '/share-target';
const MAX_SHARE_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SHARE_TOTAL_BYTES = 50 * 1024 * 1024;
const APP_SHELL = [
  '/manifest.webmanifest',
  '/manifest-staging.webmanifest',
  '/manifest-production.webmanifest',
  '/favicon.svg',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png'
];

function ensureObjectStore(db, name, options, indexes) {
  if (db.objectStoreNames.contains(name)) return null;

  const store = db.createObjectStore(name, options);
  indexes.forEach(index => ensureIndex(store, index.name, index.keyPath));
  return store;
}

function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false });
  }
}

function deleteIndexIfPresent(store, name) {
  if (store.indexNames.contains(name)) {
    store.deleteIndex(name);
  }
}

function normalizeLegacyEntryRecord(entry = {}) {
  if (!entry || typeof entry !== 'object') return entry;
  const normalized = { ...entry };
  if ('created_at' in normalized && !('createdAt' in normalized)) normalized.createdAt = normalized.created_at;
  if ('synced_at' in normalized && !('syncedAt' in normalized)) normalized.syncedAt = normalized.synced_at;
  if ('capture_id' in normalized && !('captureId' in normalized)) normalized.captureId = normalized.capture_id;
  delete normalized.created_at;
  delete normalized.synced_at;
  delete normalized.capture_id;
  return {
    ...normalized,
    captureId: normalized.captureId || null,
    syncedAt: normalized.syncedAt || null,
    locations: Array.isArray(normalized.locations) ? normalized.locations : [],
    contacts: Array.isArray(normalized.contacts) ? normalized.contacts : [],
    tags: Array.isArray(normalized.tags) ? normalized.tags : [],
    attachments: Array.isArray(normalized.attachments) ? normalized.attachments : [],
    workContexts: Array.isArray(normalized.workContexts) ? normalized.workContexts : [],
  };
}

function normalizeLegacyCaptureRecord(capture = {}) {
  if (!capture || typeof capture !== 'object') return capture;
  const normalized = { ...capture };
  if ('created_at' in normalized && !('createdAt' in normalized)) normalized.createdAt = normalized.created_at;
  if ('updated_at' in normalized && !('updatedAt' in normalized)) normalized.updatedAt = normalized.updated_at;
  delete normalized.created_at;
  delete normalized.updated_at;
  return normalized;
}

function migrateStoreRecords(store, normalize) {
  store.openCursor().onsuccess = event => {
    const cursor = event.target.result;
    if (!cursor) return;
    cursor.update(normalize(cursor.value));
    cursor.continue();
  };
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
        { name: 'createdAt', keyPath: 'createdAt' },
        { name: 'sync_status', keyPath: 'syncStatus' },
        { name: 'remoteId', keyPath: 'remoteId' },
        { name: 'captureId', keyPath: 'captureId' },
      ]);
      if (!entriesStore) {
        const existingEntriesStore = event.target.transaction.objectStore(ENTRIES_STORE);
        deleteIndexIfPresent(existingEntriesStore, 'created_at');
        ensureIndex(existingEntriesStore, 'createdAt', 'createdAt');
        ensureIndex(existingEntriesStore, 'captureId', 'captureId');
        migrateStoreRecords(existingEntriesStore, normalizeLegacyEntryRecord);
      }

      ensureObjectStore(db, FEEDBACK_STORE, { keyPath: 'id' }, [
        { name: 'status', keyPath: 'status' },
        { name: 'created_at', keyPath: 'created_at' },
      ]);
      ensureObjectStore(db, QUERIES_STORE, { keyPath: 'id' }, [
        { name: 'created_at', keyPath: 'created_at' },
        { name: 'syncStatus', keyPath: 'syncStatus' },
      ]);
      const capturesStore = ensureObjectStore(db, CAPTURES_STORE, { keyPath: 'id' }, [
        { name: 'status', keyPath: 'status' },
        { name: 'createdAt', keyPath: 'createdAt' },
        { name: 'source', keyPath: 'source' },
        { name: 'kind', keyPath: 'kind' },
      ]);
      if (!capturesStore) {
        const existingCapturesStore = event.target.transaction.objectStore(CAPTURES_STORE);
        deleteIndexIfPresent(existingCapturesStore, 'created_at');
        ensureIndex(existingCapturesStore, 'createdAt', 'createdAt');
        ensureIndex(existingCapturesStore, 'source', 'source');
        ensureIndex(existingCapturesStore, 'kind', 'kind');
        migrateStoreRecords(existingCapturesStore, normalizeLegacyCaptureRecord);
      }

      ensureObjectStore(db, CONTEXT_CLUES_STORE, { keyPath: 'id' }, [
        { name: 'captureId', keyPath: 'captureId' },
        { name: 'entryId', keyPath: 'entryId' },
        { name: 'remoteEntryId', keyPath: 'remoteEntryId' },
        { name: 'kind', keyPath: 'kind' },
        { name: 'created_at', keyPath: 'created_at' },
      ]);
      ensureObjectStore(db, LOCATIONS_STORE, { keyPath: 'id' }, [
        { name: 'status', keyPath: 'status' },
        { name: 'created_at', keyPath: 'created_at' },
        { name: 'updated_at', keyPath: 'updated_at' },
        { name: 'remoteId', keyPath: 'remoteId' },
        { name: 'normalizedDisplayName', keyPath: 'normalizedDisplayName' },
      ]);
      ensureObjectStore(db, ENTRY_LOCATIONS_STORE, { keyPath: 'id' }, [
        { name: 'entryId', keyPath: 'entryId' },
        { name: 'locationId', keyPath: 'locationId' },
        { name: 'remoteEntryId', keyPath: 'remoteEntryId' },
        { name: 'created_at', keyPath: 'created_at' },
      ]);
      ensureObjectStore(db, TAG_CATEGORIES_STORE, { keyPath: 'id' }, [
        { name: 'slug', keyPath: 'slug' },
        { name: 'created_at', keyPath: 'created_at' },
      ]);
      ensureObjectStore(db, TAGS_STORE, { keyPath: 'id' }, [
        { name: 'categoryId', keyPath: 'categoryId' },
        { name: 'normalizedLabel', keyPath: 'normalizedLabel' },
        { name: 'status', keyPath: 'status' },
        { name: 'remoteId', keyPath: 'remoteId' },
        { name: 'updated_at', keyPath: 'updated_at' },
      ]);
      ensureObjectStore(db, TAG_VOCABULARY_STORE, { keyPath: 'tagId' }, [
        { name: 'categoryId', keyPath: 'categoryId' },
        { name: 'last_used_at', keyPath: 'last_used_at' },
      ]);
      ensureObjectStore(db, ENTRY_TAGS_STORE, { keyPath: 'id' }, [
        { name: 'entryId', keyPath: 'entryId' },
        { name: 'tagId', keyPath: 'tagId' },
        { name: 'remoteEntryId', keyPath: 'remoteEntryId' },
        { name: 'created_at', keyPath: 'created_at' },
      ]);
      ensureObjectStore(db, CONTACTS_STORE, { keyPath: 'id' }, [
        { name: 'status', keyPath: 'status' },
        { name: 'created_at', keyPath: 'created_at' },
        { name: 'updated_at', keyPath: 'updated_at' },
        { name: 'primaryEmail', keyPath: 'primaryEmail' },
        { name: 'primaryPhone', keyPath: 'primaryPhone' },
      ]);
      ensureObjectStore(db, CONTACT_ALIASES_STORE, { keyPath: 'fromClientId' }, [
        { name: 'toClientId', keyPath: 'toClientId' },
        { name: 'collection', keyPath: 'collection' },
        { name: 'created_at', keyPath: 'created_at' },
      ]);
    };
  });

  return openOnce().catch((error) => {
    console.warn('[PWA] IndexedDB open failed; preserving local database:', error.message);
    throw error;
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

function describeFileType(file) {
  const mime = file.type || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf' || /\.pdf$/i.test(file.name || '')) return 'pdf';
  if (/word|document/i.test(mime) || /\.docx?$/i.test(file.name || '')) return 'document';
  if (/excel|spreadsheet/i.test(mime) || /\.xlsx?$/i.test(file.name || '')) return 'spreadsheet';
  if (mime === 'text/calendar' || /\.ics$/i.test(file.name || '')) return 'calendar';
  if (mime.startsWith('text/') || /\.(txt|csv)$/i.test(file.name || '')) return 'text_file';
  return 'file';
}

function buildUnsupportedFileCapture({ files, title, text, url, combinedText }) {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const oversizedFile = files.find(file => file.size > MAX_SHARE_FILE_BYTES);

  if (oversizedFile || totalSize > MAX_SHARE_TOTAL_BYTES) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: `capture-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    source: 'share_target',
    kind: 'unsupported_file',
    status: 'ready_for_review',
    errorMessage: 'unsupported_file',
    payloads: files.map((file, index) => ({
      type: 'unsupported_file',
      fileKind: describeFileType(file),
      title: file.name || title || `Shared file ${index + 1}`,
      text: combinedText,
      url,
      filename: file.name || '',
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      blob: file,
      received_at: now,
      sourceIndex: String(index),
    })),
    devSignal: {
      type: 'unsupported_share_target_file',
      fileCount: files.length,
      totalSize,
      mimeTypes: Array.from(new Set(files.map(file => file.type || 'unknown'))),
      extensions: Array.from(new Set(files.map(file => (file.name || '').split('.').pop() || '').filter(Boolean))),
      titlePresent: Boolean(title),
      textPresent: Boolean(text),
      urlPresent: Boolean(url),
    },
    createdAt: now,
    updatedAt: now,
  };
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
    return buildUnsupportedFileCapture({ files, title, text, url, combinedText });
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
      kind: 'contact',
      status: 'ready_for_review',
      errorMessage: null,
      payloads,
      createdAt: now,
      updatedAt: now,
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
    createdAt: now,
    updatedAt: now,
  };
}

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const capture = await buildShareCapture(formData);

    if (!capture) {
      return Response.redirect('/share-target?shareTargetError=too_large', 303);
    }

    if (capture.devSignal) {
      console.warn('[PWA] Unsupported share target captured for future handling:', capture.devSignal);
    }

    await addCapture(capture);
    return Response.redirect(`/share-target?id=${capture.id}`, 303);
  } catch (error) {
    console.warn('[PWA] Share target failed:', error);
    return Response.redirect('/share-target?shareTargetError=failed', 303);
  }
}

async function fetchAppShell(request) {
  try {
    const response = await fetch(new Request(request, { cache: 'no-store' }));
    if (response.ok) {
      const copy = response.clone();
      const cache = await caches.open(CACHE_VERSION);
      await cache.put('/index.html', copy);
    }
    return response;
  } catch {
    const cached = await caches.match('/index.html');
    return cached || Response.error();
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
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
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }

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
    event.respondWith(fetchAppShell(request));
    return;
  }

  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetchAppShell(request));
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
