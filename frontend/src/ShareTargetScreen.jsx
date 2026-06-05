import { useEffect, useState } from 'react';
import { dbService } from './services/dbService';
import { syncService } from './services/syncService';
import { syncOrchestratorService } from './services/syncOrchestratorService';
import { parseContactPayload, buildContactSummary, summarizeContactConflicts, getContactIdentity } from './services/contactParser';
import { FloatingRecordButton } from './FloatingRecordButton';

function payloadPreview(payload) {
  if (payload.type === 'unsupported_file') {
    return {
      title: payload.title || payload.filename || 'Shared File',
      body: [
        payload.filename,
        payload.mimeType,
        payload.size ? formatBytes(payload.size) : null,
      ].filter(Boolean).join(' • '),
    };
  }
  if (payload.type === 'link') {
    return {
      title: payload.title || 'Shared Link',
      body: payload.url || payload.text,
    };
  }
  if (payload.type === 'vcard' || payload.type === 'contact_text' || payload.format === 'vcard') {
    return {
      title: payload.title || 'Shared Contact',
      body: payload.rawText || payload.text || 'Contact payload',
    };
  }
  return {
    title: payload.title || 'Shared Text',
    body: payload.text,
  };
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isUnsupportedCapture(capture) {
  return capture?.kind === 'unsupported_file' ||
    (capture?.payloads || []).some(payload => payload.type === 'unsupported_file');
}

async function loadContactDrafts(capture) {
  const drafts = [];
  const seen = new Set();

  for (const [index, payload] of (capture.payloads || []).entries()) {
    const candidates = parseContactPayload(payload);
    if (candidates.length === 0) {
      drafts.push({
        identity: `fallback-${capture.id}-${index}`,
        payloadIndex: index,
        payload,
        displayName: payload.title || 'Shared contact',
        phones: [],
        emails: [],
        normalizedPhones: [],
        normalizedEmails: [],
        organization: '',
        title: '',
        note: '',
        existing: null,
        conflicts: [],
      });
      continue;
    }

    for (const candidate of candidates) {
      const identity = getContactIdentity(candidate) || `fallback-${capture.id}-${index}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      const matches = await dbService.findContactsByContactKeys(candidate);
      const existing = matches[0] || null;
      drafts.push({
        ...candidate,
        identity,
        payloadIndex: index,
        payload,
        existing,
        conflicts: summarizeContactConflicts(existing, candidate),
      });
    }
  }

  return drafts;
}

export function ShareTargetScreen({ onBack, onRecord, user }) {
  const [capture, setCapture] = useState(null);
  const [contactDrafts, setContactDrafts] = useState([]);
  const captureId = new URLSearchParams(window.location.search).get('id');
  const shareTargetError = new URLSearchParams(window.location.search).get('shareTargetError');
  const routeError = shareErrorMessage(shareTargetError) || (!captureId ? 'No capture ID provided' : null);

  const [error, setError] = useState(routeError);
  const [isLoading, setIsLoading] = useState(!routeError);
  const [isProcessing, setIsProcessing] = useState(false);

  const goHome = () => {
    window.history.replaceState({}, '', '/');
    onBack();
  };

  useEffect(() => {
    if (routeError) return;
    let cancelled = false;

    async function loadCapture() {
      try {
        const row = await dbService.getCapture(captureId);
        if (!cancelled) {
          if (!row) {
            setError('Capture not found');
          } else {
            setCapture(row);
            if (isContactCapture(row)) {
              const drafts = await loadContactDrafts(row);
              if (!cancelled) setContactDrafts(drafts);
            } else {
              if (!cancelled) setContactDrafts([]);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load capture:', err);
        if (!cancelled) setError('Failed to load capture');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadCapture();
    return () => { cancelled = true; };
  }, [captureId, routeError]);

  const handleConfirm = async () => {
    if (!capture) return;

    setIsProcessing(true);
    setError(null);

    try {
      if (isUnsupportedCapture(capture)) {
        console.warn('[ShareTarget] Unsupported shared file kept for future handling:', {
          captureId: capture.id,
          devSignal: capture.devSignal,
          payloads: (capture.payloads || []).map(payload => ({
            type: payload.type,
            fileKind: payload.fileKind,
            filename: payload.filename,
            mimeType: payload.mimeType,
            size: payload.size,
          })),
        });
        setError('This share type has been saved locally, but JobDone cannot turn it into an Entry yet.');
        setIsProcessing(false);
        return;
      }

      if (isContactCapture(capture)) {
        const drafts = contactDrafts.length > 0 ? contactDrafts : await loadContactDrafts(capture);
        if (drafts.length === 0) {
          throw new Error('No contact payload in capture');
        }

        const savedContacts = [];
        for (const draft of drafts) {
          const savedContact = await dbService.upsertContact({
            displayName: draft.displayName,
            givenName: draft.givenName,
            familyName: draft.familyName,
            organization: draft.organization,
            title: draft.title,
            note: draft.note,
            phones: draft.phones,
            emails: draft.emails,
            normalizedPhones: draft.normalizedPhones,
            normalizedEmails: draft.normalizedEmails,
            sourceCaptureIds: [capture.id],
          });
          savedContacts.push(savedContact);
        }

        if (user && savedContacts.length) {
          try {
            const result = await syncOrchestratorService.syncContactsAfterLocalChange();
            if (result && result.ok === false) {
              console.warn('[ShareTarget] Contact sync failed, contact saved locally:', result.issues);
            }
          } catch (syncErr) {
            console.warn('[ShareTarget] Contact sync failed, contact saved locally:', syncErr);
          }
        }
      } else {
        // Create Entry from Capture payloads
        const payload = capture.payloads?.[0];
        if (!payload) {
          throw new Error('No payload in capture');
        }

        const preview = payloadPreview(payload);
        const entryId = await dbService.createEntryFromCapture({
          captureId: capture.id,
          transcript: preview.body,
          summary: preview.title,
          createdAt: capture.createdAt || capture.created_at,
        });

        // Get the created entry for optional sync
        const entry = await dbService.getEntry(entryId);

        // Try sync if logged in
        if (user && entry) {
          try {
            const result = await syncService.syncEntry(entry);
            if (result?.entry?.id) {
              await dbService.markEntrySynced(entryId, result.entry.id);
            }
          } catch (syncErr) {
            console.warn('[ShareTarget] Sync failed, entry saved locally:', syncErr);
          }
        }
      }

      // Delete the capture from inbox
      await dbService.rejectCapture(capture.id);

      goHome();
    } catch (err) {
      console.error('Failed to confirm capture:', err);
      setError(isContactCapture(capture) ? 'Failed to save contact' : 'Failed to save entry');
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!capture) return;

    setIsProcessing(true);
    setError(null);

    try {
      await dbService.rejectCapture(capture.id);
      goHome();
    } catch (err) {
      console.error('Failed to reject capture:', err);
      setError('Failed to reject capture');
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen bg-white flex flex-col">
        <div className="border-b border-gray-200 p-6 flex items-center gap-4">
          <button
            onClick={goHome}
            className="text-gray-400 hover:text-gray-600 transition"
            title="Back"
          >
            ←
          </button>
          <h1 className="text-2xl font-light text-gray-900">Review Share</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-400 text-sm">Loading...</p>
        </div>
        <FloatingRecordButton onRecord={onRecord} />
      </div>
    );
  }

  return (
    <div className="h-screen bg-white flex flex-col">
      <div className="border-b border-gray-200 p-6 flex items-center gap-4">
        <button
          onClick={goHome}
          className="text-gray-400 hover:text-gray-600 transition"
          title="Back"
        >
          ←
        </button>
        <h1 className="text-2xl font-light text-gray-900">Review Share</h1>
      </div>

      {error && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {!capture ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Capture not found</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                Review
              </span>
              {isContactCapture(capture) && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                  Contact
                </span>
              )}
              <span className="text-xs text-gray-400">
                {(capture.source || 'manual').replaceAll('_', ' ')}
              </span>
            </div>

            {isContactCapture(capture) && contactDrafts.some(draft => draft.conflicts.length > 0) && (
              <div className="rounded border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-900 mb-2">Potential updates found</p>
                <p className="text-sm text-amber-800">
                  Matching contacts already exist. Review the contact cards below before confirming.
                </p>
              </div>
            )}

            {isUnsupportedCapture(capture) && (
              <div className="rounded border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm font-medium text-blue-900 mb-2">Not supported yet</p>
                <p className="text-sm text-blue-800">
                  JobDone captured this shared file locally so we can see what users are trying to share, but it cannot be saved to the Timeline yet.
                </p>
              </div>
            )}

            <div className="space-y-4">
              {isContactCapture(capture)
                ? contactDrafts.map((draft, index) => (
                    <div key={`${capture.id}-${draft.identity}-${index}`} className="rounded border border-gray-200 p-4">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <p className="text-base font-medium text-gray-900">{draft.displayName || 'Shared contact'}</p>
                        <span className="text-xs text-gray-400">Contact {index + 1}</span>
                      </div>
                      <p className="text-sm text-gray-600 break-words">{buildContactSummary(draft) || 'No contact details parsed'}</p>
                      {draft.conflicts.length > 0 && (
                        <div className="mt-3 rounded bg-amber-50 border border-amber-200 p-3">
                          <p className="text-xs font-medium text-amber-900 mb-2">Conflicts</p>
                          <div className="space-y-2">
                            {draft.conflicts.map(conflict => (
                              <div key={conflict.field} className="text-xs text-amber-900">
                                <span className="font-medium capitalize">{conflict.field}:</span>
                                <span className="ml-1">existing "{conflict.existing}" vs incoming "{conflict.incoming}"</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                : (capture.payloads || []).map((payload, index) => {
                    const preview = payloadPreview(payload);
                    return (
                      <div key={`${capture.id}-${index}`} className="rounded border border-gray-200 p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">
                          {payload.type || 'Payload'}
                        </p>
                        <p className="text-base font-medium text-gray-900 mb-2">{preview.title}</p>
                        <p className="text-sm text-gray-600 break-words">{preview.body}</p>
                      </div>
                    );
                  })}
            </div>

            <div className="pt-4">
              <p className="text-sm text-gray-500 mb-4">
                {isContactCapture(capture)
                  ? 'Save these contacts?'
                  : 'Save this to your Timeline?'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleConfirm}
                  disabled={isProcessing || isUnsupportedCapture(capture)}
                  className="flex-1 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing
                    ? 'Saving...'
                    : isUnsupportedCapture(capture)
                      ? 'Not supported yet'
                      : isContactCapture(capture)
                      ? 'Save Contacts'
                      : 'Confirm'}
                </button>
                <button
                  onClick={handleReject}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <FloatingRecordButton onRecord={onRecord} />
    </div>
  );
}

function shareErrorMessage(error) {
  if (error === 'unsupported') return 'That share type is not supported yet. Share text, a link, or a contact.';
  if (error === 'too_large') return 'That share is too large for JobDone to capture right now.';
  if (error === 'failed') return 'Share could not be saved. Try again.';
  return null;
}

function inferCaptureKind(capture) {
  return (capture.payloads || []).some(payload =>
    ['vcard', 'contact_text', 'contact'].includes(payload.type) || payload.format === 'vcard'
  ) ? 'contact' : 'entry';
}

function isContactCapture(capture) {
  const kind = capture?.kind || inferCaptureKind(capture);
  return kind === 'contact' || kind === 'person';
}
