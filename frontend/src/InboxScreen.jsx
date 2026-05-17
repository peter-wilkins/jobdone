import { useEffect, useState } from 'react';
import { dbService } from './services/dbService';
import { formatTime } from './mockData';

function payloadLabel(payload) {
  if (payload.type === 'link') return payload.url || payload.title || 'Link';
  if (payload.type === 'text') return payload.text || payload.title || 'Text';
  return payload.title || payload.type || 'Payload';
}

export function InboxScreen({ onBack }) {
  const [captures, setCaptures] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCaptures() {
      try {
        const rows = await dbService.getCaptures();
        if (!cancelled) setCaptures(rows);
      } catch (err) {
        console.error('Failed to load captures:', err);
        if (!cancelled) setError('Failed to load Inbox');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadCaptures();
    return () => { cancelled = true; };
  }, []);

  const handleReject = async (captureId) => {
    try {
      setError(null);
      await dbService.rejectCapture(captureId);
      setCaptures(prev => prev.filter(capture => capture.id !== captureId));
    } catch (err) {
      console.error('Failed to reject capture:', err);
      setError('Failed to reject Capture');
    }
  };

  return (
    <div className="h-screen bg-white flex flex-col">
      <div className="border-b border-gray-200 p-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-600 transition"
          title="Back"
        >
          ←
        </button>
        <h1 className="text-2xl font-light text-gray-900">Inbox</h1>
      </div>

      {error && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6">
        {isLoading ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Loading...</p>
          </div>
        ) : captures.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">No Captures waiting for review</p>
          </div>
        ) : (
          <div className="py-2">
            {captures.map(capture => (
              <div key={capture.id} className="py-4 border-b border-gray-100 last:border-b-0">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                        Review
                      </span>
                      <span className="text-xs text-gray-400">
                        {(capture.source || 'manual').replaceAll('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{formatTime(new Date(capture.created_at))}</p>
                  </div>
                  <button
                    onClick={() => handleReject(capture.id)}
                    className="text-sm text-gray-500 hover:text-red-600 transition"
                  >
                    Reject
                  </button>
                </div>

                <div className="space-y-2">
                  {(capture.payloads || []).map((payload, index) => (
                    <div key={`${capture.id}-${index}`} className="rounded border border-gray-200 px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">{payload.type || 'Payload'}</p>
                      <p className="text-sm text-gray-900 break-words">{payloadLabel(payload)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
