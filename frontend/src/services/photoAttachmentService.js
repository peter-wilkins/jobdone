const MAX_PHOTOS_PER_CAPTURE = 6;
const DEFAULT_MAX_EDGE = 2000;
const DEFAULT_QUALITY = 0.8;
const DECODE_RETRY_DELAYS_MS = [0, 120, 300];

function generateAttachmentId() {
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatAttachmentBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function readyPhotoAttachments(attachments = []) {
  return (attachments || []).filter(attachment => attachment?.kind === 'photo' && attachment.status === 'ready');
}

export function hasPendingPhotoAttachments(attachments = []) {
  return (attachments || []).some(attachment => attachment?.kind === 'photo' && attachment.status === 'pending_compression');
}

export function hasFailedPhotoAttachments(attachments = []) {
  return (attachments || []).some(attachment => attachment?.kind === 'photo' && attachment.status === 'failed');
}

export function createPendingPhotoAttachments(files = [], existing = []) {
  const existingCount = (existing || []).filter(attachment => attachment?.kind === 'photo').length;
  const remainingSlots = Math.max(0, MAX_PHOTOS_PER_CAPTURE - existingCount);
  const selectedFiles = Array.from(files || [])
    .filter(file => file?.type?.startsWith?.('image/'))
    .slice(0, remainingSlots);

  return selectedFiles.map(file => ({
    id: generateAttachmentId(),
    kind: 'photo',
    status: 'pending_compression',
    originalName: file.name || 'Photo',
    originalType: file.type || '',
    originalSize: file.size || 0,
    originalBlob: file,
    created_at: new Date().toISOString(),
  }));
}

export function canAddMorePhotos(attachments = []) {
  return (attachments || []).filter(attachment => attachment?.kind === 'photo').length < MAX_PHOTOS_PER_CAPTURE;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isImageDecodeError(error) {
  return /decode|decoded|source image|bitmap/i.test(error?.message || '');
}

function compressPhotoAttachmentOnce(attachment, {
  WorkerCtor,
  workerUrl,
  maxEdge,
  quality,
} = {}) {
  return new Promise((resolve, reject) => {
    const worker = new WorkerCtor(workerUrl, { type: 'module' });
    worker.onmessage = (event) => {
      const result = event.data || {};
      worker.terminate?.();
      if (!result.ok) {
        reject(new Error(result.error || 'Photo compression failed.'));
        return;
      }
      resolve({
        ...attachment,
        status: 'ready',
        blob: result.blob,
        mimeType: result.metadata?.mimeType || result.blob?.type || 'image/jpeg',
        size: result.metadata?.size || result.blob?.size || 0,
        width: result.metadata?.width || null,
        height: result.metadata?.height || null,
        originalName: result.metadata?.originalName || attachment.originalName,
        originalSize: result.metadata?.originalSize || attachment.originalSize || 0,
        originalType: result.metadata?.originalType || attachment.originalType || '',
        originalBlob: null,
        compressed_at: new Date().toISOString(),
      });
    };
    worker.onerror = (error) => {
      worker.terminate?.();
      reject(new Error(error?.message || 'Photo compression failed.'));
    };
    worker.postMessage({
      jobId: attachment.id,
      file: attachment.originalBlob,
      maxEdge,
      quality,
    });
  });
}

export function compressPhotoAttachment(attachment, {
  WorkerCtor = globalThis.Worker,
  workerUrl = new URL('../workers/photoCompression.worker.js', import.meta.url),
  maxEdge = DEFAULT_MAX_EDGE,
  quality = DEFAULT_QUALITY,
  retryDelaysMs = DECODE_RETRY_DELAYS_MS,
} = {}) {
  if (!attachment?.originalBlob) {
    return Promise.reject(new Error('Original Photo is not available for compression.'));
  }
  if (!WorkerCtor) {
    return Promise.reject(new Error('Photo compression is unavailable in this browser.'));
  }

  const delays = retryDelaysMs.length ? retryDelaysMs : [0];

  return (async () => {
    let lastError = null;
    for (let index = 0; index < delays.length; index += 1) {
      if (index > 0 && delays[index]) {
        await sleep(delays[index]);
      }
      try {
        return await compressPhotoAttachmentOnce(attachment, { WorkerCtor, workerUrl, maxEdge, quality });
      } catch (error) {
        lastError = error;
        if (!isImageDecodeError(error)) {
          throw error;
        }
      }
    }
    throw lastError || new Error('Photo compression failed.');
  })();
}

export { MAX_PHOTOS_PER_CAPTURE };
