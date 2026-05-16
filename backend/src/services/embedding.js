import OpenAI from 'openai';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Create an EmbeddingService bound to a given OpenAI client.
 * Allows injection of a mock client in tests.
 *
 * @param {OpenAI} client - OpenAI client instance
 * @returns {{ embedText: (text: string) => Promise<number[]> }}
 */
export function createEmbeddingService(client) {
  return {
    /**
     * Embed a single text string.
     * @param {string} text
     * @returns {Promise<number[]>} 1536-dimension vector
     */
    async embedText(text) {
      if (!text || typeof text !== 'string') {
        throw new Error('[EmbeddingService] text must be a non-empty string');
      }

      let response;
      try {
        response = await client.embeddings.create({
          model: EMBEDDING_MODEL,
          input: text,
        });
      } catch (err) {
        throw new Error(`[EmbeddingService] OpenAI API failure: ${err.message}`);
      }

      const vector = response?.data?.[0]?.embedding;

      if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `[EmbeddingService] Unexpected embedding dimensions: got ${vector?.length ?? 'undefined'}, expected ${EMBEDDING_DIMENSIONS}`
        );
      }

      return vector;
    },
  };
}

/**
 * Singleton service backed by the real OpenAI key from env.
 * Lazy-initialised — safe to import even if key is absent (tests use mock).
 */
let _defaultService = null;

export function getEmbeddingService() {
  if (!_defaultService) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('[EmbeddingService] OPENAI_API_KEY not set');
    }
    _defaultService = createEmbeddingService(new OpenAI({ apiKey }));
  }
  return _defaultService;
}
