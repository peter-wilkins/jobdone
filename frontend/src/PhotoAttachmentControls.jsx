import { useEffect, useMemo, useRef } from 'react';
import {
  canAddMorePhotos,
  formatAttachmentBytes,
  MAX_PHOTOS_PER_CAPTURE,
} from './services/photoAttachmentService';

export function photoAttachmentImageSrc(attachment, {
  createObjectURL = typeof URL !== 'undefined' ? URL.createObjectURL?.bind(URL) : null,
} = {}) {
  const blob = attachment?.blob || attachment?.originalBlob;
  if (blob && typeof createObjectURL === 'function') return createObjectURL(blob);
  const dataBase64 = String(attachment?.dataBase64 || '').trim();
  if (!dataBase64) return '';
  const mimeType = attachment?.mimeType || attachment?.originalType || 'image/jpeg';
  return `data:${mimeType};base64,${dataBase64}`;
}

export function PhotoAttachmentThumb({ attachment }) {
  const blob = attachment?.blob || attachment?.originalBlob;
  const src = useMemo(() => {
    return photoAttachmentImageSrc(attachment);
  }, [attachment]);

  useEffect(() => {
    if (!src || !blob) return undefined;
    return () => URL.revokeObjectURL(src);
  }, [blob, src]);

  if (!src) {
    return (
      <div className="h-12 w-12 shrink-0 rounded bg-gray-100 text-[10px] font-medium text-gray-400 flex items-center justify-center">
        Photo
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={attachment.originalName || 'Photo attachment'}
      className="h-12 w-12 shrink-0 rounded object-cover"
    />
  );
}

export function PhotoAttachmentWide({ attachment }) {
  const blob = attachment?.blob || attachment?.originalBlob;
  const src = useMemo(() => {
    return photoAttachmentImageSrc(attachment);
  }, [attachment]);

  useEffect(() => {
    if (!src || !blob) return undefined;
    return () => URL.revokeObjectURL(src);
  }, [blob, src]);

  if (!src) {
    return (
      <div className="flex min-h-40 w-full items-center justify-center rounded bg-gray-100 text-sm font-medium text-gray-400">
        Photo
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={attachment.originalName || attachment.filename || 'Photo attachment'}
      className="w-full rounded object-cover"
    />
  );
}

export function PhotoAttachmentControls({
  attachments = [],
  onAddFiles,
  onRemove,
  error = '',
  disabled = false,
}) {
  const inputRef = useRef(null);
  const photoAttachments = (attachments || []).filter(attachment => attachment.kind === 'photo');
  const canAddPhotos = canAddMorePhotos(attachments);

  return (
    <div className="min-w-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void onAddFiles?.(event.target.files);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || !canAddPhotos}
        className="inline-flex h-8 items-center rounded border border-dashed border-gray-300 px-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:border-gray-200 disabled:text-gray-400"
      >
        Photo
        <span className="ml-1 text-xs text-gray-400">{photoAttachments.length}/{MAX_PHOTOS_PER_CAPTURE}</span>
      </button>
      {photoAttachments.length > 0 && (
        <div className="mt-2 grid gap-2">
          {photoAttachments.map(attachment => (
            <div key={attachment.id} className="flex items-center gap-3 rounded border border-gray-200 bg-white px-3 py-2">
              <PhotoAttachmentThumb attachment={attachment} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{attachment.originalName || 'Photo'}</p>
                <p className={`text-xs ${attachment.status === 'failed' ? 'text-red-700' : 'text-gray-500'}`}>
                  {attachment.status === 'pending_compression'
                    ? 'Preparing Photo...'
                    : attachment.status === 'failed'
                      ? (attachment.errorMessage || 'Photo could not be prepared')
                      : formatAttachmentBytes(attachment.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove?.(attachment.id)}
                className="shrink-0 text-sm text-gray-500 underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-700">{error}</p>
      )}
    </div>
  );
}
