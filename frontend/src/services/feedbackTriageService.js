export const FEEDBACK_KINDS = [
  { value: 'bug', label: 'Bug' },
  { value: 'data_loss', label: 'Lost data' },
  { value: 'confusing', label: 'Confusing' },
  { value: 'improvement', label: 'Improvement' },
  { value: 'sync_login', label: 'Sync/login' },
  { value: 'share_install', label: 'Share/install' },
  { value: 'performance', label: 'Slow' },
  { value: 'other', label: 'Other' },
];

export const FEEDBACK_IMPACTS = [
  { value: 'blocked', label: 'Blocked' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'annoyance', label: 'Annoyance' },
  { value: 'unsure', label: 'Unsure' },
];

export const FEEDBACK_DATA_LOSS = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
  { value: 'unsure', label: 'Unsure' },
];

const KIND_VALUES = new Set(FEEDBACK_KINDS.map(item => item.value));
const IMPACT_VALUES = new Set(FEEDBACK_IMPACTS.map(item => item.value));
const DATA_LOSS_VALUES = new Set(FEEDBACK_DATA_LOSS.map(item => item.value));

export const DEFAULT_FEEDBACK_TRIAGE = {
  kind: 'bug',
  impact: 'unsure',
  data_loss: 'no',
  surface: null,
};

function allowed(value, values, fallback) {
  return values.has(value) ? value : fallback;
}

export function normalizeFeedbackTriage(input = {}) {
  const kind = allowed(input.kind, KIND_VALUES, DEFAULT_FEEDBACK_TRIAGE.kind);
  const dataLoss = kind === 'data_loss'
    ? 'yes'
    : allowed(input.data_loss || input.dataLoss, DATA_LOSS_VALUES, DEFAULT_FEEDBACK_TRIAGE.data_loss);

  return {
    kind,
    impact: allowed(input.impact, IMPACT_VALUES, DEFAULT_FEEDBACK_TRIAGE.impact),
    data_loss: dataLoss,
    surface: input.surface ? String(input.surface).slice(0, 80) : null,
  };
}

export function parseFeedbackTriageFromLocation(location = globalThis.window?.location) {
  const hashQuery = String(location?.hash || '').split('?')[1] || '';
  const search = String(location?.search || '').replace(/^\?/, '');
  const params = new URLSearchParams([hashQuery, search].filter(Boolean).join('&'));

  return normalizeFeedbackTriage({
    kind: params.get('kind') || params.get('feedback_kind'),
    impact: params.get('impact'),
    data_loss: params.get('data_loss') || params.get('dataLoss'),
    surface: params.get('surface') || params.get('screen'),
  });
}

export function feedbackTriageSummary(triage = {}) {
  const normalized = normalizeFeedbackTriage(triage);
  return {
    kind: normalized.kind,
    impact: normalized.impact,
    data_loss: normalized.data_loss,
    surface: normalized.surface,
  };
}

export function canCreateTextFeedback({ text = '', triage = {} } = {}) {
  const normalized = normalizeFeedbackTriage(triage);
  return text.trim().length > 0 || normalized.data_loss === 'yes';
}

export function defaultTranscriptForTriage(triage = {}) {
  const normalized = normalizeFeedbackTriage(triage);
  if (normalized.data_loss === 'yes') return 'Data loss report';
  return '';
}
