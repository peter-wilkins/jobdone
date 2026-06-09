import { useRef, useState } from 'react';
import {
  createPendingPhotoAttachmentsFromFiles,
  preparePhotoAttachment,
} from './photoAttachmentService';

export function usePhotoAttachments(initialAttachments = []) {
  const [attachments, setAttachments] = useState(initialAttachments);
  const [error, setError] = useState('');
  const compressingIdsRef = useRef(new Set());

  const replaceAttachment = (attachmentId, updater) => {
    setAttachments(current => current.map(attachment => (
      attachment.id === attachmentId ? updater(attachment) : attachment
    )));
  };

  const compressAttachment = async (attachment) => {
    if (!attachment?.id || attachment.status !== 'pending_compression') return;
    if (compressingIdsRef.current.has(attachment.id)) return;
    compressingIdsRef.current.add(attachment.id);
    try {
      const ready = await preparePhotoAttachment(attachment);
      replaceAttachment(attachment.id, () => ready);
      setError('');
    } catch (err) {
      replaceAttachment(attachment.id, item => ({
        ...item,
        status: 'failed',
        errorMessage: err?.message || 'Could not prepare Photo.',
      }));
      setError(err?.message || 'Could not prepare Photo.');
    } finally {
      compressingIdsRef.current.delete(attachment.id);
    }
  };

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError('');
    try {
      const pending = await createPendingPhotoAttachmentsFromFiles(files, attachments);
      setAttachments(current => [...current, ...pending]);
      for (const attachment of pending) {
        void compressAttachment(attachment);
      }
    } catch (err) {
      setError(err?.message || 'Could not add Photos.');
    }
  };

  const removeAttachment = (attachmentId) => {
    setError('');
    setAttachments(current => current.filter(attachment => attachment.id !== attachmentId));
  };

  const reset = () => {
    setError('');
    setAttachments([]);
  };

  return {
    attachments,
    setAttachments,
    addFiles,
    removeAttachment,
    reset,
    error,
    setError,
  };
}
