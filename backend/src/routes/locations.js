import { createAddressLookupService } from '../services/addressLookup.js';
import { checkCostlyRouteRateLimit, sendRateLimitReply } from '../services/routeRateLimit.js';

export async function registerLocationRoutes(fastify, deps = {}) {
  const addressLookup = deps.addressLookup ?? createAddressLookupService();
  const rateLimit = deps.checkCostlyRouteRateLimit ?? checkCostlyRouteRateLimit;

  fastify.get('/api/locations/lookup', async (request, reply) => {
    const query = String(request.query?.q || '').trim();
    if (query.length < 3) {
      return reply.status(400).send({ error: 'Address lookup query must be at least 3 characters' });
    }

    try {
      const limit = rateLimit(request, { routeType: 'locations_lookup' });
      if (!limit.allowed) return sendRateLimitReply(reply, limit);

      const result = await addressLookup.search(query);
      return {
        success: true,
        candidates: result.candidates || [],
        attribution: 'Address search powered by OpenStreetMap Nominatim',
      };
    } catch (error) {
      request.log.warn({ err: error }, 'Address lookup failed');
      return reply.status(502).send({ error: 'Address lookup is unavailable right now' });
    }
  });
}
