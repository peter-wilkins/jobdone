export function emptyProjectModel() {
  return {
    project: null,
    files: [],
    previews: [],
    quotes: [],
    payments: [],
    refunds: [],
    approvals: [],
    events: [],
    opsEvents: [],
  };
}

export function quoteAccepted(model, quoteId) {
  return (model.events || []).some(event => event.type === 'quote_accepted' && event.quoteSnapshotId === quoteId);
}

export function currentQuote(modelOrQuotes = []) {
  const quotes = Array.isArray(modelOrQuotes) ? modelOrQuotes : (modelOrQuotes.quotes || []);
  const model = Array.isArray(modelOrQuotes) ? { events: [] } : modelOrQuotes;
  const usable = (quotes || []).filter(quote => quote.status !== 'superseded');
  const acceptedQuoteIds = new Set((model.events || [])
    .filter(event => event.type === 'quote_accepted')
    .map(event => event.quoteSnapshotId));
  const accepted = [...usable].reverse().find(quote => acceptedQuoteIds.has(quote.id));
  if (accepted) return accepted;
  return [...usable].reverse().find(quote => quote.status === 'accepted')
    || [...usable].reverse().find(quote => quote.status === 'offered')
    || [...usable].reverse().find(quote => quote.status === 'needs_review')
    || [...usable].reverse().find(quote => quote.status === 'draft_estimate')
    || null;
}

function eventExists(model, type) {
  return (model.events || []).some(event => event.type === type);
}

function paymentTotalForQuote(model, quoteId) {
  return (model.payments || [])
    .filter(payment => payment.quoteSnapshotId === quoteId && payment.status === 'received')
    .reduce((total, payment) => total + payment.amount, 0);
}

export function requiredPaymentReceived(model, quote = currentQuote(model)) {
  if (!quote) return false;
  return paymentTotalForQuote(model, quote.id) >= quote.result.depositDue;
}

export function balancePaid(model, quote = currentQuote(model)) {
  if (!quote) return false;
  return paymentTotalForQuote(model, quote.id) >= quote.result.price;
}

export function deriveProjectStatus(model = emptyProjectModel()) {
  if ((model.events || []).some(event => event.type === 'requires_human_attention' && !event.resolvedAt)) {
    return 'requires_human_attention';
  }
  if (eventExists(model, 'project_declined')) return 'declined';
  if (eventExists(model, 'project_cancelled_by_customer')) return 'cancelled';
  if (eventExists(model, 'project_completed')) return 'complete';

  if (!model.project) return 'draft';

  const quote = currentQuote(model);
  const hasPreview = (model.previews || []).length > 0;
  const hasProductionStarted = eventExists(model, 'production_started');
  const hasWorkshopPhoto = (model.files || []).some(file => file.kind === 'workshop_photo');
  const hasApproval = (model.approvals || []).some(approval => approval.type === 'finished_piece_approved');
  const hasAdjustmentRequest = eventExists(model, 'adjustment_requested');

  if (hasApproval) {
    return balancePaid(model, quote) ? 'ready' : 'awaiting_balance';
  }
  if (hasWorkshopPhoto) return 'awaiting_customer_approval';
  if (hasProductionStarted || hasAdjustmentRequest) return 'in_production';
  if (quote?.reviewReasons?.length || quote?.status === 'needs_review') return 'needs_human_review';
  if (quote && requiredPaymentReceived(model, quote)) return 'ready_for_workshop';
  if (quote?.status === 'accepted' || quote?.status === 'offered') return 'awaiting_payment';
  if (quote?.status === 'draft_estimate') return quote.canAutoQuote ? 'quote_configuring' : 'needs_human_review';
  if (hasPreview) return 'previewed';
  return 'draft';
}
