import { QuoteInputSchema } from './schemas.js';

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function label(value) {
  return String(value || '').replaceAll('_', ' ');
}

export function evaluateQuote(ruleset, rawInput) {
  const input = QuoteInputSchema.parse(rawInput);
  const explanation = [];
  const reviewReasons = [];
  const base = ruleset.basePrices[input.productType]?.[input.size];
  if (!Number.isFinite(base)) {
    return {
      rulesetId: ruleset.id,
      canAutoQuote: false,
      price: null,
      priceEstimate: null,
      depositDue: null,
      balanceDue: null,
      paymentPolicy: null,
      explanation: ['This product/size combination needs workshop review.'],
      reviewReasons: ['unsupported_product_size'],
    };
  }

  let subtotal = base;
  explanation.push(`${input.size} ${label(input.productType)}: GBP ${money(base)}`);

  const materialModifier = ruleset.materialModifiers[input.material] ?? 0;
  if (materialModifier) {
    subtotal += materialModifier;
    explanation.push(`${label(input.material)}: +GBP ${money(materialModifier)}`);
  }

  const finishModifier = ruleset.finishModifiers[input.finish]?.[input.size] ?? 0;
  if (finishModifier) {
    subtotal += finishModifier;
    explanation.push(`${label(input.finish)}: +GBP ${money(finishModifier)}`);
  }

  if (input.quantity > 1) {
    explanation.push(`Quantity ${input.quantity}: x${input.quantity}`);
  }
  subtotal *= input.quantity;

  const deadlineMultiplier = ruleset.deadlineMultipliers[input.deadline] ?? 1;
  if (deadlineMultiplier !== 1) {
    explanation.push(`${label(input.deadline)}: x${deadlineMultiplier}`);
  }
  const price = money(subtotal * deadlineMultiplier);

  if (ruleset.autoReviewTriggers?.orderNotesPresent && input.orderNotes.trim()) {
    reviewReasons.push('order_notes_present');
    explanation.push('Order notes need workshop review before checkout.');
  }
  if (ruleset.autoReviewTriggers?.nextDay && input.deadline === 'next_day') {
    reviewReasons.push('next_day_deadline');
    explanation.push('Next-day deadlines need workshop review before checkout.');
  }

  const fullUpfront = ruleset.paymentPolicy.type === 'full_upfront' || price < ruleset.paymentPolicy.fullUpfrontBelow;
  const depositDue = fullUpfront ? price : money(price * (ruleset.paymentPolicy.depositPercent / 100));
  const balanceDue = money(price - depositDue);
  const paymentPolicy = fullUpfront
    ? { type: 'full_upfront', dueNow: depositDue }
    : { type: 'deposit_then_balance', depositPercent: ruleset.paymentPolicy.depositPercent, dueNow: depositDue };

  return {
    rulesetId: ruleset.id,
    canAutoQuote: reviewReasons.length === 0,
    price,
    priceEstimate: price,
    depositDue,
    balanceDue,
    paymentPolicy,
    explanation,
    reviewReasons,
  };
}
