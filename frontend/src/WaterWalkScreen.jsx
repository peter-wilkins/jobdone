import { useCallback, useEffect, useMemo, useState } from 'react';
import { PhotoAttachmentControls, PhotoAttachmentThumb } from './PhotoAttachmentControls';
import {
  createPendingPhotoAttachmentsFromFiles,
  hasFailedPhotoAttachments,
  hasPendingPhotoAttachments,
  preparePhotoAttachment,
} from './services/photoAttachmentService';
import { apiService } from './services/apiService';

const CANDIDATES_STORAGE_KEY = 'jobdone.waterWalk.candidates.v1';
const OBSERVATIONS_STORAGE_KEY = 'jobdone.waterWalk.observations.v1';
const WATER_WALK_EMAILS = new Set(['poppetew@gmail.com']);

const PRIORITY = {
  high: {
    label: 'High',
    fill: '#b91c1c',
    className: 'border-red-200 bg-red-50 text-red-800',
  },
  medium: {
    label: 'Medium',
    fill: '#c26a16',
    className: 'border-orange-200 bg-orange-50 text-orange-800',
  },
  low: {
    label: 'Low',
    fill: '#9a7b15',
    className: 'border-yellow-200 bg-yellow-50 text-yellow-800',
  },
  background: {
    label: 'Check',
    fill: '#5f6f5a',
    className: 'border-gray-200 bg-gray-50 text-gray-700',
  },
};

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function loadJsonArray(key) {
  if (typeof window === 'undefined') return [];
  const parsed = safeJsonParse(window.localStorage.getItem(key) || '[]', []);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeCandidate(raw = {}) {
  const latitude = Number(raw.latitude ?? raw.lat ?? raw.centre?.[0] ?? raw.center?.[0]);
  const longitude = Number(raw.longitude ?? raw.lon ?? raw.lng ?? raw.centre?.[1] ?? raw.center?.[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const title = String(raw.title || raw.name || raw.fieldName || '').trim();
  if (!title) return null;
  const priority = ['high', 'medium', 'low', 'background'].includes(raw.priority) ? raw.priority : 'background';
  return {
    id: String(raw.id || `${title}-${latitude.toFixed(5)}-${longitude.toFixed(5)}`).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title,
    latitude,
    longitude,
    priority,
    score: Number(raw.score || 0),
    whyInteresting: Array.isArray(raw.whyInteresting) ? raw.whyInteresting : Array.isArray(raw.clues) ? raw.clues : [],
    lookFor: Array.isArray(raw.lookFor) ? raw.lookFor : ['wet ground', 'ditches', 'runoff lines', 'erosion', 'water-holding corners'],
    evidencePrompt: raw.evidencePrompt || 'Take photos and notes that explain whether this place is interesting on the ground.',
  };
}

function normalizeCandidateList(value) {
  const raw = Array.isArray(value) ? value : value?.candidates;
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeCandidate)
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || a.title.localeCompare(b.title));
}

function boundsFor(candidates) {
  if (!candidates.length) {
    return { minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 };
  }
  const latitudes = candidates.map(candidate => candidate.latitude);
  const longitudes = candidates.map(candidate => candidate.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  return {
    minLat,
    maxLat: maxLat === minLat ? maxLat + 0.001 : maxLat,
    minLon,
    maxLon: maxLon === minLon ? maxLon + 0.001 : maxLon,
  };
}

function projectPoint(candidate, bounds) {
  const x = 8 + ((candidate.longitude - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 84;
  const y = 92 - ((candidate.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 84;
  return { x, y };
}

function distanceMetres(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const radius = 6371000;
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function formatDistance(metres) {
  if (!Number.isFinite(metres)) return '';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

function routeNearestNext(candidates, start) {
  const remaining = [...candidates];
  const route = [];
  let cursor = start || remaining[0] || null;
  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((candidate, index) => {
      const metres = distanceMetres(cursor, candidate);
      if (metres < bestDistance) {
        bestIndex = index;
        bestDistance = metres;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    route.push({ ...next, routeDistanceMetres: bestDistance });
    cursor = next;
  }
  return route;
}

function serializableAttachments(attachments = []) {
  return attachments
    .filter(attachment => attachment.kind === 'photo' && attachment.status === 'ready')
    .map(attachment => {
      const serializable = { ...attachment };
      delete serializable.blob;
      delete serializable.originalBlob;
      return serializable;
    });
}

function observationId() {
  return `water-walk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function WaterWalkScreen({ onBack, onRecord, user }) {
  const isAllowedUser = WATER_WALK_EMAILS.has(String(user?.email || '').trim().toLowerCase());
  const [candidates, setCandidates] = useState([]);
  const [observations, setObservations] = useState(() => loadJsonArray(OBSERVATIONS_STORAGE_KEY));
  const [selectedId, setSelectedId] = useState('');
  const [routeSelection, setRouteSelection] = useState(new Set());
  const [note, setNote] = useState('');
  const [photoAttachments, setPhotoAttachments] = useState([]);
  const [photoError, setPhotoError] = useState('');
  const [gpsStatus, setGpsStatus] = useState('');
  const [currentLocation, setCurrentLocation] = useState(null);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [exportStatus, setExportStatus] = useState('');

  const saveCandidates = useCallback(nextCandidates => {
    setCandidates(nextCandidates);
    window.localStorage.setItem(CANDIDATES_STORAGE_KEY, JSON.stringify(nextCandidates));
  }, []);

  const saveObservations = nextObservations => {
    setObservations(nextObservations);
    window.localStorage.setItem(OBSERVATIONS_STORAGE_KEY, JSON.stringify(nextObservations));
  };

  useEffect(() => {
    let cancelled = false;
    if (!isAllowedUser) {
      queueMicrotask(() => {
        if (cancelled) return;
        setCandidates([]);
        setImportStatus(user ? 'Water Walk is not enabled for this account.' : 'Log in as poppetew@gmail.com to load private Water Walk pins.');
      });
      return () => {
        cancelled = true;
      };
    }

    const cached = loadJsonArray(CANDIDATES_STORAGE_KEY).map(normalizeCandidate).filter(Boolean);
    if (cached.length) {
      queueMicrotask(() => {
        if (cancelled) return;
        setCandidates(cached);
        setImportStatus(`Loaded ${cached.length} cached private pins.`);
      });
    }

    apiService.getWaterWalkCandidates()
      .then(payload => {
        if (cancelled) return;
        const loaded = normalizeCandidateList(payload);
        if (!loaded.length) {
          setImportStatus('Water Walk returned no pins.');
          return;
        }
        saveCandidates(loaded);
        setImportStatus(`Loaded ${loaded.length} private pins from JobDone.`);
      })
      .catch(error => {
        if (!cancelled && !cached.length) setImportStatus(error?.message || 'Could not load private Water Walk pins.');
      });
    return () => {
      cancelled = true;
    };
  }, [isAllowedUser, user, saveCandidates]);

  const selectedCandidate = candidates.find(candidate => candidate.id === selectedId) || candidates[0] || null;
  const effectiveRouteSelection = routeSelection.size
    ? routeSelection
    : new Set(candidates.filter(candidate => candidate.priority !== 'background').slice(0, 8).map(candidate => candidate.id));
  const selectedRouteCandidates = candidates.filter(candidate => effectiveRouteSelection.has(candidate.id));
  const routeStart = currentLocation ? { latitude: currentLocation.latitude, longitude: currentLocation.longitude } : selectedRouteCandidates[0] || null;
  const route = routeNearestNext(selectedRouteCandidates, routeStart);
  const mapBounds = useMemo(() => boundsFor(candidates), [candidates]);

  const importCandidates = () => {
    const parsed = safeJsonParse(importText, null);
    const nextCandidates = normalizeCandidateList(parsed);
    if (!nextCandidates.length) {
      setImportStatus('No valid pins found. Paste an array or {"candidates": [...]} JSON.');
      return;
    }
    saveCandidates(nextCandidates);
    setSelectedId(nextCandidates[0].id);
    setRouteSelection(new Set(nextCandidates.filter(candidate => candidate.priority !== 'background').slice(0, 8).map(candidate => candidate.id)));
    setImportText('');
    setImportStatus(`Imported ${nextCandidates.length} pins.`);
  };

  const locateMe = () => {
    setGpsStatus('Getting location...');
    if (!navigator.geolocation) {
      setGpsStatus('GPS is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMetres: position.coords.accuracy || null,
          capturedAt: new Date().toISOString(),
        };
        setCurrentLocation(location);
        setGpsStatus(`GPS captured${location.accuracyMetres ? `, about ${Math.round(location.accuracyMetres)} m accuracy` : ''}.`);
      },
      error => setGpsStatus(error?.message || 'Could not get GPS.'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  const addPhotoAttachments = async files => {
    setPhotoError('');
    const pending = await createPendingPhotoAttachmentsFromFiles(files, photoAttachments);
    setPhotoAttachments(current => [...current, ...pending]);
    const prepared = await Promise.all(pending.map(async attachment => {
      try {
        return await preparePhotoAttachment(attachment);
      } catch (error) {
        return {
          ...attachment,
          status: 'failed',
          originalBlob: null,
          errorMessage: error?.message || 'Photo could not be prepared.',
        };
      }
    }));
    setPhotoAttachments(current => current.map(attachment => prepared.find(item => item.id === attachment.id) || attachment));
  };

  const removePhotoAttachment = attachmentId => {
    setPhotoAttachments(current => current.filter(attachment => attachment.id !== attachmentId));
  };

  const saveObservation = () => {
    if (!selectedCandidate) return;
    if (hasPendingPhotoAttachments(photoAttachments)) {
      setPhotoError('Wait for photos to finish preparing.');
      return;
    }
    if (hasFailedPhotoAttachments(photoAttachments)) {
      setPhotoError('Remove failed photos before saving.');
      return;
    }
    const observation = {
      schemaVersion: 'jobdone.waterWalkObservation.v1',
      id: observationId(),
      createdAt: new Date().toISOString(),
      candidateId: selectedCandidate.id,
      candidateTitle: selectedCandidate.title,
      note: note.trim(),
      location: currentLocation,
      candidateLocation: {
        latitude: selectedCandidate.latitude,
        longitude: selectedCandidate.longitude,
      },
      photos: serializableAttachments(photoAttachments),
      syncStatus: 'local_only',
    };
    saveObservations([observation, ...observations]);
    setNote('');
    setPhotoAttachments([]);
    setPhotoError('');
  };

  const toggleRouteCandidate = candidateId => {
    setRouteSelection(current => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  const exportObservations = async () => {
    const payload = {
      schemaVersion: 'jobdone.waterWalkExport.v1',
      exportedAt: new Date().toISOString(),
      candidates,
      observations,
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setExportStatus('Copied export JSON.');
    } catch {
      setExportStatus(text);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 text-gray-900">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded border border-gray-200 text-gray-600"
            title="Back"
            aria-label="Back"
          >
            ←
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-5">Water Walk</h1>
            <p className="text-xs text-gray-500">Offline notes, photos, GPS, and candidate pins</p>
          </div>
          <button
            type="button"
            onClick={onRecord}
            className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white"
          >
            Record
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl gap-4 px-4 py-4">
        {!isAllowedUser && (
          <section className="rounded border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-base font-semibold text-amber-950">Private Water Walk</h2>
            <p className="mt-1 text-sm text-amber-900">
              This page is enabled for poppetew@gmail.com. Log in with that account to see the private Dewlish pins.
            </p>
          </section>
        )}

        {isAllowedUser && (candidates.length === 0 ? (
          <section className="rounded border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-base font-semibold text-amber-950">No water-walk pins loaded</h2>
            <p className="mt-1 text-sm text-amber-900">
              {importStatus || 'Private pins have not loaded yet.'}
            </p>
          </section>
        ) : (
          <section className="overflow-hidden rounded border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-4 py-3">
              <h2 className="text-sm font-semibold">Candidate map</h2>
              <p className="text-xs text-gray-500">Simplified pin map. Use GPS and ground truth outside.</p>
            </div>
            <svg viewBox="0 0 100 100" className="block h-72 w-full bg-[#edf2e8]" role="img" aria-label="Candidate pin map">
              <rect x="0" y="0" width="100" height="100" fill="#edf2e8" />
              <path d="M5 78 C25 64, 35 70, 54 55 S75 38, 94 22" fill="none" stroke="#bfd0b8" strokeWidth="1.4" />
              <path d="M8 28 C27 20, 45 30, 65 18 S84 18, 94 12" fill="none" stroke="#d7c8a6" strokeWidth="1" strokeDasharray="2 2" />
              {candidates.map(candidate => {
                  const point = projectPoint(candidate, mapBounds);
                  const isSelected = candidate.id === selectedCandidate?.id;
                  return (
                  <g
                    key={candidate.id}
                    role="button"
                    tabIndex="0"
                      onClick={() => setSelectedId(candidate.id)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') setSelectedId(candidate.id);
                    }}
                      aria-label={candidate.title}
                    >
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={isSelected ? 4.5 : 3.2}
                        fill={PRIORITY[candidate.priority]?.fill || PRIORITY.background.fill}
                        stroke={isSelected ? '#111827' : '#ffffff'}
                        strokeWidth={isSelected ? 1.4 : 0.8}
                      />
                    {isSelected && (
                      <text x={Math.min(point.x + 4, 78)} y={Math.max(point.y - 4, 8)} fontSize="3.2" fill="#111827" fontWeight="700">
                        {candidate.title}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </section>
        ))}

        {isAllowedUser && selectedCandidate && (
          <section className="rounded border border-stone-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{selectedCandidate.title}</h2>
                <p className="mt-1 text-sm text-gray-500">Score {selectedCandidate.score}</p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${PRIORITY[selectedCandidate.priority]?.className || PRIORITY.background.className}`}>
                {PRIORITY[selectedCandidate.priority]?.label || 'Check'}
              </span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold uppercase text-gray-500">Why here</h3>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                  {selectedCandidate.whyInteresting.map(item => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase text-gray-500">Look for</h3>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                  {selectedCandidate.lookFor.map(item => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </div>
          </section>
        )}

        {isAllowedUser && (
        <section className="rounded border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Route</h2>
              <p className="text-sm text-gray-500">Nearest-next order from your GPS when available.</p>
            </div>
            <button
              type="button"
              onClick={locateMe}
              className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
            >
              Use GPS
            </button>
          </div>
          {gpsStatus && <p className="mt-2 text-sm text-gray-600">{gpsStatus}</p>}
          <ol className="mt-3 grid gap-2">
            {route.map((candidate, index) => (
              <li key={candidate.id} className="flex items-center gap-3 rounded border border-gray-100 bg-stone-50 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">{index + 1}</span>
                <button type="button" onClick={() => setSelectedId(candidate.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium">{candidate.title}</span>
                  <span className="block text-xs text-gray-500">{index === 0 ? 'Start' : formatDistance(candidate.routeDistanceMetres)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        )}

        {isAllowedUser && (
        <section className="rounded border border-stone-200 bg-white p-4">
          <h2 className="text-base font-semibold">Add observation</h2>
          <p className="mt-1 text-sm text-gray-500">{selectedCandidate?.evidencePrompt}</p>
          <div className="mt-3 grid gap-3">
            <textarea
              value={note}
              onChange={event => setNote(event.target.value)}
              rows={4}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="What did you see here?"
            />
            <PhotoAttachmentControls
              attachments={photoAttachments}
              onAddFiles={addPhotoAttachments}
              onRemove={removePhotoAttachment}
              error={photoError}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={locateMe}
                className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
              >
                Capture GPS
              </button>
              <button
                type="button"
                onClick={saveObservation}
                disabled={!selectedCandidate || hasPendingPhotoAttachments(photoAttachments) || hasFailedPhotoAttachments(photoAttachments)}
                className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:bg-gray-300"
              >
                Save observation
              </button>
            </div>
          </div>
        </section>
        )}

        {isAllowedUser && (
        <section className="rounded border border-stone-200 bg-white p-4">
          <h2 className="text-base font-semibold">Pins</h2>
          <div className="mt-3 grid gap-2">
            {candidates.map(candidate => (
              <div key={candidate.id} className="flex items-center gap-3 rounded border border-gray-100 px-3 py-2">
                <input
                  type="checkbox"
                  checked={effectiveRouteSelection.has(candidate.id)}
                  onChange={() => toggleRouteCandidate(candidate.id)}
                  className="h-4 w-4"
                  aria-label={`Include ${candidate.title} in route`}
                />
                <button type="button" onClick={() => setSelectedId(candidate.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium">{candidate.title}</span>
                  <span className="block truncate text-xs text-gray-500">{candidate.whyInteresting.slice(0, 2).join('; ')}</span>
                </button>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold ${PRIORITY[candidate.priority]?.className || PRIORITY.background.className}`}>
                  {candidate.score}
                </span>
              </div>
            ))}
          </div>
        </section>
        )}

        {isAllowedUser && (
        <section className="rounded border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Saved observations</h2>
              <p className="text-sm text-gray-500">{observations.length} local records</p>
            </div>
            <button type="button" onClick={exportObservations} className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700">
              Export
            </button>
          </div>
          {exportStatus && (
            <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-xs text-gray-600">{exportStatus}</p>
          )}
          <div className="mt-3 grid gap-2">
            {observations.slice(0, 8).map(observation => (
              <div key={observation.id} className="rounded border border-gray-100 bg-stone-50 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{observation.candidateTitle}</p>
                    <p className="text-xs text-gray-500">{new Date(observation.createdAt).toLocaleString()}</p>
                  </div>
                  <span className="text-xs text-gray-500">{observation.photos?.length || 0} photos</span>
                </div>
                {observation.note && <p className="mt-2 text-sm text-gray-700">{observation.note}</p>}
                {observation.photos?.length > 0 && (
                  <div className="mt-2 flex gap-2 overflow-auto">
                    {observation.photos.map(photo => <PhotoAttachmentThumb key={photo.id} attachment={photo} />)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
        )}

        {isAllowedUser && (
        <details className="rounded border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer text-base font-semibold">Import private pins</summary>
          <textarea
            value={importText}
            onChange={event => setImportText(event.target.value)}
            rows={8}
            className="mt-3 w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs"
            placeholder='Paste {"candidates":[...]} JSON'
          />
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={importCandidates} className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white">
              Import
            </button>
            {importStatus && <p className="text-sm text-gray-500">{importStatus}</p>}
          </div>
        </details>
        )}
      </main>
    </div>
  );
}
