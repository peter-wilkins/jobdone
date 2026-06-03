export const BUILD_ID_HEADER = 'x-jobdone-build';

export function currentBuildId(env = process.env) {
  return (
    env.VITE_BUILD_ID ||
    env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    env.VERCEL_DEPLOYMENT_ID ||
    env.VITE_DEPLOYMENT_ID ||
    'dev'
  );
}

export function registerBuildInfoHooks(fastify, { buildId = currentBuildId() } = {}) {
  fastify.addHook('onRequest', async (request, reply) => {
    reply.header(BUILD_ID_HEADER, buildId);
  });
}
