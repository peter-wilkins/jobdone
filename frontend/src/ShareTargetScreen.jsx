import { useEffect, useState } from 'react';
import { dbService } from './services/dbService';
import { syncService } from './services/syncService';

function payloadPreview(payload) {
  if (payload.type === 'link') {
    return {
      title: payload.title || 'Shared Link',
      body: payload.url || payload.text,
    };
  }
  return {
    title: payload.title || 'Shared Text',
    body: payload.text,
  };
}

export function ShareTargetScreen({ onBack, user }) {
  const [capture, setCapture] = useState(null);
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
        created_at: capture.created_at,
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

      // Delete the capture from inbox
      await dbService.rejectCapture(capture.id);

      goHome();
    } catch (err) {
      console.error('Failed to confirm capture:', err);
      setError('Failed to save entry');
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
              <span className="text-xs text-gray-400">
                {(capture.source || 'manual').replaceAll('_', ' ')}
              </span>
            </div>

            <div className="space-y-4">
              {(capture.payloads || []).map((payload, index) => {
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
                Save this to your Timeline?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleConfirm}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing ? 'Saving...' : 'Confirm'}
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
    </div>
  );
}

function shareErrorMessage(error) {
  if (error === 'unsupported') return 'That share type is not supported yet. Share text or a link.';
  if (error === 'failed') return 'Share could not be saved. Try again.';
  return null;
}
