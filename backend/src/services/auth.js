import { supabase } from './database.js';

/**
 * Validate the Bearer JWT in the Authorization header.
 * Returns the Supabase user on success, or sends a 401 and returns null.
 */
export async function requireAuth(request, reply) {
  const header = request.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Authorization required' });
    return null;
  }

  if (!supabase) {
    reply.status(503).send({ error: 'Auth service not configured' });
    return null;
  }

  const token = header.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    reply.status(401).send({ error: 'Invalid or expired token' });
    return null;
  }

  return user;
}

/**
 * Validate a Bearer JWT when present.
 * Returns null for anonymous requests without writing a response.
 */
export async function optionalAuth(request, reply) {
  const header = request.headers.authorization;

  if (!header?.startsWith('Bearer ')) return null;

  return requireAuth(request, reply);
}
