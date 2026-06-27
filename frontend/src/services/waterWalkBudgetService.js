export const GRANT_JOB_OPTIONS = [
  {
    id: 'uk-england.capital-grants-2026/rp32-small-leaky-woody-dams',
    label: 'RP32 small leaky woody dam',
    interventionType: 'check-dam',
    unit: 'dam',
    grantAmountPerUnit: 461.39,
    currency: 'GBP',
  },
  {
    id: 'uk-england.capital-grants-2026/rp33-large-leaky-woody-dams',
    label: 'RP33 large leaky woody dam',
    interventionType: 'check-dam',
    unit: 'dam',
    grantAmountPerUnit: 764.42,
    currency: 'GBP',
  },
  {
    id: 'uk-england.capital-grants-2026/wn12-create-or-restore-ponds-up-to-2ha',
    label: 'WN12 create or restore pond',
    interventionType: 'pond',
    unit: 'pond',
    grantAmountPerUnit: null,
    currency: 'GBP',
  },
];

export const BUDGET_CONFIDENCE = ['low', 'medium', 'high'];
export const LANDOWNER_JUDGEMENTS = ['worth_exploring', 'needs_quote_or_adviser', 'not_worth_it'];

export function grantJobOptionById(optionId) {
  return GRANT_JOB_OPTIONS.find(option => option.id === optionId) || GRANT_JOB_OPTIONS[0];
}

export function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function positiveNumberOrDefault(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function splitLines(value = '') {
  return String(value)
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
}

export function calculateGrantJobBudget({
  optionId,
  quantity = 1,
  cashCost = 0,
  internalCost = 0,
}) {
  const option = grantJobOptionById(optionId);
  const safeQuantity = positiveNumberOrDefault(quantity);
  const safeCashCost = numberOrZero(cashCost);
  const safeInternalCost = numberOrZero(internalCost);
  const grantIncome = Number.isFinite(option.grantAmountPerUnit)
    ? Number((option.grantAmountPerUnit * safeQuantity).toFixed(2))
    : null;
  const margin = grantIncome === null
    ? null
    : Number((grantIncome - safeCashCost - safeInternalCost).toFixed(2));

  return {
    option,
    quantity: safeQuantity,
    grantIncome,
    cashCost: safeCashCost,
    internalCost: safeInternalCost,
    margin,
  };
}

export function buildGrantJobBudgetRecord({
  existing = null,
  site,
  target,
  form,
  now = new Date().toISOString(),
}) {
  const calculation = calculateGrantJobBudget(form);
  const confidence = BUDGET_CONFIDENCE.includes(form.confidence) ? form.confidence : 'low';
  const landownerJudgement = LANDOWNER_JUDGEMENTS.includes(form.landownerJudgement)
    ? form.landownerJudgement
    : 'needs_quote_or_adviser';

  return {
    schemaVersion: 'jobdone.waterWalkGrantJobBudget.v1',
    id: existing?.id || `water-walk-budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    siteId: site.id,
    siteLabel: site.label,
    targetType: target.type,
    targetId: target.id,
    targetTitle: target.title,
    interventionType: calculation.option.interventionType,
    fundingOptionId: calculation.option.id,
    fundingOptionName: calculation.option.label,
    quantity: {
      amount: calculation.quantity,
      unit: calculation.option.unit,
    },
    grantIncomeEstimate: {
      amount: calculation.grantIncome,
      currency: calculation.option.currency,
      confidence,
    },
    cashCostEstimate: {
      amount: calculation.cashCost,
      currency: calculation.option.currency,
      confidence,
    },
    internalCostEstimate: {
      amount: calculation.internalCost,
      currency: calculation.option.currency,
      confidence,
    },
    marginEstimate: {
      amount: calculation.margin,
      currency: calculation.option.currency,
      confidence,
    },
    resourceNotes: {
      machinery: String(form.machineryNotes || '').trim(),
      labour: String(form.labourNotes || '').trim(),
      materials: String(form.materialsNotes || '').trim(),
    },
    unknowns: splitLines(form.unknownsText),
    confidence,
    landownerJudgement,
  };
}

export function budgetForTarget(budgets = [], target) {
  if (!target) return null;
  return budgets.find(budget => budget.targetType === target.type && budget.targetId === target.id) || null;
}

export function upsertBudget(budgets = [], budget) {
  const withoutExisting = budgets.filter(item => item.id !== budget.id);
  return [budget, ...withoutExisting];
}

export function budgetToForm(budget = null) {
  if (!budget) {
    return {
      optionId: GRANT_JOB_OPTIONS[0].id,
      quantity: 1,
      cashCost: 0,
      internalCost: 0,
      confidence: 'low',
      landownerJudgement: 'needs_quote_or_adviser',
      machineryNotes: '',
      labourNotes: '',
      materialsNotes: '',
      unknownsText: '',
    };
  }

  return {
    optionId: budget.fundingOptionId || GRANT_JOB_OPTIONS[0].id,
    quantity: budget.quantity?.amount || 1,
    cashCost: budget.cashCostEstimate?.amount || 0,
    internalCost: budget.internalCostEstimate?.amount || 0,
    confidence: budget.confidence || 'low',
    landownerJudgement: budget.landownerJudgement || 'needs_quote_or_adviser',
    machineryNotes: budget.resourceNotes?.machinery || '',
    labourNotes: budget.resourceNotes?.labour || '',
    materialsNotes: budget.resourceNotes?.materials || '',
    unknownsText: Array.isArray(budget.unknowns) ? budget.unknowns.join('\n') : '',
  };
}

export function formatBudgetMoney(amount, currency = 'GBP') {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return 'Unknown';
  return `${currency} ${Number(amount).toFixed(2)}`;
}
