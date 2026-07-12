import assert from 'node:assert/strict';
import test from 'node:test';
import { generateShinyDesignPreview } from './shinyImageGenerator.js';

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('Shiny image generator loads swatches independent of process cwd', async () => {
  const seen = {};
  const fetchImpl = async (_url, init) => {
    const form = init.body;
    seen.images = form.getAll('image[]');
    seen.imagePlain = form.getAll('image');
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: tinyPngBase64 }], usage: { total_tokens: 1 } }),
    };
  };

  const result = await generateShinyDesignPreview({
    sourceImage: {
      filename: 'source.png',
      mimeType: 'image/png',
      dataBase64: tinyPngBase64,
    },
    designDirection: {
      productType: 'embossed_metal_picture',
      material: 'copper_effect',
      finish: 'natural',
      styleNotes: 'simple',
    },
    fetchImpl,
    env: { OPENAI_API_KEY: 'test-key' },
    timeoutMs: 1000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.dataBase64, tinyPngBase64);
  assert.equal(seen.images.length, 2);
  assert.equal(seen.imagePlain.length, 0);
});
