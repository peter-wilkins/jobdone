import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGrantLifecycleRecord,
  lifecycleForBudget,
  lifecycleProgress,
  toggleLifecycleTask,
  upsertLifecycle,
} from './waterWalkGrantLifecycleService.js';

const site = { id: 'dewlish', label: 'Dewlish' };
const smallDamBudget = {
  id: 'budget-1',
  targetType: 'candidate',
  targetId: 'pin-1',
  targetTitle: 'Wet ditch',
  fundingOptionId: 'uk-england.capital-grants-2026/rp32-small-leaky-woody-dams',
  fundingOptionName: 'RP32 small leaky woody dam',
};

test('grant lifecycle generator creates gate tasks for a budget', () => {
  const lifecycle = buildGrantLifecycleRecord({
    site,
    budget: smallDamBudget,
    now: '2026-06-27T20:00:00.000Z',
  });

  assert.equal(lifecycle.schemaVersion, 'jobdone.waterWalkGrantLifecycle.v1');
  assert.equal(lifecycle.workAllowed, false);
  assert.equal(lifecycle.budgetId, 'budget-1');
  assert.ok(lifecycle.tasks.some(task => task.phase === 'pre_application' && task.id === 'preapp-csf-support'));
  assert.ok(lifecycle.tasks.some(task => task.gate === 'work_allowed'));
  assert.ok(lifecycle.tasks.some(task => task.phase === 'claim'));
});

test('grant lifecycle preserves checked tasks when regenerated', () => {
  const first = buildGrantLifecycleRecord({ site, budget: smallDamBudget, now: '2026-06-27T20:00:00.000Z' });
  const checked = toggleLifecycleTask(first, 'preapp-check-land-and-maps', true, '2026-06-27T21:00:00.000Z');
  const regenerated = buildGrantLifecycleRecord({
    existing: checked,
    site,
    budget: smallDamBudget,
    now: '2026-06-27T22:00:00.000Z',
  });

  const task = regenerated.tasks.find(item => item.id === 'preapp-check-land-and-maps');
  assert.equal(task.completed, true);
  assert.equal(task.completedAt, '2026-06-27T21:00:00.000Z');
  assert.deepEqual(lifecycleProgress(regenerated), { completed: 1, total: regenerated.tasks.length, label: `1/${regenerated.tasks.length}` });
});

test('grant lifecycle upsert and lookup use budget id', () => {
  const lifecycle = buildGrantLifecycleRecord({ site, budget: smallDamBudget });
  const list = upsertLifecycle([], lifecycle);

  assert.equal(lifecycleForBudget(list, smallDamBudget), lifecycle);
  assert.deepEqual(upsertLifecycle(list, { ...lifecycle, updatedAt: 'later' }), [{ ...lifecycle, updatedAt: 'later' }]);
});
