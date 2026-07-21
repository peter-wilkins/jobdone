import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMagickArgs, renderImage } from './server.js';

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

test('buildMagickArgs uses fixed arguments and never shell interpolation', () => {
  const args = buildMagickArgs({
    inputPath: '/tmp/input.png',
    outputPath: '/tmp/output.png',
    material: 'copper_effect',
    size: '512x512',
  });

  assert.deepEqual(args.slice(0, 5), ['/tmp/input.png', '-auto-orient', '-resize', '512x512>', '-colorspace']);
  assert.ok(args.includes('-shade'));
  assert.ok(args.includes('135x30'));
  assert.ok(args.includes('rgb(184,105,55)'));
  assert.equal(args.at(-1), '/tmp/output.png');
});

test('renderImage rejects oversized input before invoking ImageMagick', async () => {
  let called = false;
  await assert.rejects(
    () => renderImage({
      sourceImage: { dataBase64: tinyPngBase64 },
      designDirection: { material: 'copper_effect' },
      env: { MAX_INPUT_BYTES: '1' },
      execFileImpl: async () => {
        called = true;
      },
    }),
    /too large/
  );
  assert.equal(called, false);
});
