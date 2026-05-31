import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createV0RecallPropertyCases,
  createV0RecallSyntheticWorld,
  formatRecallPropertyFailures,
  runV0RecallProperties,
} from './recallPropertyHarness.js';

describe('V0 Recall property harness', () => {
  test('validates the synthetic Workflow Manager world against the default router', () => {
    const world = createV0RecallSyntheticWorld();
    const cases = createV0RecallPropertyCases(world);
    const result = runV0RecallProperties({ world, cases });

    assert.equal(cases.length, 6);
    assert.deepEqual(result.failures, [], formatRecallPropertyFailures(result.failures));
  });

  test('formats minimal repros when a Recall property fails', () => {
    const world = createV0RecallSyntheticWorld();
    const [testCase] = createV0RecallPropertyCases(world);
    const result = runV0RecallProperties({
      world,
      cases: [testCase],
      router: () => [{ id: 'entry-sarah-johnson' }],
    });

    assert.equal(result.failures.length > 0, true);
    assert.match(formatRecallPropertyFailures(result.failures), /entry-sarah-johnson/);
    assert.match(formatRecallPropertyFailures(result.failures), /expected_source_returned/);
  });
});
