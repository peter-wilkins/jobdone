import imageCompression from 'browser-image-compression';

const MAX_PHOTOS_PER_CAPTURE = 6;
const DEFAULT_MAX_EDGE = 2000;
const DEFAULT_QUALITY = 0.8;
const DEFAULT_MAX_SIZE_MB = 1.5;

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

async function copyFileToStableBlob(file) {
  const bytes = await file.arrayBuffer();
  return new Blob([bytes], { type: file.type || 'image/jpeg' });
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

export function compressPhotoAttachment(attachment, {
  maxEdge = DEFAULT_MAX_EDGE,
  quality = DEFAULT_QUALITY,
  maxSizeMB = DEFAULT_MAX_SIZE_MB,
  compressor = imageCompression,
} = {}) {
  if (!attachment?.originalBlob) {
    return Promise.reject(new Error('Original Photo is not available for compression.'));
  }

  return (async () => {
    const originalBlob = await copyFileToStableBlob(attachment.originalBlob);
    let blob = originalBlob;
    let compressionError = null;

    try {
      blob = await compressor(originalBlob, {
        maxSizeMB,
        maxWidthOrHeight: maxEdge,
        initialQuality: quality,
        useWebWorker: true,
        fileType: 'image/jpeg',
      });
    } catch (error) {
      compressionError = error?.message || 'Photo compression failed; saved original Photo instead.';
      console.warn('[Attachments] Photo compression fallback:', error);
    }

    return {
      ...attachment,
      status: 'ready',
      blob,
      mimeType: blob.type || originalBlob.type || 'image/jpeg',
      size: blob.size || originalBlob.size || 0,
      width: null,
      height: null,
      originalSize: attachment.originalSize || originalBlob.size || 0,
      originalType: attachment.originalType || originalBlob.type || '',
      originalBlob: null,
      compressed_at: new Date().toISOString(),
      compressionStatus: compressionError ? 'fallback_original' : 'compressed',
      compressionError,
    };
  })();
}

export async function preparePhotoAttachment(attachment) {
  if (!attachment?.originalBlob) {
    return Promise.reject(new Error('Original Photo is not available.'));
  }

  try {
    return await compressPhotoAttachment(attachment);
  } catch (error) {
    if (!attachment.originalBlob?.arrayBuffer) throw error;
    const blob = await copyFileToStableBlob(attachment.originalBlob);
    return {
      ...attachment,
      status: 'ready',
      blob,
      mimeType: blob.type || attachment.originalType || 'image/jpeg',
      size: blob.size || attachment.originalSize || 0,
      width: null,
      height: null,
      originalBlob: null,
      compressed_at: new Date().toISOString(),
      compressionStatus: 'fallback_original',
      compressionError: error?.message || 'Photo compression failed; saved original Photo instead.',
    };
  }
}

export async function createPendingPhotoAttachmentsFromFiles(files = [], existing = []) {
  const pending = createPendingPhotoAttachments(files, existing);
  return Promise.all(pending.map(async attachment => {
    try {
      const stableBlob = await copyFileToStableBlob(attachment.originalBlob);
      return {
        ...attachment,
        originalBlob: stableBlob,
        originalSize: attachment.originalSize || stableBlob.size || 0,
        originalType: attachment.originalType || stableBlob.type || '',
      };
    } catch (error) {
      return {
        ...attachment,
        status: 'failed',
        originalBlob: null,
        errorMessage: error?.message || 'The Photo could not be read. Try choosing it again.',
      };
    }
  }));
}

export { MAX_PHOTOS_PER_CAPTURE };
