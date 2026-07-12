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

test('Shiny image generator can call Cloudflare FLUX when selected by env', async () => {
  const seen = {};
  const fetchImpl = async (url, init) => {
    const form = init.body;
    seen.url = url;
    seen.prompt = form.get('prompt');
    seen.sourceImages = form.getAll('input_image_0');
    seen.swatches = form.getAll('input_image_1');
    seen.width = form.get('width');
    seen.height = form.get('height');
    seen.steps = form.get('steps');
    seen.auth = init.headers.Authorization;
    return {
      ok: true,
      json: async () => ({ success: true, result: { image: tinyPngBase64 } }),
    };
  };

  const env = {
    SHINY_IMAGE_PROVIDER: 'cloudflare-flux-2-dev',
    CLOUDFLARE_ACCOUNT_ID: 'acct-1',
    CLOUDFLARE_API_TOKEN: 'cf-token',
    SHINY_IMAGE_SIZE: '1024x1024',
  };
  const result = await generateShinyDesignPreview({
    sourceImage: {
      filename: 'dog.png',
      mimeType: 'image/png',
      dataBase64: tinyPngBase64,
    },
    designDirection: {
      productType: 'embossed_metal_picture',
      material: 'copper_effect',
      finish: 'natural',
      styleNotes: '',
    },
    fetchImpl,
    env,
    timeoutMs: 1000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'cloudflare-workers-ai');
  assert.equal(result.generatorVersion, 'cloudflare-workers-ai:@cf/black-forest-labs/flux-2-dev:v1');
  assert.equal(seen.url, 'https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/@cf/black-forest-labs/flux-2-dev');
  assert.match(seen.prompt, /hard constraints/);
  assert.equal(seen.sourceImages.length, 1);
  assert.equal(seen.swatches.length, 1);
  assert.equal(seen.width, '1024');
  assert.equal(seen.height, '1024');
  assert.equal(seen.steps, '25');
  assert.equal(seen.auth, 'Bearer cf-token');
  assert.equal(shinyGeneratorVersion(env), 'cloudflare-workers-ai:@cf/black-forest-labs/flux-2-dev:v1');
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
