import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCorsOriginValidator,
  isAllowedCorsOrigin,
  parseAllowedOrigins,
} from './cors.js';

describe('CORS policy', () => {
  test('parses configured origins with whitespace and trailing slashes', () => {
    const origins = parseAllowedOrigins(' https://frontend-jobdone1.vercel.app/ , http://localhost:5173 ');

    assert.equal(origins.has('https://frontend-jobdone1.vercel.app'), true);
    assert.equal(origins.has('http://localhost:5173'), true);
  });

  test('allows configured frontend origins and local development origins', () => {
    const origins = new Set(['https://frontend-jobdone1.vercel.app']);

    assert.equal(isAllowedCorsOrigin('https://frontend-jobdone1.vercel.app', origins), true);
    assert.equal(isAllowedCorsOrigin('http://localhost:5173', origins), true);
    assert.equal(isAllowedCorsOrigin('http://127.0.0.1:5173', origins), true);
  });

  test('allows explicit staging and production frontend aliases by default', () => {
    const origins = parseAllowedOrigins('');

    assert.equal(isAllowedCorsOrigin('https://jobdone-frontend-staging.vercel.app', origins), true);
    assert.equal(isAllowedCorsOrigin('https://jobdone-frontend-production.vercel.app', origins), true);
    assert.equal(isAllowedCorsOrigin('https://frontend-six-sage-63.vercel.app', origins), true);
  });

  test('rejects unknown browser origins', () => {
    const origins = new Set(['https://frontend-jobdone1.vercel.app']);

    assert.equal(isAllowedCorsOrigin('https://example.invalid', origins), false);
  });

  test('validator returns false for unknown origins without throwing', async () => {
    const validate = createCorsOriginValidator(new Set(['https://frontend-jobdone1.vercel.app']));

    const allowed = await new Promise((resolve, reject) => {
      validate('https://example.invalid', (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    assert.equal(allowed, false);
  });
});
