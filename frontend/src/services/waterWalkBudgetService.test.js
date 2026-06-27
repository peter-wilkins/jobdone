import assert from 'node:assert/strict';
import test from 'node:test';
import {
  budgetForTarget,
  buildGrantJobBudgetRecord,
  calculateGrantJobBudget,
  formatBudgetMoney,
  upsertBudget,
} from './waterWalkBudgetService.js';

test('grant job budget calculates rough margin for known payment option', () => {
  const result = calculateGrantJobBudget({
    optionId: 'uk-england.capital-grants-2026/rp32-small-leaky-woody-dams',
    quantity: 2,
    cashCost: 100,
    internalCost: 250,
  });

  assert.equal(result.grantIncome, 922.78);
  assert.equal(result.margin, 572.78);
});

test('grant job budget keeps unknown grant payment visible', () => {
  const result = calculateGrantJobBudget({
    optionId: 'uk-england.capital-grants-2026/wn12-create-or-restore-ponds-up-to-2ha',
    quantity: 1,
    cashCost: 100,
    internalCost: 50,
  });

  assert.equal(result.grantIncome, null);
  assert.equal(result.margin, null);
  assert.equal(formatBudgetMoney(result.margin), 'Unknown');
});

test('grant job budget record preserves assumptions and target link', () => {
  const record = buildGrantJobBudgetRecord({
    site: { id: 'dewlish', label: 'Dewlish' },
    target: { type: 'candidate', id: 'pin-1', title: 'Wet ditch' },
    form: {
      optionId: 'uk-england.capital-grants-2026/rp32-small-leaky-woody-dams',
      quantity: 1,
      cashCost: 80,
      internalCost: 180,
      confidence: 'low',
      landownerJudgement: 'worth_exploring',
      machineryNotes: 'Tractor access likely.',
      labourNotes: 'Half day.',
      materialsNotes: 'Use nearby brash.',
      unknownsText: 'CSF support needed\nConsent check',
    },
    now: '2026-06-27T20:00:00.000Z',
  });

  assert.equal(record.targetType, 'candidate');
  assert.equal(record.targetId, 'pin-1');
  assert.equal(record.marginEstimate.amount, 201.39);
  assert.deepEqual(record.unknowns, ['CSF support needed', 'Consent check']);
  assert.equal(record.resourceNotes.materials, 'Use nearby brash.');
});

test('grant job budget upsert replaces existing records', () => {
  const target = { type: 'observation', id: 'obs-1' };
  const existing = { id: 'budget-1', targetType: 'observation', targetId: 'obs-1', updatedAt: 'old' };
  const replacement = { ...existing, updatedAt: 'new' };

  assert.equal(budgetForTarget([existing], target), existing);
  assert.deepEqual(upsertBudget([existing], replacement), [replacement]);
});
