import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classify } from './classify.js';

describe('classify', () => {
  describe('QUERY detection', () => {
    it('detects "what" question', () => {
      assert.strictEqual(classify('What did I do at Mrs Jones?'), 'QUERY');
    });

    it('detects "did" question', () => {
      assert.strictEqual(classify('Did I replace that pump?'), 'QUERY');
    });

    it('detects "show me" imperative query', () => {
      assert.strictEqual(classify('Show me temporary fixes from this month'), 'QUERY');
    });

    it('detects "have I" question', () => {
      assert.strictEqual(classify('Have I been to this address before?'), 'QUERY');
    });
  });

  describe('NOTE detection', () => {
    it('detects statement about work done', () => {
      assert.strictEqual(classify('Fixed the radiator, customer declined repipe'), 'NOTE');
    });

    it('detects needs statement', () => {
      assert.strictEqual(classify('Need 15mm elbows next visit'), 'NOTE');
    });

    it('detects fix description', () => {
      assert.strictEqual(classify('Temporary fix on upstairs leak'), 'NOTE');
    });
  });

  describe('edge cases', () => {
    it('single word statement defaults to NOTE', () => {
      assert.strictEqual(classify('Radiator'), 'NOTE');
    });

    it('very short input defaults to NOTE', () => {
      assert.strictEqual(classify('Fix'), 'NOTE');
    });

    it('empty input returns NOTE', () => {
      assert.strictEqual(classify(''), 'NOTE');
    });

    it('whitespace-only input returns NOTE', () => {
      assert.strictEqual(classify('   '), 'NOTE');
    });

    it('statement starting with question word returns NOTE', () => {
      assert.strictEqual(classify('What a great job we did'), 'NOTE');
    });

    it('question word mid-sentence returns NOTE (statement context)', () => {
      assert.strictEqual(classify('I wish I knew what the problem was'), 'NOTE');
    });
  });
});