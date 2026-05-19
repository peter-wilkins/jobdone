import { requireAuth } from '../services/auth.js';
import { getContactLocationCooccurrences, getContacts, getLocations, getTagVocabulary } from '../services/database.js';
import {
  buildPredictionCandidateSet,
  buildStructuredPredictionRequest,
  heuristicStructurePredictor,
  normalizeStructuredPredictionResponse,
} from '../services/structurePrediction.js';

export async function registerStructureRoutes(fastify, deps = {}) {
  const auth = deps.requireAuth ?? requireAuth;
  const db = {
    getContacts: deps.getContacts ?? getContacts,
    getLocations: deps.getLocations ?? getLocations,
    getContactLocationCooccurrences: deps.getContactLocationCooccurrences ?? getContactLocationCooccurrences,
    getTagVocabulary: deps.getTagVocabulary ?? getTagVocabulary,
  };
  const predictor = deps.predictStructure ?? heuristicStructurePredictor;
  const sources = [
    { key: 'locations', label: 'Locations', load: db.getLocations },
    { key: 'contacts', label: 'Contacts', load: db.getContacts },
    { key: 'coOccurrences', label: 'Co-occurrence Clues', load: db.getContactLocationCooccurrences, optional: true },
    { key: 'tags', label: 'Tags', load: db.getTagVocabulary },
  ];

  async function loadCandidateSources(userId) {
    const results = await Promise.allSettled(
      sources.map(source => source.load(userId))
    );

    const values = {};
    const sourceStatus = {};
    let successCount = 0;

    results.forEach((result, index) => {
      const source = sources[index];
      if (result.status === 'fulfilled') {
        values[source.key] = Array.isArray(result.value) ? result.value : [];
        sourceStatus[source.key] = { ok: true };
        if (!source.optional) successCount += 1;
        return;
      }

      values[source.key] = [];
      sourceStatus[source.key] = { ok: false, error: 'source_unavailable' };
      console.warn('[Structure] Candidate source unavailable', {
        source: source.key,
        error: result.reason?.message || String(result.reason || 'unknown error'),
      });
    });

    if (successCount === 0) {
      throw new Error('All candidate sources unavailable');
    }

    return {
      locations: values.locations,
      contacts: values.contacts,
      coOccurrences: values.coOccurrences,
      tagVocabulary: values.tags,
      sourceStatus,
    };
  }

  fastify.post('/api/structure/predict', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    const { entryData, contextClues = [] } = request.body ?? {};
    if (!entryData?.summary || typeof entryData.summary !== 'string') {
      return reply.status(400).send({ error: 'entryData.summary required' });
    }

    try {
      const { locations, contacts, coOccurrences, tagVocabulary, sourceStatus } = await loadCandidateSources(user.id);

      const candidateSet = buildPredictionCandidateSet({
        entryData,
        contextClues,
        locations,
        contacts,
        coOccurrences,
        tagVocabulary,
      });
      const structuredRequest = buildStructuredPredictionRequest({ entryData, candidateSet });
      const rawPrediction = await predictor(structuredRequest);
      const prediction = normalizeStructuredPredictionResponse(rawPrediction, candidateSet);

      return { success: true, candidateSet, prediction, sourceStatus };
    } catch (error) {
      console.error('[Structure] Prediction error:', error);
      return reply.status(500).send({ error: error.message || 'Structure prediction failed' });
    }
  });
}
