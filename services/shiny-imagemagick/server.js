import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_INPUT_BYTES = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_SIZE = '1024x1024';

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
  });
  res.end(data);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function parseSize(value = DEFAULT_SIZE) {
  const match = String(value).match(/^(\d{2,4})x(\d{2,4})$/);
  if (!match) return { width: 1024, height: 1024 };
  return {
    width: Math.min(2048, Math.max(64, Number(match[1]))),
    height: Math.min(2048, Math.max(64, Number(match[2]))),
  };
}

function materialTint(material) {
  switch (material) {
    case 'copper_effect':
      return 'rgb(184,105,55)';
    case 'brass_effect':
      return 'rgb(190,150,70)';
    case 'brushed_steel_effect':
      return 'rgb(170,178,178)';
    case 'black_core_card':
      return 'rgb(45,45,45)';
    case 'kraft_card':
      return 'rgb(170,130,85)';
    case 'white_card':
      return 'rgb(232,230,220)';
    case 'coloured_core_card':
      return 'rgb(80,130,175)';
    case 'aluminium':
    default:
      return 'rgb(190,190,185)';
  }
}

export function buildMagickArgs({ inputPath, outputPath, material, size = DEFAULT_SIZE } = {}) {
  const { width, height } = parseSize(size);
  return [
    inputPath,
    '-auto-orient',
    '-resize', `${width}x${height}>`,
    '-colorspace', 'gray',
    '-shade', '135x30',
    '-level', '10%,90%',
    '-colorspace', 'HSL',
    '-channel', 'lightness',
    '-level', '20%,80%',
    '+channel',
    '-colorspace', 'sRGB',
    '-fill', materialTint(material),
    '-colorize', '35%',
    '-modulate', '100,50,100',
    outputPath,
  ];
}

function extensionForMimeType(mimeType = '') {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'jpg';
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Request too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export async function renderImage({ sourceImage, designDirection = {}, size, env = process.env, execFileImpl = execFileAsync } = {}) {
  const dataBase64 = sourceImage?.dataBase64;
  if (!dataBase64) {
    const error = new Error('sourceImage.dataBase64 is required');
    error.statusCode = 400;
    throw error;
  }

  const inputBytes = Buffer.from(dataBase64, 'base64');
  const maxInputBytes = Number(env.MAX_INPUT_BYTES || DEFAULT_MAX_INPUT_BYTES);
  if (inputBytes.length > maxInputBytes) {
    const error = new Error('Source image is too large');
    error.statusCode = 413;
    throw error;
  }

  const dir = await mkdtemp(join(tmpdir(), 'shiny-imagemagick-'));
  const inputPath = join(dir, `input.${extensionForMimeType(sourceImage.mimeType)}`);
  const outputPath = join(dir, 'output.png');
  try {
    await writeFile(inputPath, inputBytes);
    const args = buildMagickArgs({
      inputPath,
      outputPath,
      material: designDirection.material,
      size,
    });
    await execFileImpl(env.MAGICK_BIN || 'magick', args, {
      timeout: Number(env.RENDER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
      maxBuffer: 2 * 1024 * 1024,
    });
    const output = await readFile(outputPath);
    return {
      ok: true,
      provider: 'google-imagemagick',
      generatorVersion: 'google-imagemagick:v1',
      mimeType: 'image/png',
      dataBase64: output.toString('base64'),
      usage: { inputBytes: inputBytes.length, outputBytes: output.length },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function createApp({ env = process.env } = {}) {
  return createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return json(res, 200, { ok: true, service: 'shiny-imagemagick' });
      }
      if (req.method !== 'POST' || req.url !== '/render') {
        return json(res, 404, { error: 'not_found' });
      }
      if (!env.RENDER_TOKEN || !safeEqual(bearerToken(req), env.RENDER_TOKEN)) {
        return json(res, 401, { error: 'unauthorized' });
      }
      const request = await readJsonBody(req, Number(env.MAX_REQUEST_BYTES || DEFAULT_MAX_INPUT_BYTES * 2));
      const result = await renderImage({
        sourceImage: request.sourceImage,
        designDirection: request.designDirection,
        size: request.size,
        env,
      });
      return json(res, 200, result);
    } catch (error) {
      return json(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Render failed',
      });
    }
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = Number(process.env.PORT || 8080);
  createApp().listen(port, () => {
    console.log(`shiny-imagemagick listening on :${port}`);
  });
}
