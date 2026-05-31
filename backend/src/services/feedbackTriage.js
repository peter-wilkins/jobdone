import { createHash } from 'node:crypto';

const VALID_KINDS = new Set([
  'bug',
  'data_loss',
  'confusing',
  'improvement',
  'sync_login',
  'share_install',
  'performance',
  'other',
]);
const VALID_IMPACTS = new Set(['blocked', 'degraded', 'annoyance', 'unsure']);
const VALID_DATA_LOSS = new Set(['yes', 'no', 'unsure']);

function compact(value, limit = 160) {
  return String(value || '').trim().slice(0, limit);
}

function allowed(value, values, fallback) {
  const text = compact(value, 80);
  return values.has(text) ? text : fallback;
}

function hashObject(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 16);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function routeFromBundle(bundle = {}) {
  const crashRoute = bundle.crash_report?.route || {};
  const route = bundle.route || {};
  return {
    screen: compact(route.screen || crashRoute.screen, 80) || null,
    path: compact(route.path || crashRoute.path, 160) || null,
    hash: compact(route.hash || crashRoute.hash, 160) || null,
  };
}

function feedbackTriage(bundle = {}) {
  const feedback = bundle.feedback || {};
  const kind = allowed(
    bundle.report_type === 'crash_report' ? 'bug' : feedback.kind,
    VALID_KINDS,
    'bug'
  );
  const dataLoss = kind === 'data_loss'
    ? 'yes'
    : allowed(feedback.data_loss || feedback.dataLoss, VALID_DATA_LOSS, 'no');

  return {
    kind,
    impact: allowed(feedback.impact, VALID_IMPACTS, 'unsure'),
    data_loss: dataLoss,
    surface: compact(feedback.surface || routeFromBundle(bundle).screen, 80) || null,
  };
}

function recentRequestIds(bundle = {}) {
  const fromApiDiagnostics = asArray(bundle.recent_api_requests)
    .map(request => request?.request_id)
    .filter(Boolean);
  const fromCrash = asArray(bundle.crash_report?.recent_request_ids);
  return Array.from(new Set([...fromApiDiagnostics, ...fromCrash]))
    .map(value => compact(value, 80))
    .filter(Boolean)
    .slice(-10);
}

function recentErrors(bundle = {}) {
  const failedApi = asArray(bundle.recent_api_requests)
    .filter(request => request?.ok === false)
    .map(request => ({
      kind: 'api_request',
      endpoint: compact(request.endpoint, 120),
      status: request.status ?? null,
      failure_kind: compact(request.failure_kind, 80) || null,
      at: compact(request.at, 40) || null,
    }));
  const crash = bundle.crash_report?.error
    ? [{
        kind: 'crash',
        name: compact(bundle.crash_report.error.name, 120),
        message: compact(bundle.crash_report.error.message, 300),
        at: compact(bundle.crash_report.captured_at || bundle.captured_at, 40) || null,
      }]
    : [];
  return [...crash, ...failedApi].slice(0, 10);
}

function countsFromBundle(bundle = {}) {
  return {
    local_db: bundle.local_db_counts || bundle.localDbCounts || bundle.local_db || null,
    sync: bundle.sync_counts || bundle.syncCounts || bundle.sync || null,
  };
}

function priorityFor({ triage, reportType }) {
  if (triage.data_loss === 'yes') return 'p0_data_loss';
  if (triage.impact === 'blocked') return 'p1_blocked';
  if (reportType === 'crash_report') return 'p1_crash';
  if (triage.impact === 'degraded') return 'p2_degraded';
  return 'p3_review';
}

function nextActionFor({ triage, reportType, recent_errors: recentErrorsValue }) {
  if (triage.data_loss === 'yes') return 'Preserve diagnostics, inspect sync/local DB counts, and reproduce before changing data.';
  if (reportType === 'crash_report') return 'Group by crash signature and inspect stack plus recent request ids.';
  if (triage.kind === 'improvement') return 'Review as product suggestion; do not treat as bug without reproduction evidence.';
  if (recentErrorsValue.length > 0) return 'Search backend logs by recent request id and correlate with reported surface.';
  return 'Check duplicate signature, then decide whether to promote into a GitHub issue.';
}

export function normalizeFeedbackTriageRecord(row = {}) {
  const bundle = row.diagnostic_bundle || {};
  const reportType = bundle.report_type === 'crash_report' ? 'crash_report' : 'feedback_report';
  const triage = feedbackTriage(bundle);
  const route = routeFromBundle(bundle);
  const recentRequestIdsValue = recentRequestIds(bundle);
  const recentErrorsValue = recentErrors(bundle);
  const dedupeBase = {
    reportType,
    kind: triage.kind,
    data_loss: triage.data_loss,
    surface: triage.surface || route.screen || route.path,
    crash_signature: bundle.crash_report?.signature || bundle.crash_signature || null,
    message: compact(reportType === 'crash_report'
      ? bundle.crash_report?.error?.message
      : row.transcript, 120).toLowerCase(),
  };
  const dedupeSignature = hashObject(dedupeBase);
  const normalized = {
    id: row.id,
    report_type: reportType,
    kind: triage.kind,
    impact: triage.impact,
    data_loss: triage.data_loss,
    priority: priorityFor({ triage, reportType }),
    build_id: compact(bundle.build_id || bundle.crash_report?.build_id, 120) || null,
    route,
    surface: triage.surface || route.screen || route.path || null,
    identity_class: row.identity_class || bundle.feedback_identity?.identity_class || (row.user_id ? 'signed_in' : 'anonymous'),
    user_id: row.user_id || null,
    anonymous_device_id: row.anonymous_device_id || bundle.feedback_identity?.anonymous_device_id || null,
    created_at: row.created_at,
    recent_request_ids: recentRequestIdsValue,
    backend_health: bundle.backend || null,
    counts: countsFromBundle(bundle),
    recent_events: asArray(bundle.recent_events).slice(-10),
    recent_errors: recentErrorsValue,
    user_description: compact(row.transcript, 1000),
    dedupe_signature: dedupeSignature,
    suggested_next_action: nextActionFor({ triage, reportType, recent_errors: recentErrorsValue }),
    suggested_summary: {
      label: 'suggested_not_authoritative',
      text: compact(`${triage.kind} on ${triage.surface || route.screen || route.path || 'unknown surface'}: ${row.transcript}`, 300),
    },
    raw_diagnostic_bundle: bundle,
  };
  return normalized;
}

function issueTitle(record) {
  const prefix = record.data_loss === 'yes'
    ? 'Data loss'
    : record.report_type === 'crash_report' ? 'Crash' : 'Feedback';
  const surface = record.surface ? `: ${record.surface}` : '';
  return `${prefix}${surface}`;
}

export function prepareFeedbackIssueDraft(record) {
  const lines = [
    `## Source`,
    ``,
    `Feedback triage record: ${record.id}`,
    `Report type: ${record.report_type}`,
    `Dedupe signature: ${record.dedupe_signature}`,
    ``,
    `## User Description`,
    ``,
    record.user_description || '_No user description provided._',
    ``,
    `## Triage`,
    ``,
    `- Kind: ${record.kind}`,
    `- Impact: ${record.impact}`,
    `- Data loss: ${record.data_loss}`,
    `- Priority: ${record.priority}`,
    `- Surface: ${record.surface || 'unknown'}`,
    `- Build: ${record.build_id || 'unknown'}`,
    ``,
    `## Diagnostics`,
    ``,
    `- Created: ${record.created_at || 'unknown'}`,
    `- Identity class: ${record.identity_class}`,
    `- Recent request ids: ${record.recent_request_ids.join(', ') || 'none'}`,
    `- Recent errors: ${record.recent_errors.length}`,
    ``,
    `## Suggested Next Action`,
    ``,
    `Suggested, not authoritative: ${record.suggested_next_action}`,
  ];

  return {
    title: issueTitle(record),
    body: lines.join('\n'),
    labels: record.data_loss === 'yes' ? ['needs-triage', 'data-loss'] : ['needs-triage'],
  };
}

export function sortFeedbackTriageRecords(records = []) {
  const priorityOrder = {
    p0_data_loss: 0,
    p1_blocked: 1,
    p1_crash: 2,
    p2_degraded: 3,
    p3_review: 4,
  };
  return [...records].sort((a, b) =>
    (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99) ||
    String(b.created_at || '').localeCompare(String(a.created_at || ''))
  );
}
