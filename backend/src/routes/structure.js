import { requireAuth } from '../services/auth.js';
import { getContacts, getLocations, getTagVocabulary } from '../services/database.js';
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
    getTagVocabulary: deps.getTagVocabulary ?? getTagVocabulary,
  };
  const predictor = deps.predictStructure ?? heuristicStructurePredictor;

  fastify.post('/api/structure/predict', async (request, reply) => {
    const user = await auth(request, reply);
    if (!user) return;

    const { entryData, contextClues = [] } = request.body ?? {};
    if (!entryData?.summary || typeof entryData.summary !== 'string') {
      return reply.status(400).send({ error: 'entryData.summary required' });
    }

    try {
      const [locations, contacts, tagVocabulary] = await Promise.all([
        db.getLocations(user.id),
        db.getContacts(user.id),
        db.getTagVocabulary(user.id),
      ]);

      const candidateSet = buildPredictionCandidateSet({
        entryData,
        contextClues,
        locations,
        contacts,
        tagVocabulary,
      });
      const structuredRequest = buildStructuredPredictionRequest({ entryData, candidateSet });
      const rawPrediction = await predictor(structuredRequest);
      const prediction = normalizeStructuredPredictionResponse(rawPrediction, candidateSet);

      return { success: true, candidateSet, prediction };
    } catch (error) {
      console.error('[Structure] Prediction error:', error);
      return reply.status(500).send({ error: error.message || 'Structure prediction failed' });
    }
  });
}
