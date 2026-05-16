import axios from 'axios';
import { mockEmbedText } from './mocks.js';

export const EMBEDDING_MODEL = 'voyage-3-lite';
export const EMBEDDING_DIMENSIONS = 1024;

const USE_MOCK = process.env.USE_MOCK_APIS === 'true';

/**
 * Create an EmbeddingService using Voyage AI API.
 * Single HTTP POST to /v1/embeddings.
 */
export function createEmbeddingService() {
  return {
    async embedText(text) {
      if (!text || typeof text !== 'string') {
        throw new Error('[EmbeddingService] text must be a non-empty string');
      }

      if (USE_MOCK) {
        return await mockEmbedText(text);
      }

      if (!process.env.VOYAGE_API_KEY) {
        throw new Error('[EmbeddingService] VOYAGE_API_KEY not set');
      }

      const response = await axios.post(
        'https://api.voyageai.com/v1/embeddings',
        { input: text, model: EMBEDDING_MODEL },
        {
          headers: {
            'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const vector = response.data?.data?.[0]?.embedding;

      if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `[EmbeddingService] Unexpected embedding dimensions: got ${vector?.length ?? 'undefined'}, expected ${EMBEDDING_DIMENSIONS}`
        );
      }

      return vector;
    },
  };
}

let _defaultService = null;

export function getEmbeddingService() {
  if (!_defaultService) {
    _defaultService = createEmbeddingService();
  }
  return _defaultService;
}
