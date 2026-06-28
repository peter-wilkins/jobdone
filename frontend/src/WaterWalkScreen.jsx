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
import { bringLayerGroupToFront } from './waterWalkLeafletLayers';
import { waterWalkSiteFromHash } from './waterWalkSites';
import { Modal } from './Modal';
import {
  GRANT_JOB_OPTIONS,
  budgetForTarget,
  budgetToForm,
  buildGrantJobBudgetRecord,
  calculateGrantJobBudget,
  formatBudgetMoney,
  grantJobOptionById,
  upsertBudget,
} from './services/waterWalkBudgetService';
import {
  LIFECYCLE_PHASE_LABELS,
  buildGrantLifecycleRecord,
  lifecycleForBudget,
  lifecycleProgress,
  toggleLifecycleTask,
  upsertLifecycle,
} from './services/waterWalkGrantLifecycleService';

const CANDIDATES_STORAGE_KEY = 'jobdone.waterWalk.candidates.v1';
const AREAS_STORAGE_KEY = 'jobdone.waterWalk.areas.v1';
const WATER_WALK_META_STORAGE_KEY = 'jobdone.waterWalk.meta.v1';
const OBSERVATIONS_STORAGE_KEY = 'jobdone.waterWalk.observations.v1';
const BUDGETS_STORAGE_KEY = 'jobdone.waterWalk.grantJobBudgets.v1';
const LIFECYCLES_STORAGE_KEY = 'jobdone.waterWalk.grantLifecycles.v1';
const WATER_WALK_EMAILS = new Set(['poppetew@gmail.com', 'tcwilkins@gmail.com']);
const ENV = import.meta.env || {};
const DEFAULT_OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const DEFAULT_MAP_VIEW = { latitude: 50.61, longitude: -2.46, zoom: 14 };
const EA_LIDAR_WMS_URL = 'https://environment.data.gov.uk/geoservices/datasets/13787b9a-26a4-4775-8523-806d13af58fc/wms';
const EA_LIDAR_HILLSHADE_LAYER = 'Lidar_Composite_Hillshade_DTM_1m';
const EA_SURFACE_WATER_FLOOD_WMS_URL = 'https://environment.data.gov.uk/geoservices/datasets/b5aaa28d-6eb9-460e-8d6f-43caa71fbe0e/wms';
const EA_SURFACE_WATER_FLOOD_LAYER = 'rofsw';
const CONTOUR_LAYER_BY_SITE = {
  dewlish: '/water-walk/dewlish-contours-2m.geojson',
};
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

const CANDIDATE_THEME = {
  water_restoration: {
    label: 'Water',
    fill: '#2563eb',
    className: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  soil_doctor: {
    label: 'Soil',
    fill: '#7c3aed',
    className: 'border-violet-200 bg-violet-50 text-violet-800',
  },
  syntropic_agroforestry: {
    label: 'Syntropic',
    fill: '#16803b',
    className: 'border-green-200 bg-green-50 text-green-800',
  },
  historic_water: {
    label: 'Historic',
    fill: '#0f766e',
    className: 'border-teal-200 bg-teal-50 text-teal-800',
  },
};

const WATER_WALK_LAYER_OPTIONS = [
  { value: 'base', label: 'Base map', lidar: false, contours: false, surfaceWater: false },
  { value: 'lidar', label: 'LiDAR hillshade', lidar: true, contours: false, surfaceWater: false },
  { value: 'contours', label: 'Contours 2m', lidar: false, contours: true, surfaceWater: false },
  { value: 'surface-water', label: 'Surface water', lidar: false, contours: false, surfaceWater: true },
  { value: 'lidar-contours', label: 'LiDAR + contours', lidar: true, contours: true, surfaceWater: false },
  { value: 'lidar-surface-water', label: 'LiDAR + surface water', lidar: true, contours: false, surfaceWater: true },
  { value: 'all', label: 'All layers', lidar: true, contours: true, surfaceWater: true },
];

function waterWalkLayerMode({ showLidarHillshade, showContours, showSurfaceWaterFloodRisk }) {
  const match = WATER_WALK_LAYER_OPTIONS.find(option => (
    option.lidar === showLidarHillshade
    && option.contours === showContours
    && option.surfaceWater === showSurfaceWaterFloodRisk
  ));
  return match?.value || 'base';
}

function mapPinIcon({ fill, selected = false, label = 'Map pin' }) {
  const size = selected ? 48 : 42;
  const pinSize = selected ? 34 : 30;
  const borderWidth = selected ? 4 : 3;
  const innerSize = selected ? 9 : 8;
  const offset = Math.round((size - pinSize) / 2);
  const borderColour = selected ? '#111827' : '#ffffff';

  return L.divIcon({
    className: 'water-walk-map-pin-icon',
    iconSize: [size, size + 10],
    iconAnchor: [Math.round(size / 2), size + 2],
    popupAnchor: [0, -(size + 2)],
    html: `
      <span aria-label="${escapeHtml(label)}" style="
        position: relative;
        display: block;
        width: ${size}px;
        height: ${size + 10}px;
      ">
        <span style="
          position: absolute;
          left: ${offset}px;
          top: ${selected ? 2 : 4}px;
          width: ${pinSize}px;
          height: ${pinSize}px;
          background: ${fill};
          border: ${borderWidth}px solid ${borderColour};
          border-radius: 50% 50% 50% 0;
          box-shadow: 0 3px 8px rgba(15, 23, 42, 0.38);
          transform: rotate(-45deg);
          transform-origin: center;
        "></span>
        <span style="
          position: absolute;
          left: ${Math.round((size - innerSize) / 2)}px;
          top: ${selected ? 14 : 15}px;
          width: ${innerSize}px;
          height: ${innerSize}px;
          background: rgba(255,255,255,0.92);
          border-radius: 999px;
          box-shadow: inset 0 0 0 1px rgba(15,23,42,0.12);
        "></span>
      </span>
    `,
  });
}

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

function siteStorageKey(baseKey, siteId) {
  return `${baseKey}.${siteId || 'dewlish'}`;
}

function storageKeysForSite(siteId) {
  return {
    candidates: siteStorageKey(CANDIDATES_STORAGE_KEY, siteId),
    areas: siteStorageKey(AREAS_STORAGE_KEY, siteId),
    meta: siteStorageKey(WATER_WALK_META_STORAGE_KEY, siteId),
    observations: siteStorageKey(OBSERVATIONS_STORAGE_KEY, siteId),
    budgets: siteStorageKey(BUDGETS_STORAGE_KEY, siteId),
    lifecycles: siteStorageKey(LIFECYCLES_STORAGE_KEY, siteId),
  };
}

function emptyDatasetForSite(site) {
  return normalizeDataset({
    projectId: site.projectId,
    sourceNotes: site.sourceNotes || [],
    candidates: [],
    areas: [],
    unmappedClayRichFields: [],
  });
}

function normalizeCandidate(raw = {}) {
  const latitude = Number(raw.latitude ?? raw.lat ?? raw.centre?.[0] ?? raw.center?.[0]);
  const longitude = Number(raw.longitude ?? raw.lon ?? raw.lng ?? raw.centre?.[1] ?? raw.center?.[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const title = String(raw.title || raw.name || raw.fieldName || '').trim();
  if (!title) return null;
  const priority = ['high', 'medium', 'low', 'background'].includes(raw.priority) ? raw.priority : 'background';
  const theme = Object.prototype.hasOwnProperty.call(CANDIDATE_THEME, raw.theme) ? raw.theme : 'water_restoration';
  return {
    id: String(raw.id || `${title}-${latitude.toFixed(5)}-${longitude.toFixed(5)}`).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title,
    latitude,
    longitude,
    priority,
    theme,
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

function loadCachedDataset(storageKeys, site) {
  try {
    return normalizeDataset({
      ...loadJsonObject(storageKeys.meta),
      projectId: loadJsonObject(storageKeys.meta).projectId || site.projectId,
      sourceNotes: loadJsonObject(storageKeys.meta).sourceNotes || site.sourceNotes || [],
      candidates: loadJsonArray(storageKeys.candidates),
      areas: loadJsonArray(storageKeys.areas),
    });
  } catch {
    return emptyDatasetForSite(site);
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

function observationLocation(observation) {
  const location = observation?.location || observation?.candidateLocation;
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    accuracyMetres: Number(location?.accuracyMetres || 0) || null,
  };
}

function budgetTargetFromCandidate(candidate) {
  if (!candidate) return null;
  return {
    type: 'candidate',
    id: candidate.id,
    title: candidate.title,
  };
}

function budgetTargetFromObservation(observation) {
  if (!observation) return null;
  return {
    type: 'observation',
    id: observation.id,
    title: observation.candidateTitle || 'Observation',
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function WaterWalkFoldableSection({
  title,
  meta = '',
  children,
  defaultOpen = false,
  className = 'border-stone-200 bg-white',
}) {
  return (
    <details open={defaultOpen} className={`water-walk-section rounded border ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold">{title}</span>
          {meta && <span className="block truncate text-sm text-gray-500">{meta}</span>}
        </span>
        <span className="water-walk-section-chevron shrink-0 text-gray-500" aria-hidden="true">›</span>
      </summary>
      <div className="border-t border-stone-100 p-4">
        {children}
      </div>
    </details>
  );
}

function BudgetSummary({ budget }) {
  if (!budget) return null;

  const judgementLabels = {
    worth_exploring: 'Worth exploring',
    needs_quote_or_adviser: 'Needs quote/adviser',
    not_worth_it: 'Not worth it',
  };

  return (
    <div className="mt-3 rounded border border-emerald-100 bg-emerald-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-emerald-950">{budget.fundingOptionName}</p>
        <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-xs font-semibold text-emerald-800">
          {judgementLabels[budget.landownerJudgement] || 'Needs review'}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-emerald-950 sm:grid-cols-4">
        <div>
          <span className="block text-emerald-700">Grant</span>
          <strong>{formatBudgetMoney(budget.grantIncomeEstimate?.amount, budget.grantIncomeEstimate?.currency)}</strong>
        </div>
        <div>
          <span className="block text-emerald-700">Cash</span>
          <strong>{formatBudgetMoney(budget.cashCostEstimate?.amount, budget.cashCostEstimate?.currency)}</strong>
        </div>
        <div>
          <span className="block text-emerald-700">Internal</span>
          <strong>{formatBudgetMoney(budget.internalCostEstimate?.amount, budget.internalCostEstimate?.currency)}</strong>
        </div>
        <div>
          <span className="block text-emerald-700">Margin</span>
          <strong>{formatBudgetMoney(budget.marginEstimate?.amount, budget.marginEstimate?.currency)}</strong>
        </div>
      </div>
      {budget.unknowns?.length > 0 && (
        <p className="mt-2 text-xs text-emerald-900">
          Biggest unknown: {budget.unknowns[0]}
        </p>
      )}
      {budget.actualMargin?.amount !== null && budget.actualMargin?.amount !== undefined && (
        <div className="mt-2 rounded border border-emerald-200 bg-white/70 px-2 py-1.5 text-xs text-emerald-950">
          Actual margin {formatBudgetMoney(budget.actualMargin.amount, budget.actualMargin.currency)}
          {budget.variance?.marginDelta !== null && budget.variance?.marginDelta !== undefined
            ? ` (${budget.variance.marginDelta >= 0 ? '+' : ''}${formatBudgetMoney(budget.variance.marginDelta, budget.actualMargin.currency)} vs estimate)`
            : ''}
        </div>
      )}
      {budget.outcomeReview?.lessonForNextTime && (
        <p className="mt-2 text-xs text-emerald-900">
          Lesson: {budget.outcomeReview.lessonForNextTime}
        </p>
      )}
    </div>
  );
}

function LifecycleSummary({ budget, lifecycle, onGenerate, onToggleTask }) {
  if (!budget) return null;

  if (!lifecycle) {
    return (
      <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-semibold text-amber-950">Grant lifecycle</p>
        <p className="mt-1 text-xs text-amber-900">
          Generate the application, agreement, delivery, claim, and maintenance checklist before treating this as real work.
        </p>
        <button
          type="button"
          onClick={() => onGenerate(budget)}
          className="mt-2 rounded border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-950"
        >
          Generate lifecycle tasks
        </button>
      </div>
    );
  }

  const progress = lifecycleProgress(lifecycle);
  const tasksByPhase = lifecycle.tasks.reduce((grouped, task) => {
    const phase = task.phase || 'other';
    return {
      ...grouped,
      [phase]: [...(grouped[phase] || []), task],
    };
  }, {});

  return (
    <details className="mt-3 rounded border border-blue-200 bg-blue-50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-blue-950">
        Grant lifecycle {progress.label}
      </summary>
      <p className="mt-2 rounded border border-blue-200 bg-white/80 p-2 text-xs font-medium text-blue-950">
        {lifecycle.caution}
      </p>
      <div className="mt-3 grid gap-3">
        {Object.entries(tasksByPhase).map(([phase, tasks]) => (
          <div key={phase} className="rounded border border-blue-100 bg-white p-2">
            <h3 className="text-xs font-semibold uppercase text-blue-800">
              {LIFECYCLE_PHASE_LABELS[phase] || phase}
            </h3>
            <div className="mt-2 grid gap-2">
              {tasks.map(task => (
                <label key={task.id} className="flex items-start gap-2 text-sm text-blue-950">
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={event => onToggleTask(lifecycle, task.id, event.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span>
                    <span className={task.completed ? 'font-medium line-through decoration-blue-500' : 'font-medium'}>
                      {task.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-blue-800">{task.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function WaterWalkMap({
  candidates,
  areas,
  observations,
  showLidarHillshade,
  showContours,
  contourGeoJson,
  showSurfaceWaterFloodRisk,
  selectedCandidate,
  selectedObservation,
  currentLocation,
  defaultView,
  onSelectCandidate,
  onSelectObservation,
}) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const overlayLayerRef = useRef(null);
  const lidarLayerRef = useRef(null);
  const contourLayerRef = useRef(null);
  const surfaceWaterFloodLayerRef = useRef(null);
  const fittedBoundsKeyRef = useRef('');
  const tileConfig = useMemo(() => waterWalkTileConfig(), []);
  const initialView = defaultView || DEFAULT_MAP_VIEW;

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
    map.setView([initialView.latitude, initialView.longitude], initialView.zoom || 14);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      overlayLayerRef.current = null;
      lidarLayerRef.current = null;
      contourLayerRef.current = null;
      surfaceWaterFloodLayerRef.current = null;
    };
  }, [initialView.latitude, initialView.longitude, initialView.zoom, tileConfig]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (showLidarHillshade && !lidarLayerRef.current) {
      lidarLayerRef.current = L.tileLayer.wms(EA_LIDAR_WMS_URL, {
        layers: EA_LIDAR_HILLSHADE_LAYER,
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        opacity: 0.58,
        attribution: 'LiDAR hillshade &copy; Environment Agency',
        crossOrigin: true,
      }).addTo(map);
      bringLayerGroupToFront(overlayLayerRef.current);
      return;
    }

    if (!showLidarHillshade && lidarLayerRef.current) {
      map.removeLayer(lidarLayerRef.current);
      lidarLayerRef.current = null;
    }
  }, [showLidarHillshade]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (contourLayerRef.current) {
      map.removeLayer(contourLayerRef.current);
      contourLayerRef.current = null;
    }

    if (!showContours || !contourGeoJson) return;

    contourLayerRef.current = L.geoJSON(contourGeoJson, {
      interactive: false,
      style: feature => {
        const elevation = Number(feature?.properties?.elevationMetres || 0);
        const major = elevation % 10 === 0;
        return {
          color: major ? '#4f3928' : '#735f4d',
          opacity: major ? 0.72 : 0.42,
          weight: major ? 1.15 : 0.7,
        };
      },
    }).addTo(map);
    bringLayerGroupToFront(overlayLayerRef.current);
  }, [contourGeoJson, showContours]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (showSurfaceWaterFloodRisk && !surfaceWaterFloodLayerRef.current) {
      surfaceWaterFloodLayerRef.current = L.tileLayer.wms(EA_SURFACE_WATER_FLOOD_WMS_URL, {
        layers: EA_SURFACE_WATER_FLOOD_LAYER,
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        opacity: 0.46,
        attribution: 'Surface water flood risk &copy; Environment Agency',
        crossOrigin: true,
      }).addTo(map);
      if (typeof contourLayerRef.current?.bringToFront === 'function') contourLayerRef.current.bringToFront();
      bringLayerGroupToFront(overlayLayerRef.current);
      return;
    }

    if (!showSurfaceWaterFloodRisk && surfaceWaterFloodLayerRef.current) {
      map.removeLayer(surfaceWaterFloodLayerRef.current);
      surfaceWaterFloodLayerRef.current = null;
    }
  }, [showSurfaceWaterFloodRisk]);

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
      const theme = CANDIDATE_THEME[candidate.theme] || CANDIDATE_THEME.water_restoration;
      const marker = L.marker([candidate.latitude, candidate.longitude], {
        icon: mapPinIcon({
          fill: theme.fill,
          selected: isSelected || candidate.priority === 'high',
          label: candidate.title,
        }),
        title: candidate.title,
      });
      marker.bindPopup(`
        <strong>${escapeHtml(candidate.title)}</strong><br />
        ${escapeHtml(theme.label)} · score ${escapeHtml(candidate.score)}<br />
        ${escapeHtml(candidate.whyInteresting.slice(0, 2).join('; '))}
      `);
      marker.on('click', () => onSelectCandidate(candidate.id));
      marker.addTo(overlayLayer);
      boundsPoints.push([candidate.latitude, candidate.longitude]);
    });

    observations.forEach(observation => {
      const location = observationLocation(observation);
      if (!location) return;
      const isSelected = observation.id === selectedObservation?.id;
      const marker = L.marker([location.latitude, location.longitude], {
        icon: mapPinIcon({
          fill: '#0f766e',
          selected: isSelected,
          label: observation.candidateTitle || 'Observation',
        }),
        title: observation.candidateTitle || 'Observation',
      });
      marker.bindPopup(`
        <strong>${escapeHtml(observation.candidateTitle || 'Observation')}</strong><br />
        ${escapeHtml(new Date(observation.createdAt).toLocaleString())}<br />
        ${escapeHtml((observation.note || '').slice(0, 120))}
      `);
      marker.on('click', () => onSelectObservation(observation.id));
      marker.addTo(overlayLayer);
      boundsPoints.push([location.latitude, location.longitude]);
    });

    if (currentLocation) {
      const accuracy = Number(currentLocation.accuracyMetres || 0);
      const locationMarker = L.marker([currentLocation.latitude, currentLocation.longitude], {
        icon: mapPinIcon({
          fill: '#f97316',
          selected: true,
          label: 'Current GPS',
        }),
        title: 'Current GPS',
      });
      locationMarker.bindPopup(`
        <strong>Current GPS</strong><br />
        ${accuracy ? `Accuracy about ${escapeHtml(Math.round(accuracy))} m` : 'Captured location'}
      `);
      locationMarker.addTo(overlayLayer);
      boundsPoints.push([currentLocation.latitude, currentLocation.longitude]);
    }

    const currentLocationKey = currentLocation
      ? `gps:${currentLocation.latitude.toFixed(6)},${currentLocation.longitude.toFixed(6)}`
      : '';
    const observationsKey = observations
      .map(observation => {
        const location = observationLocation(observation);
        return location ? `${observation.id}:${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}` : '';
      })
      .filter(Boolean)
      .join('|');
    const boundsKey = `${waterWalkBoundsKey(candidates, areas)}::${observationsKey}::${currentLocationKey}`;
    if (boundsPoints.length && boundsKey !== fittedBoundsKeyRef.current) {
      fittedBoundsKeyRef.current = boundsKey;
      map.fitBounds(L.latLngBounds(boundsPoints).pad(0.08), {
        animate: false,
        maxZoom: 16,
      });
    } else if (!boundsPoints.length && initialView) {
      const defaultKey = `default:${initialView.latitude}:${initialView.longitude}:${initialView.zoom || 14}`;
      if (defaultKey !== fittedBoundsKeyRef.current) {
        fittedBoundsKeyRef.current = defaultKey;
        map.setView([initialView.latitude, initialView.longitude], initialView.zoom || 14, {
          animate: false,
        });
      }
    }
  }, [areas, candidates, currentLocation, initialView, observations, onSelectCandidate, onSelectObservation, selectedCandidate, selectedObservation]);

  return (
    <div
      ref={mapElementRef}
      className="water-walk-map h-[58vh] min-h-[20rem] w-full max-w-full bg-stone-100 sm:h-[70vh]"
      role="application"
      aria-label="Interactive water walk map"
    />
  );
}

export function WaterWalkScreen({ routeHash, user }) {
  const site = useMemo(() => waterWalkSiteFromHash(routeHash || window.location.hash), [routeHash]);
  const storageKeys = useMemo(() => storageKeysForSite(site.id), [site.id]);
  const userEmail = String(user?.email || '').trim().toLowerCase();
  const isAllowedUser = WATER_WALK_EMAILS.has(userEmail);
  const canUseSite = !site.private || isAllowedUser;
  const [candidates, setCandidates] = useState([]);
  const [areas, setAreas] = useState([]);
  const [datasetMeta, setDatasetMeta] = useState(() => ({
    projectId: site.projectId,
    generatedAt: null,
    sourceNotes: site.sourceNotes || [],
    unmappedClayRichFields: [],
  }));
  const [observations, setObservations] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [lifecycles, setLifecycles] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedObservationId, setSelectedObservationId] = useState('');
  const [isObservationDialogOpen, setIsObservationDialogOpen] = useState(false);
  const [isBudgetDialogOpen, setIsBudgetDialogOpen] = useState(false);
  const [budgetTarget, setBudgetTarget] = useState(null);
  const [budgetForm, setBudgetForm] = useState(() => budgetToForm());
  const [budgetStatus, setBudgetStatus] = useState('');
  const [lifecycleStatus, setLifecycleStatus] = useState('');
  const [note, setNote] = useState('');
  const [photoAttachments, setPhotoAttachments] = useState([]);
  const [photoError, setPhotoError] = useState('');
  const [gpsStatus, setGpsStatus] = useState('');
  const [currentLocation, setCurrentLocation] = useState(null);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [showLidarHillshade, setShowLidarHillshade] = useState(false);
  const [showContours, setShowContours] = useState(false);
  const [contourGeoJson, setContourGeoJson] = useState(null);
  const [contourStatus, setContourStatus] = useState('');
  const [showSurfaceWaterFloodRisk, setShowSurfaceWaterFloodRisk] = useState(false);

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
    window.localStorage.setItem(storageKeys.candidates, JSON.stringify(nextDataset.candidates));
    window.localStorage.setItem(storageKeys.areas, JSON.stringify(nextDataset.areas));
    window.localStorage.setItem(storageKeys.meta, JSON.stringify(nextMeta));
  }, [storageKeys]);

  const saveObservations = nextObservations => {
    setObservations(nextObservations);
    window.localStorage.setItem(storageKeys.observations, JSON.stringify(nextObservations));
  };

  const saveBudgets = nextBudgets => {
    setBudgets(nextBudgets);
    window.localStorage.setItem(storageKeys.budgets, JSON.stringify(nextBudgets));
  };

  const saveLifecycles = nextLifecycles => {
    setLifecycles(nextLifecycles);
    window.localStorage.setItem(storageKeys.lifecycles, JSON.stringify(nextLifecycles));
  };

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSelectedId('');
      setSelectedObservationId('');
      setIsBudgetDialogOpen(false);
      setBudgetTarget(null);
      setBudgetForm(budgetToForm());
      setBudgetStatus('');
      setLifecycleStatus('');
      setImportStatus('');
      setExportStatus('');
      setShowContours(false);
      setContourGeoJson(null);
      setContourStatus('');
      setShowSurfaceWaterFloodRisk(false);
      setCurrentLocation(null);
      setGpsStatus('');
      setObservations(loadJsonArray(storageKeys.observations));
      setBudgets(loadJsonArray(storageKeys.budgets));
      setLifecycles(loadJsonArray(storageKeys.lifecycles));
    });

    if (!canUseSite) {
      queueMicrotask(() => {
        if (cancelled) return;
        setIsObservationDialogOpen(false);
        setNote('');
        setPhotoAttachments([]);
        setPhotoError('');
        setCandidates([]);
        setAreas([]);
        setDatasetMeta({
          projectId: site.projectId,
          generatedAt: null,
          sourceNotes: site.sourceNotes || [],
          unmappedClayRichFields: [],
        });
        setImportStatus(userEmail ? `${site.label} is not enabled for this account.` : `Log in as an enabled Dewlish account to load ${site.label}.`);
      });
      return () => {
        cancelled = true;
      };
    }

    const cachedDataset = loadCachedDataset(storageKeys, site);
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
        setImportStatus(`Loaded ${cachedDataset.candidates.length} cached ${site.label} pins and ${cachedDataset.areas.length} cached areas.`);
      });
    }

    if (!site.remote) {
      if (!cachedDataset.candidates.length && !cachedDataset.areas.length) {
        const localDataset = emptyDatasetForSite(site);
        queueMicrotask(() => {
          if (cancelled) return;
          saveDataset(localDataset);
          setImportStatus(`${site.label} is ready. Capture GPS to start mapping observations.`);
        });
      }
      return () => {
        cancelled = true;
      };
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
        setImportStatus(`Loaded ${loaded.candidates.length} ${site.label} pins and ${loaded.areas.length} areas from JobDone.`);
      })
      .catch(error => {
        if (!cancelled && !cachedDataset.candidates.length && !cachedDataset.areas.length) {
          setImportStatus(error?.message || 'Could not load private Water Walk dataset.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canUseSite, userEmail, saveDataset, site, storageKeys]);

  useEffect(() => {
    if (!showContours) return undefined;
    const contourUrl = CONTOUR_LAYER_BY_SITE[site.id];
    if (!contourUrl) {
      return undefined;
    }
    if (contourGeoJson) return undefined;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setContourStatus('Loading contours...');
    });
    fetch(contourUrl)
      .then(response => {
        if (!response.ok) throw new Error(`Contour layer failed: ${response.status}`);
        return response.json();
      })
      .then(payload => {
        if (cancelled) return;
        setContourGeoJson(payload);
        const interval = payload?.properties?.intervalMetres || 2;
        setContourStatus(`${interval}m contours loaded.`);
      })
      .catch(error => {
        if (cancelled) return;
        setContourStatus(error.message || 'Could not load contour layer.');
      });

    return () => {
      cancelled = true;
    };
  }, [contourGeoJson, showContours, site.id]);

  const selectedCandidate = candidates.find(candidate => candidate.id === selectedId) || null;
  const selectedObservation = observations.find(observation => observation.id === selectedObservationId) || null;
  const selectedCandidateBudgetTarget = budgetTargetFromCandidate(selectedCandidate);
  const selectedObservationBudgetTarget = budgetTargetFromObservation(selectedObservation);
  const selectedCandidateBudget = budgetForTarget(budgets, selectedCandidateBudgetTarget);
  const selectedObservationBudget = budgetForTarget(budgets, selectedObservationBudgetTarget);
  const selectedCandidateLifecycle = lifecycleForBudget(lifecycles, selectedCandidateBudget);
  const selectedObservationLifecycle = lifecycleForBudget(lifecycles, selectedObservationBudget);
  const observationTarget = selectedCandidate || (currentLocation ? {
    id: `${site.id}-gps-observation`,
    title: `${site.label} observation`,
    latitude: currentLocation.latitude,
    longitude: currentLocation.longitude,
    priority: 'background',
    theme: 'soil_doctor',
    score: 0,
    whyInteresting: ['GPS-based field note'],
    lookFor: ['soil condition', 'water movement', 'plant cover', 'microclimate', 'possible next action'],
    evidencePrompt: 'Capture photos and notes for this spot. The pin is your current GPS location.',
  } : null);
  const effectiveRouteSelection = new Set(candidates.filter(candidate => candidate.priority !== 'background').slice(0, 8).map(candidate => candidate.id));
  const selectedRouteCandidates = candidates.filter(candidate => effectiveRouteSelection.has(candidate.id));
  const routeStart = currentLocation ? { latitude: currentLocation.latitude, longitude: currentLocation.longitude } : selectedRouteCandidates[0] || null;
  const route = routeNearestNext(selectedRouteCandidates, routeStart);
  const layerMode = waterWalkLayerMode({ showLidarHillshade, showContours, showSurfaceWaterFloodRisk });

  const selectCandidate = useCallback(candidateId => {
    setSelectedId(candidateId);
    setSelectedObservationId('');
  }, []);

  const selectObservation = useCallback(observationIdValue => {
    setSelectedObservationId(observationIdValue);
    setSelectedId('');
  }, []);

  const updateBudgetForm = patch => {
    setBudgetForm(current => ({ ...current, ...patch }));
  };

  const openBudgetDialog = target => {
    if (!target) return;
    const existing = budgetForTarget(budgets, target);
    setBudgetTarget(target);
    setBudgetForm(budgetToForm(existing));
    setBudgetStatus('');
    setIsBudgetDialogOpen(true);
  };

  const saveBudget = () => {
    if (!budgetTarget) {
      setBudgetStatus('Select a pin or observation first.');
      return;
    }
    const existing = budgetForTarget(budgets, budgetTarget);
    const budget = buildGrantJobBudgetRecord({
      existing,
      site,
      target: budgetTarget,
      form: budgetForm,
    });
    saveBudgets(upsertBudget(budgets, budget));
    const existingLifecycle = lifecycleForBudget(lifecycles, existing || budget);
    if (existingLifecycle) {
      const updatedLifecycle = buildGrantLifecycleRecord({
        existing: existingLifecycle,
        site,
        budget,
      });
      saveLifecycles(upsertLifecycle(lifecycles, updatedLifecycle));
    }
    setBudgetStatus('Budget saved locally.');
    setIsBudgetDialogOpen(false);
  };

  const generateLifecycleForBudget = budget => {
    if (!budget) return;
    const existing = lifecycleForBudget(lifecycles, budget);
    const lifecycle = buildGrantLifecycleRecord({
      existing,
      site,
      budget,
    });
    saveLifecycles(upsertLifecycle(lifecycles, lifecycle));
    setLifecycleStatus(`Lifecycle tasks ready for ${budget.targetTitle}.`);
  };

  const toggleLifecycleTaskForRecord = (lifecycle, taskId, completed) => {
    const updated = toggleLifecycleTask(lifecycle, taskId, completed);
    if (!updated) return;
    saveLifecycles(upsertLifecycle(lifecycles, updated));
  };

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
    selectCandidate(nextDataset.candidates[0]?.id || '');
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
    if (!observationTarget) {
      setPhotoError('Capture GPS first, or select a pin.');
      return;
    }
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
      siteId: site.id,
      siteLabel: site.label,
      candidateId: observationTarget.id,
      candidateTitle: observationTarget.title,
      note: note.trim(),
      location: currentLocation,
      candidateLocation: {
        latitude: observationTarget.latitude,
        longitude: observationTarget.longitude,
      },
      photos: serializableAttachments(photoAttachments),
      syncStatus: 'local_only',
    };
    saveObservations([observation, ...observations]);
    setSelectedObservationId(observation.id);
    setSelectedId('');
    setCurrentLocation(null);
    setNote('');
    setPhotoAttachments([]);
    setPhotoError('');
    setIsObservationDialogOpen(false);
  };

  const selectLayerMode = mode => {
    const option = WATER_WALK_LAYER_OPTIONS.find(item => item.value === mode) || WATER_WALK_LAYER_OPTIONS[0];
    setShowLidarHillshade(option.lidar);
    setShowContours(option.contours);
    setShowSurfaceWaterFloodRisk(option.surfaceWater);
  };

  const exportObservations = async () => {
    const payload = {
      schemaVersion: 'jobdone.waterWalkExport.v1',
      exportedAt: new Date().toISOString(),
      siteId: site.id,
      siteLabel: site.label,
      projectId: datasetMeta.projectId || site.projectId,
      sourceNotes: datasetMeta.sourceNotes || [],
      candidates,
      areas,
      unmappedClayRichFields: datasetMeta.unmappedClayRichFields || [],
      observations,
      budgets,
      lifecycles,
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setExportStatus('Copied export JSON.');
    } catch {
      setExportStatus(text);
    }
  };

  const openObservationDialog = () => {
    setIsObservationDialogOpen(true);
    setPhotoError('');
    if (!selectedCandidate && !currentLocation) locateMe();
  };

  const budgetCalculation = useMemo(() => calculateGrantJobBudget(budgetForm), [budgetForm]);
  const selectedBudgetOption = grantJobOptionById(budgetForm.optionId);

  return (
    <div className="water-walk-screen min-h-screen w-full max-w-full overflow-x-hidden bg-stone-50 text-gray-900">
      <main className="grid w-full max-w-full gap-3 overflow-x-hidden px-2 py-2 sm:mx-auto sm:max-w-4xl sm:px-4">
        {!canUseSite && (
          <section className="rounded border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-base font-semibold text-amber-950">Private Water Walk</h2>
            <p className="mt-1 text-sm text-amber-900">
              {site.label} is enabled for the Dewlish accounts. Log in with an enabled account to see the private pins.
            </p>
          </section>
        )}

        {canUseSite && (
          <section className="min-w-0 overflow-hidden rounded border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2 pr-12">
                <span className="truncate text-sm font-semibold">{site.label}</span>
                {importStatus && <span className="truncate text-xs text-gray-500">{importStatus}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-medium text-gray-600">
                {Object.entries(CANDIDATE_THEME).map(([themeKey, theme]) => (
                  <span key={themeKey} className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: theme.fill }} />
                    {theme.label}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 border-t border-stone-100 pt-2 text-xs text-gray-600">
                <label htmlFor="water-walk-layer-mode" className="font-semibold text-gray-700">Layers</label>
                <select
                  id="water-walk-layer-mode"
                  value={layerMode}
                  onChange={event => selectLayerMode(event.target.value)}
                  className="max-w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-gray-800"
                >
                  {WATER_WALK_LAYER_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {(contourStatus || (showContours && !CONTOUR_LAYER_BY_SITE[site.id])) && (
                  <span className="text-[11px] text-gray-500">
                    {contourStatus || 'No contour layer for this site yet.'}
                  </span>
                )}
              </div>
            </div>
            <WaterWalkMap
              candidates={candidates}
              areas={areas}
              observations={observations}
              showLidarHillshade={showLidarHillshade}
              showContours={showContours}
              contourGeoJson={contourGeoJson}
              showSurfaceWaterFloodRisk={showSurfaceWaterFloodRisk}
              selectedCandidate={selectedCandidate}
              selectedObservation={selectedObservation}
              currentLocation={currentLocation}
              defaultView={site.defaultView}
              onSelectCandidate={selectCandidate}
              onSelectObservation={selectObservation}
            />
          </section>
        )}

        {canUseSite && (
        <WaterWalkFoldableSection title="Saved observations" meta={`${observations.length} local records`} defaultOpen>
          <div className="flex justify-end">
            <button type="button" onClick={exportObservations} className="shrink-0 rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700">
              Export
            </button>
          </div>
          {exportStatus && (
            <p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-xs text-gray-600">{exportStatus}</p>
          )}
          <div className="mt-3 grid gap-2">
            {observations.length === 0 && (
              <p className="rounded border border-dashed border-stone-200 bg-stone-50 px-3 py-3 text-sm text-gray-500">
                No observations yet. Tap a map pin or use the plus button to capture one.
              </p>
            )}
            {observations.slice(0, 8).map(observation => (
              <button
                key={observation.id}
                type="button"
                onClick={() => selectObservation(observation.id)}
                className="rounded border border-gray-100 bg-stone-50 px-3 py-2 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{observation.candidateTitle}</p>
                    <p className="text-xs text-gray-500">{new Date(observation.createdAt).toLocaleString()}</p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-500">{observation.photos?.length || 0} photos</span>
                </div>
                {observation.note && <p className="mt-2 text-sm text-gray-700">{observation.note}</p>}
                {observation.photos?.length > 0 && (
                  <div className="mt-2 flex gap-2 overflow-auto">
                    {observation.photos.map(photo => <PhotoAttachmentThumb key={photo.id} attachment={photo} />)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </WaterWalkFoldableSection>
        )}

        {canUseSite && selectedObservation && (
          <WaterWalkFoldableSection title="Observation" meta={selectedObservation.candidateTitle} defaultOpen className="border-teal-200 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="mt-1 text-xs text-gray-500">{new Date(selectedObservation.createdAt).toLocaleString()}</p>
              </div>
              <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800">
                {selectedObservation.photos?.length || 0} photos
              </span>
            </div>
            {selectedObservation.note && <p className="mt-3 text-sm text-gray-700">{selectedObservation.note}</p>}
            {selectedObservation.photos?.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-auto">
                {selectedObservation.photos.map(photo => <PhotoAttachmentThumb key={photo.id} attachment={photo} />)}
              </div>
            )}
            <BudgetSummary budget={selectedObservationBudget} />
            <LifecycleSummary
              budget={selectedObservationBudget}
              lifecycle={selectedObservationLifecycle}
              onGenerate={generateLifecycleForBudget}
              onToggleTask={toggleLifecycleTaskForRecord}
            />
            {lifecycleStatus && <p className="mt-2 text-sm text-gray-500">{lifecycleStatus}</p>}
            <button
              type="button"
              onClick={() => openBudgetDialog(selectedObservationBudgetTarget)}
              className="mt-3 rounded border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-900"
            >
              {selectedObservationBudget ? 'Edit budget' : 'Add budget'}
            </button>
          </WaterWalkFoldableSection>
        )}

        {canUseSite && observationTarget && (
          <WaterWalkFoldableSection title={observationTarget.title} meta={`Score ${observationTarget.score}`} defaultOpen={Boolean(selectedCandidate)}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${CANDIDATE_THEME[observationTarget.theme]?.className || CANDIDATE_THEME.water_restoration.className}`}>
                  {CANDIDATE_THEME[observationTarget.theme]?.label || CANDIDATE_THEME.water_restoration.label}
                </span>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${PRIORITY[observationTarget.priority]?.className || PRIORITY.background.className}`}>
                  {PRIORITY[observationTarget.priority]?.label || 'Check'}
                </span>
              </div>
            </div>
            {selectedCandidateBudgetTarget && (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openBudgetDialog(selectedCandidateBudgetTarget)}
                    className="rounded border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-900"
                  >
                    {selectedCandidateBudget ? 'Edit budget' : 'Add budget'}
                  </button>
                  {budgetStatus && <span className="self-center text-sm text-gray-500">{budgetStatus}</span>}
                </div>
                <BudgetSummary budget={selectedCandidateBudget} />
                <LifecycleSummary
                  budget={selectedCandidateBudget}
                  lifecycle={selectedCandidateLifecycle}
                  onGenerate={generateLifecycleForBudget}
                  onToggleTask={toggleLifecycleTaskForRecord}
                />
                {lifecycleStatus && <p className="mt-2 text-sm text-gray-500">{lifecycleStatus}</p>}
              </>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold uppercase text-gray-500">Why here</h3>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                  {observationTarget.whyInteresting.map(item => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase text-gray-500">Look for</h3>
                <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                  {observationTarget.lookFor.map(item => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </div>
          </WaterWalkFoldableSection>
        )}

        {canUseSite && areas.length > 0 && (
          <WaterWalkFoldableSection title="Clay-rich areas" meta={`${areas.length} areas`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="mt-1 text-sm text-gray-500">
                  Based on SMP texture code hZCL, Heavy Silty Clay Loam. The spreadsheet scan did not find numeric clay above 30%; highest numeric clay found was 25.35% in 8 Acres.
                </p>
              </div>
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
          </WaterWalkFoldableSection>
        )}

        {canUseSite && (
        <WaterWalkFoldableSection title="Route" meta="Nearest-next order from GPS">
          <div className="flex justify-end">
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
                <button type="button" onClick={() => selectCandidate(candidate.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium">{candidate.title}</span>
                  <span className="block text-xs text-gray-500">{index === 0 ? 'Start' : formatDistance(candidate.routeDistanceMetres)}</span>
                </button>
              </li>
            ))}
          </ol>
        </WaterWalkFoldableSection>
        )}

        {canUseSite && (
        <WaterWalkFoldableSection title="Import private pins">
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
        </WaterWalkFoldableSection>
        )}
      </main>

      {canUseSite && (
        <button
          type="button"
          onClick={openObservationDialog}
          className="fixed bottom-6 right-6 z-[1000] flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-white shadow-lg transition hover:bg-gray-800"
          title="Add observation"
          aria-label="Add observation"
        >
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}

      <Modal
        open={canUseSite && isObservationDialogOpen}
        title="Add observation"
        description={observationTarget?.evidencePrompt || 'Capture GPS first, then add photos and notes for this site.'}
        onClose={() => setIsObservationDialogOpen(false)}
        closeLabel="Close"
      >
            <div className="grid gap-3">
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
                showCameraButton
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
                  disabled={!observationTarget || hasPendingPhotoAttachments(photoAttachments) || hasFailedPhotoAttachments(photoAttachments)}
                  className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:bg-gray-300"
                >
                  Save observation
                </button>
              </div>
              {gpsStatus && <p className="text-sm text-gray-600">{gpsStatus}</p>}
            </div>
      </Modal>

      <Modal
        open={canUseSite && isBudgetDialogOpen}
        title="Grant job budget"
        description={budgetTarget ? `Rough estimate for ${budgetTarget.title}. Keep assumptions visible; do not fake precision.` : 'Select a pin or observation first.'}
        onClose={() => setIsBudgetDialogOpen(false)}
        closeLabel="Close"
      >
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-700">Possible grant job</span>
            <select
              value={budgetForm.optionId}
              onChange={event => updateBudgetForm({ optionId: event.target.value })}
              className="rounded border border-gray-300 px-3 py-2"
            >
              {GRANT_JOB_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-3 gap-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Quantity</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={budgetForm.quantity}
                onChange={event => updateBudgetForm({ quantity: event.target.value })}
                className="rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Cash cost</span>
              <input
                type="number"
                min="0"
                step="1"
                value={budgetForm.cashCost}
                onChange={event => updateBudgetForm({ cashCost: event.target.value })}
                className="rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Internal cost</span>
              <input
                type="number"
                min="0"
                step="1"
                value={budgetForm.internalCost}
                onChange={event => updateBudgetForm({ internalCost: event.target.value })}
                className="rounded border border-gray-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="rounded border border-stone-200 bg-stone-50 p-3">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <span className="block text-xs text-gray-500">Grant</span>
                <strong>{formatBudgetMoney(budgetCalculation.grantIncome, selectedBudgetOption.currency)}</strong>
              </div>
              <div>
                <span className="block text-xs text-gray-500">Cash</span>
                <strong>{formatBudgetMoney(budgetCalculation.cashCost, selectedBudgetOption.currency)}</strong>
              </div>
              <div>
                <span className="block text-xs text-gray-500">Internal</span>
                <strong>{formatBudgetMoney(budgetCalculation.internalCost, selectedBudgetOption.currency)}</strong>
              </div>
              <div>
                <span className="block text-xs text-gray-500">Margin</span>
                <strong>{formatBudgetMoney(budgetCalculation.margin, selectedBudgetOption.currency)}</strong>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {selectedBudgetOption.grantAmountPerUnit === null
                ? 'Grant payment is unknown in the current seed data.'
                : `Grant estimate uses ${formatBudgetMoney(selectedBudgetOption.grantAmountPerUnit, selectedBudgetOption.currency)} per ${selectedBudgetOption.unit}.`}
            </p>
          </div>

          <details className="rounded border border-blue-100 bg-blue-50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-blue-950">Actuals and learning</summary>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Actual grant</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={budgetForm.actualGrantIncome}
                  onChange={event => updateBudgetForm({ actualGrantIncome: event.target.value })}
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Actual cash</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={budgetForm.actualCashCost}
                  onChange={event => updateBudgetForm({ actualCashCost: event.target.value })}
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-gray-700">Actual internal</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={budgetForm.actualInternalCost}
                  onChange={event => updateBudgetForm({ actualInternalCost: event.target.value })}
                  className="rounded border border-gray-300 px-3 py-2"
                />
              </label>
            </div>
            <div className="mt-3 rounded border border-blue-100 bg-white p-2 text-xs text-blue-950">
              Actual margin: <strong>{formatBudgetMoney(budgetCalculation.actualMargin, selectedBudgetOption.currency)}</strong>
              {budgetCalculation.variance.marginDelta !== null && (
                <span> · Margin variance: <strong>{budgetCalculation.variance.marginDelta >= 0 ? '+' : ''}{formatBudgetMoney(budgetCalculation.variance.marginDelta, selectedBudgetOption.currency)}</strong></span>
              )}
            </div>
            <label className="mt-3 grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Lifecycle stage</span>
              <select
                value={budgetForm.lifecycleStage}
                onChange={event => updateBudgetForm({ lifecycleStage: event.target.value })}
                className="rounded border border-gray-300 px-3 py-2"
              >
                <option value="first_estimate">First estimate</option>
                <option value="planned_estimate">Planned estimate</option>
                <option value="in_progress">In progress</option>
                <option value="actuals_entered">Actuals entered</option>
                <option value="reviewed">Reviewed</option>
              </select>
            </label>
            <label className="mt-3 grid gap-1 text-sm">
              <span className="font-medium text-gray-700">What went better?</span>
              <textarea
                value={budgetForm.wentBetterText}
                onChange={event => updateBudgetForm({ wentBetterText: event.target.value })}
                rows={2}
                className="rounded border border-gray-300 px-3 py-2"
                placeholder="One per line: free material, faster access, better grant result..."
              />
            </label>
            <label className="mt-3 grid gap-1 text-sm">
              <span className="font-medium text-gray-700">What went worse?</span>
              <textarea
                value={budgetForm.wentWorseText}
                onChange={event => updateBudgetForm({ wentWorseText: event.target.value })}
                rows={2}
                className="rounded border border-gray-300 px-3 py-2"
                placeholder="One per line: extra labour, access problem, bought materials..."
              />
            </label>
            <label className="mt-3 grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Why did it differ?</span>
              <textarea
                value={budgetForm.varianceExplanation}
                onChange={event => updateBudgetForm({ varianceExplanation: event.target.value })}
                rows={2}
                className="rounded border border-gray-300 px-3 py-2"
                placeholder="Explain the difference between estimate and actual."
              />
            </label>
            <label className="mt-3 grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Lesson for next time</span>
              <textarea
                value={budgetForm.lessonForNextTime}
                onChange={event => updateBudgetForm({ lessonForNextTime: event.target.value })}
                rows={2}
                className="rounded border border-gray-300 px-3 py-2"
                placeholder="What should future budgets assume differently?"
              />
            </label>
          </details>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Confidence</span>
              <select
                value={budgetForm.confidence}
                onChange={event => updateBudgetForm({ confidence: event.target.value })}
                className="rounded border border-gray-300 px-3 py-2"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-gray-700">Judgement</span>
              <select
                value={budgetForm.landownerJudgement}
                onChange={event => updateBudgetForm({ landownerJudgement: event.target.value })}
                className="rounded border border-gray-300 px-3 py-2"
              >
                <option value="worth_exploring">Worth exploring</option>
                <option value="needs_quote_or_adviser">Needs quote/adviser</option>
                <option value="not_worth_it">Not worth it</option>
              </select>
            </label>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-700">Machinery / access</span>
            <textarea
              value={budgetForm.machineryNotes}
              onChange={event => updateBudgetForm({ machineryNotes: event.target.value })}
              rows={2}
              className="rounded border border-gray-300 px-3 py-2"
              placeholder="Farm digger, tractor access, wet ground, gate nearby..."
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-700">Labour</span>
            <textarea
              value={budgetForm.labourNotes}
              onChange={event => updateBudgetForm({ labourNotes: event.target.value })}
              rows={2}
              className="rounded border border-gray-300 px-3 py-2"
              placeholder="How many people, how many hours, contractor likely?"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-700">Materials nearby</span>
            <textarea
              value={budgetForm.materialsNotes}
              onChange={event => updateBudgetForm({ materialsNotes: event.target.value })}
              rows={2}
              className="rounded border border-gray-300 px-3 py-2"
              placeholder="Brash from woodland, stone pile, spoil use, bought materials..."
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-gray-700">Unknowns</span>
            <textarea
              value={budgetForm.unknownsText}
              onChange={event => updateBudgetForm({ unknownsText: event.target.value })}
              rows={3}
              className="rounded border border-gray-300 px-3 py-2"
              placeholder="One per line: consent, adviser support, contractor quote..."
            />
          </label>

          {budgetStatus && <p className="text-sm text-gray-600">{budgetStatus}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveBudget}
              className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white"
            >
              Save budget
            </button>
            <button
              type="button"
              onClick={() => setIsBudgetDialogOpen(false)}
              className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
