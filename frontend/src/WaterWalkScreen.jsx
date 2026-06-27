import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { PhotoAttachmentControls, PhotoAttachmentThumb } from './PhotoAttachmentControls';
import {
  createPendingPhotoAttachmentsFromFiles,
  hasFailedPhotoAttachments,
  hasPendingPhotoAttachments,
  preparePhotoAttachment,
} from './services/photoAttachmentService';
import { apiService } from './services/apiService';
import { parseWaterWalkDataset } from './contracts/waterWalkDataset';
import { waterWalkBoundsKey } from './waterWalkViewport';

const CANDIDATES_STORAGE_KEY = 'jobdone.waterWalk.candidates.v1';
const AREAS_STORAGE_KEY = 'jobdone.waterWalk.areas.v1';
const WATER_WALK_META_STORAGE_KEY = 'jobdone.waterWalk.meta.v1';
const OBSERVATIONS_STORAGE_KEY = 'jobdone.waterWalk.observations.v1';
const WATER_WALK_EMAILS = new Set(['poppetew@gmail.com']);
const ENV = import.meta.env || {};
const DEFAULT_OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const OS_MAPS_LAYER = ENV.VITE_OS_MAPS_LAYER || 'Outdoor_3857';
const OS_MAPS_TILE_URL = ENV.VITE_OS_MAPS_API_KEY
  ? `https://api.os.uk/maps/raster/v1/zxy/${OS_MAPS_LAYER}/{z}/{x}/{y}.png?key=${ENV.VITE_OS_MAPS_API_KEY}`
  : '';

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

function loadJsonObject(key) {
  if (typeof window === 'undefined') return {};
  const parsed = safeJsonParse(window.localStorage.getItem(key) || '{}', {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
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

function normalizeArea(raw = {}) {
  const title = String(raw.title || raw.name || raw.fieldName || '').trim();
  const rings = Array.isArray(raw.rings) ? raw.rings
    .map(ring => Array.isArray(ring)
      ? ring
        .map(point => {
          const latitude = Number(point?.[0]);
          const longitude = Number(point?.[1]);
          return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null;
        })
        .filter(Boolean)
      : [])
    .filter(ring => ring.length >= 3)
    : [];
  if (!title || !rings.length) return null;
  const centre = Array.isArray(raw.centre)
    ? [Number(raw.centre[0]), Number(raw.centre[1])]
    : null;
  return {
    id: String(raw.id || `${title}-area`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    title,
    sourceFieldName: raw.sourceFieldName || title,
    areaType: raw.areaType || 'context',
    priority: raw.priority || 'context',
    soilTextureCode: raw.soilTextureCode || null,
    soilTextureLabel: raw.soilTextureLabel || null,
    numericClayPercent: Number.isFinite(Number(raw.numericClayPercent)) ? Number(raw.numericClayPercent) : null,
    confidence: ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'low',
    note: raw.note || '',
    rings,
    centre: centre?.every(Number.isFinite) ? centre : null,
  };
}

function normalizeAreaList(value) {
  const raw = Array.isArray(value) ? value : value?.areas;
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeArea)
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));
}

function waterWalkTileConfig() {
  if (ENV.VITE_WATER_WALK_TILE_URL) {
    return {
      url: ENV.VITE_WATER_WALK_TILE_URL,
      attribution: ENV.VITE_WATER_WALK_TILE_ATTRIBUTION || DEFAULT_OSM_ATTRIBUTION,
      maxZoom: Number(ENV.VITE_WATER_WALK_TILE_MAX_ZOOM || 19),
    };
  }

  if (OS_MAPS_TILE_URL) {
    return {
      url: OS_MAPS_TILE_URL,
      attribution: ENV.VITE_OS_MAPS_ATTRIBUTION || 'Contains OS data &copy; Crown copyright and database rights',
      maxZoom: Number(ENV.VITE_OS_MAPS_MAX_ZOOM || 20),
    };
  }

  return {
    url: DEFAULT_OSM_TILE_URL,
    attribution: DEFAULT_OSM_ATTRIBUTION,
    maxZoom: 19,
  };
}

function normalizeDataset(value) {
  const dataset = {
    projectId: value?.projectId || 'dewlish-water-walk',
    generatedAt: value?.generatedAt,
    sourceNotes: Array.isArray(value?.sourceNotes) ? value.sourceNotes.map(String) : [],
    candidates: normalizeCandidateList(value),
    areas: normalizeAreaList(value),
    unmappedClayRichFields: Array.isArray(value?.unmappedClayRichFields) ? value.unmappedClayRichFields.map(String) : [],
  };
  const parsed = parseWaterWalkDataset(dataset);
  if (!parsed.success) throw new Error(parsed.error || 'Invalid Water Walk dataset');
  return parsed.data;
}

function loadCachedDataset() {
  try {
    return normalizeDataset({
      ...loadJsonObject(WATER_WALK_META_STORAGE_KEY),
      candidates: loadJsonArray(CANDIDATES_STORAGE_KEY),
      areas: loadJsonArray(AREAS_STORAGE_KEY),
    });
  } catch {
    return normalizeDataset({ candidates: [], areas: [] });
  }
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function WaterWalkMap({ candidates, areas, selectedCandidate, onSelectCandidate }) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const overlayLayerRef = useRef(null);
  const fittedBoundsKeyRef = useRef('');
  const tileConfig = useMemo(() => waterWalkTileConfig(), []);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return undefined;

    const map = L.map(mapElementRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: true,
    });
    L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attribution,
      crossOrigin: true,
      maxZoom: tileConfig.maxZoom,
    }).addTo(map);
    overlayLayerRef.current = L.layerGroup().addTo(map);
    map.setView([51.5, -0.12], 13);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      overlayLayerRef.current = null;
    };
  }, [tileConfig]);

  useEffect(() => {
    const map = mapRef.current;
    const overlayLayer = overlayLayerRef.current;
    if (!map || !overlayLayer) return;

    overlayLayer.clearLayers();
    const boundsPoints = [];

    areas.forEach(area => {
      const colour = area.areaType === 'clay_rich_texture_class' ? '#7c3f1d' : '#315f72';
      const polygon = L.polygon(area.rings, {
        color: colour,
        fillColor: colour,
        fillOpacity: area.areaType === 'clay_rich_texture_class' ? 0.18 : 0.10,
        opacity: 0.78,
        weight: 1,
      });
      polygon.bindPopup(`
        <strong>${escapeHtml(area.title)}</strong><br />
        ${escapeHtml(area.soilTextureCode || 'area')} ${escapeHtml(area.soilTextureLabel || '')}<br />
        ${escapeHtml(area.note || '')}
      `);
      polygon.addTo(overlayLayer);
      area.rings.flat().forEach(point => boundsPoints.push(point));
    });

    candidates.forEach(candidate => {
      const isSelected = candidate.id === selectedCandidate?.id;
      const marker = L.circleMarker([candidate.latitude, candidate.longitude], {
        radius: isSelected ? 7 : 4.5,
        color: isSelected ? '#111827' : '#ffffff',
        fillColor: PRIORITY[candidate.priority]?.fill || PRIORITY.background.fill,
        fillOpacity: 0.95,
        weight: isSelected ? 2 : 1,
      });
      marker.bindPopup(`
        <strong>${escapeHtml(candidate.title)}</strong><br />
        Score ${escapeHtml(candidate.score)}<br />
        ${escapeHtml(candidate.whyInteresting.slice(0, 2).join('; '))}
      `);
      marker.on('click', () => onSelectCandidate(candidate.id));
      marker.addTo(overlayLayer);
      boundsPoints.push([candidate.latitude, candidate.longitude]);
    });

    const boundsKey = waterWalkBoundsKey(candidates, areas);
    if (boundsPoints.length && boundsKey !== fittedBoundsKeyRef.current) {
      fittedBoundsKeyRef.current = boundsKey;
      map.fitBounds(L.latLngBounds(boundsPoints).pad(0.08), {
        animate: false,
        maxZoom: 16,
      });
    }
  }, [areas, candidates, onSelectCandidate, selectedCandidate]);

  return (
    <div
      ref={mapElementRef}
      className="h-[22rem] w-full bg-stone-100 sm:h-[28rem]"
      role="application"
      aria-label="Interactive water walk map"
    />
  );
}

export function WaterWalkScreen({ onBack, onRecord, user }) {
  const isAllowedUser = WATER_WALK_EMAILS.has(String(user?.email || '').trim().toLowerCase());
  const [candidates, setCandidates] = useState([]);
  const [areas, setAreas] = useState([]);
  const [datasetMeta, setDatasetMeta] = useState(() => loadJsonObject(WATER_WALK_META_STORAGE_KEY));
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

  const saveDataset = useCallback(dataset => {
    const nextDataset = normalizeDataset(dataset);
    const nextMeta = {
      projectId: nextDataset.projectId,
      generatedAt: nextDataset.generatedAt || null,
      sourceNotes: nextDataset.sourceNotes,
      unmappedClayRichFields: nextDataset.unmappedClayRichFields,
    };
    setCandidates(nextDataset.candidates);
    setAreas(nextDataset.areas);
    setDatasetMeta(nextMeta);
    window.localStorage.setItem(CANDIDATES_STORAGE_KEY, JSON.stringify(nextDataset.candidates));
    window.localStorage.setItem(AREAS_STORAGE_KEY, JSON.stringify(nextDataset.areas));
    window.localStorage.setItem(WATER_WALK_META_STORAGE_KEY, JSON.stringify(nextMeta));
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
        setAreas([]);
        setImportStatus(user ? 'Water Walk is not enabled for this account.' : 'Log in as poppetew@gmail.com to load private Water Walk pins.');
      });
      return () => {
        cancelled = true;
      };
    }

    const cachedDataset = loadCachedDataset();
    if (cachedDataset.candidates.length || cachedDataset.areas.length) {
      queueMicrotask(() => {
        if (cancelled) return;
        setCandidates(cachedDataset.candidates);
        setAreas(cachedDataset.areas);
        setDatasetMeta({
          projectId: cachedDataset.projectId,
          generatedAt: cachedDataset.generatedAt || null,
          sourceNotes: cachedDataset.sourceNotes,
          unmappedClayRichFields: cachedDataset.unmappedClayRichFields,
        });
        setImportStatus(`Loaded ${cachedDataset.candidates.length} cached private pins and ${cachedDataset.areas.length} cached areas.`);
      });
    }

    apiService.getWaterWalkCandidates()
      .then(payload => {
        if (cancelled) return;
        const loaded = normalizeDataset(payload);
        if (!loaded.candidates.length && !loaded.areas.length) {
          setImportStatus('Water Walk returned no pins or areas.');
          return;
        }
        saveDataset(loaded);
        setImportStatus(`Loaded ${loaded.candidates.length} private pins and ${loaded.areas.length} areas from JobDone.`);
      })
      .catch(error => {
        if (!cancelled && !cachedDataset.candidates.length && !cachedDataset.areas.length) {
          setImportStatus(error?.message || 'Could not load private Water Walk dataset.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAllowedUser, user, saveDataset]);

  const selectedCandidate = candidates.find(candidate => candidate.id === selectedId) || candidates[0] || null;
  const effectiveRouteSelection = routeSelection.size
    ? routeSelection
    : new Set(candidates.filter(candidate => candidate.priority !== 'background').slice(0, 8).map(candidate => candidate.id));
  const selectedRouteCandidates = candidates.filter(candidate => effectiveRouteSelection.has(candidate.id));
  const routeStart = currentLocation ? { latitude: currentLocation.latitude, longitude: currentLocation.longitude } : selectedRouteCandidates[0] || null;
  const route = routeNearestNext(selectedRouteCandidates, routeStart);

  const importCandidates = () => {
    const parsed = safeJsonParse(importText, null);
    let nextDataset;
    try {
      nextDataset = normalizeDataset(parsed);
    } catch (error) {
      setImportStatus(error?.message || 'Invalid Water Walk JSON.');
      return;
    }
    if (!nextDataset.candidates.length && !nextDataset.areas.length) {
      setImportStatus('No valid pins or areas found. Paste {"candidates":[...],"areas":[...]} JSON.');
      return;
    }
    saveDataset(nextDataset);
    setSelectedId(nextDataset.candidates[0]?.id || '');
    setRouteSelection(new Set(nextDataset.candidates.filter(candidate => candidate.priority !== 'background').slice(0, 8).map(candidate => candidate.id)));
    setImportText('');
    setImportStatus(`Imported ${nextDataset.candidates.length} pins and ${nextDataset.areas.length} areas.`);
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
      projectId: datasetMeta.projectId || 'dewlish-water-walk',
      sourceNotes: datasetMeta.sourceNotes || [],
      candidates,
      areas,
      unmappedClayRichFields: datasetMeta.unmappedClayRichFields || [],
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

        {isAllowedUser && (candidates.length === 0 && areas.length === 0 ? (
          <section className="rounded border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-base font-semibold text-amber-950">No water-walk pins loaded</h2>
            <p className="mt-1 text-sm text-amber-900">
              {importStatus || 'Private Water Walk data has not loaded yet.'}
            </p>
          </section>
        ) : (
          <section className="overflow-hidden rounded border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-4 py-3">
              <h2 className="text-sm font-semibold">Candidate map</h2>
              <p className="text-xs text-gray-500">OpenStreetMap base layer with private pins and clay-rich areas.</p>
            </div>
            <WaterWalkMap
              candidates={candidates}
              areas={areas}
              selectedCandidate={selectedCandidate}
              onSelectCandidate={setSelectedId}
            />
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

        {isAllowedUser && areas.length > 0 && (
          <section className="rounded border border-stone-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Clay-rich areas</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Based on SMP texture code hZCL, Heavy Silty Clay Loam. The spreadsheet scan did not find numeric clay above 30%; highest numeric clay found was 25.35% in 8 Acres.
                </p>
              </div>
              <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-semibold text-stone-700">
                {areas.length} areas
              </span>
            </div>
            {datasetMeta.sourceNotes?.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-gray-600">
                {datasetMeta.sourceNotes.map(noteText => <li key={noteText}>{noteText}</li>)}
              </ul>
            )}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {areas.map(area => (
                <div key={area.id} className="rounded border border-stone-100 bg-stone-50 px-3 py-2">
                  <p className="text-sm font-medium">{area.title}</p>
                  <p className="mt-1 text-xs text-gray-500">{area.soilTextureCode || 'texture'} {area.soilTextureLabel || ''}</p>
                  {area.note && <p className="mt-1 text-xs text-gray-600">{area.note}</p>}
                </div>
              ))}
            </div>
            {datasetMeta.unmappedClayRichFields?.length > 0 && (
              <details className="mt-3 rounded border border-amber-100 bg-amber-50 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-amber-950">
                  {datasetMeta.unmappedClayRichFields.length} clay-rich fields not mapped yet
                </summary>
                <p className="mt-1 text-xs text-amber-900">
                  These appeared in the SMP texture data but did not match the available KML field names cleanly.
                </p>
                <p className="mt-2 text-xs text-amber-900">{datasetMeta.unmappedClayRichFields.join(', ')}</p>
              </details>
            )}
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
            placeholder='Paste {"candidates":[...],"areas":[...]} JSON'
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
