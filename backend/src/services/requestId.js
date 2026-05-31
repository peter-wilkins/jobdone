import crypto from 'node:crypto';

const REQUEST_ID_HEADER = 'x-jobdone-request-id';
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{12,80}$/;

export function isValidRequestId(value) {
  return REQUEST_ID_PATTERN.test(String(value || ''));
}

export function createRequestId() {
  return `req_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function requestIdFromHeaders(headers = {}) {
  const incoming = headers[REQUEST_ID_HEADER];
  return isValidRequestId(incoming) ? incoming : createRequestId();
}

export function registerRequestIdHooks(fastify) {
  fastify.addHook('onRequest', async (request, reply) => {
    request.requestId = requestIdFromHeaders(request.headers);
    reply.header(REQUEST_ID_HEADER, request.requestId);
  });

  fastify.addHook('onResponse', async (request, reply) => {
    request.log.info({
      request_id: request.requestId,
      method: request.method,
      route: request.routeOptions?.url || request.routerPath || request.url,
      status: reply.statusCode,
    }, 'request_completed');
  });
}

export { REQUEST_ID_HEADER };
