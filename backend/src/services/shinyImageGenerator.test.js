import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShinyImagePrompt, generateShinyDesignPreview, shinyGeneratorVersion } from './shinyImageGenerator.js';

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('Shiny image generator loads swatches independent of process cwd', async () => {
  const seen = {};
  const fetchImpl = async (_url, init) => {
    const form = init.body;
    seen.model = form.get('model');
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
  assert.equal(result.generatorVersion, 'openai-image-edit:gpt-image-2:v1');
  assert.equal(seen.model, 'gpt-image-2');
  assert.equal(seen.images.length, 2);
  assert.equal(seen.imagePlain.length, 0);
  assert.equal(shinyGeneratorVersion(), 'openai-image-edit:gpt-image-2:v1');
});

test('Shiny image prompt forbids changing subject proportions', () => {
  const prompt = buildShinyImagePrompt({
    productType: 'embossed_metal_picture',
    material: 'copper_effect',
    finish: 'natural',
    styleNotes: 'make it shiny',
  });

  assert.match(prompt, /material translation/);
  assert.match(prompt, /hard constraints/);
  assert.match(prompt, /exact visible proportions/);
  assert.match(prompt, /fatter, thinner/);
  assert.match(prompt, /stretched, or squashed/);
  assert.match(prompt, /Do not crop, zoom, rotate, add, remove, or reshape/);
});
