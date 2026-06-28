import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireAuth } from '../services/auth.js';
import { JOBDONE_DB_SCHEMA, jobdoneDb } from '../services/database.js';
import { parseWaterWalkDataset } from '../contracts/waterWalkDataset.js';

const DEFAULT_ALLOWED_EMAILS = ['poppetew@gmail.com', 'tcwilkins@gmail.com'];
const DEFAULT_CANDIDATES_PATH = 'local/water-walk/dewlish-candidates.json';
const DEFAULT_FARM_ID = 'dewlish';
const DEFAULT_DATASET_KIND = 'water_walk';
const CANDIDATE_THEMES = ['water_restoration', 'soil_doctor', 'syntropic_agroforestry', 'historic_water'];

function allowedEmailsFromEnv(value = process.env.JOBDONE_WATER_WALK_ALLOWED_EMAILS) {
  return String(value || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeCandidate(raw = {}) {
  const latitude = Number(raw.latitude ?? raw.lat ?? raw.centre?.[0] ?? raw.center?.[0]);
  const longitude = Number(raw.longitude ?? raw.lon ?? raw.lng ?? raw.centre?.[1] ?? raw.center?.[1]);
  const title = String(raw.title || raw.name || raw.fieldName || '').trim();
  if (!title || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const priority = ['high', 'medium', 'low', 'background'].includes(raw.priority) ? raw.priority : 'background';
  const theme = CANDIDATE_THEMES.includes(raw.theme) ? raw.theme : 'water_restoration';
  return {
    id: String(raw.id || `${title}-${latitude.toFixed(5)}-${longitude.toFixed(5)}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
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
  return {
    id: String(raw.id || `${title}-area`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
    title,
    sourceFieldName: raw.sourceFieldName || title,
    areaType: raw.areaType || 'context',
    priority: raw.priority || 'context',
    soilTextureCode: raw.soilTextureCode || null,
    soilTextureLabel: raw.soilTextureLabel || null,
    numericClayPercent: Number.isFinite(Number(raw.numericClayPercent)) ? Number(raw.numericClayPercent) : null,
    confidence: raw.confidence || 'low',
    note: raw.note || '',
    rings,
    centre: Array.isArray(raw.centre) ? raw.centre : null,
  };
}

export function normalizeCandidatePayload(payload) {
  const rawCandidates = Array.isArray(payload) ? payload : payload?.candidates;
  const candidates = (Array.isArray(rawCandidates) ? rawCandidates : [])
    .map(normalizeCandidate)
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || a.title.localeCompare(b.title));
  const areas = (Array.isArray(payload?.areas) ? payload.areas : [])
    .map(normalizeArea)
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));
  const normalized = {
    projectId: payload?.projectId || 'dewlish-water-walk',
    sourceNotes: Array.isArray(payload?.sourceNotes) ? payload.sourceNotes.map(String) : [],
    candidates,
    areas,
    unmappedClayRichFields: Array.isArray(payload?.unmappedClayRichFields) ? payload.unmappedClayRichFields.map(String) : [],
  };
  const parsed = parseWaterWalkDataset(normalized);
  if (!parsed.success) {
    throw new Error(parsed.error || 'Invalid Water Walk dataset');
  }
  return parsed.data;
}

function quoteIdent(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(value || ''))) {
    throw new Error(`Unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}

async function loadDatasetFromDb({
  db = jobdoneDb,
  schema = JOBDONE_DB_SCHEMA,
  farmId = process.env.JOBDONE_WATER_WALK_FARM_ID || DEFAULT_FARM_ID,
  datasetKind = process.env.JOBDONE_WATER_WALK_DATASET_KIND || DEFAULT_DATASET_KIND,
} = {}) {
  if (!db?.query) return null;
  const sql = `
    select payload
    from ${quoteIdent(schema)}.farm_datasets
    where farm_id = $1
      and dataset_kind = $2
    limit 1
  `;
  const { data, error } = await db.query(sql, [farmId, datasetKind]);
  if (error) return null;
  return data?.[0]?.payload ? normalizeCandidatePayload(data[0].payload) : null;
}

export async function loadCandidates({
  db = jobdoneDb,
  envJson = process.env.JOBDONE_WATER_WALK_CANDIDATES_JSON,
  filePath = process.env.JOBDONE_WATER_WALK_CANDIDATES_PATH,
} = {}) {
  const dbPayload = await loadDatasetFromDb({ db });
  if (dbPayload) return dbPayload;
  if (envJson) return normalizeCandidatePayload(JSON.parse(envJson));
  const resolvedPath = resolve(process.cwd(), filePath || DEFAULT_CANDIDATES_PATH);
  const text = await readFile(resolvedPath, 'utf8');
  return normalizeCandidatePayload(JSON.parse(text));
}

export async function registerWaterWalkRoutes(fastify, deps = {}) {
  const auth = deps.requireAuth ?? requireAuth;
  const loader = deps.loadCandidates ?? loadCandidates;
  const allowedEmails = deps.allowedEmails ?? allowedEmailsFromEnv();
  const allowed = new Set((allowedEmails.length ? allowedEmails : DEFAULT_ALLOWED_EMAILS).map(email => email.toLowerCase()));

  fastify.get('/api/water-walk/candidates', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return null;

    const email = String(user.email || '').trim().toLowerCase();
    if (!allowed.has(email)) {
      return reply.status(403).send({ error: 'Water Walk is not enabled for this account' });
    }

    try {
      const payload = await loader();
      return {
        success: true,
        projectId: payload.projectId || 'dewlish-water-walk',
        sourceNotes: payload.sourceNotes || [],
        candidates: payload.candidates || [],
        areas: payload.areas || [],
        unmappedClayRichFields: payload.unmappedClayRichFields || [],
      };
    } catch (error) {
      request.log.warn({ err: error }, 'Water Walk candidates unavailable');
      return reply.status(503).send({ error: 'Water Walk candidates are not available on this server' });
    }
  });
}
