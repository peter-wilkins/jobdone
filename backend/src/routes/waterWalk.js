import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireAuth } from '../services/auth.js';

const DEFAULT_ALLOWED_EMAILS = ['poppetew@gmail.com'];
const DEFAULT_CANDIDATES_PATH = 'local/water-walk/dewlish-candidates.json';

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
  return {
    id: String(raw.id || `${title}-${latitude.toFixed(5)}-${longitude.toFixed(5)}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
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

export function normalizeCandidatePayload(payload) {
  const rawCandidates = Array.isArray(payload) ? payload : payload?.candidates;
  return (Array.isArray(rawCandidates) ? rawCandidates : [])
    .map(normalizeCandidate)
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || a.title.localeCompare(b.title));
}

async function loadCandidates({ envJson = process.env.JOBDONE_WATER_WALK_CANDIDATES_JSON, filePath = process.env.JOBDONE_WATER_WALK_CANDIDATES_PATH } = {}) {
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
      const candidates = await loader();
      return {
        success: true,
        projectId: 'dewlish-water-walk',
        candidates,
      };
    } catch (error) {
      request.log.warn({ err: error }, 'Water Walk candidates unavailable');
      return reply.status(503).send({ error: 'Water Walk candidates are not available on this server' });
    }
  });
}
