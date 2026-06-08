export const CLAIM_RACE_FEEDBACK_MS = 90_000;

export function pointsText(item, pointsEnabled) {
  if (!pointsEnabled || !item.points) return '';
  return `${item.points} point${item.points === 1 ? '' : 's'}`;
}

export function teamLabel(item) {
  return item.team?.name || 'Team';
}

export function itemPointsEnabled(item, fallback) {
  return item.team?.points_enabled ?? fallback;
}

export function itemUsesManualApproval(item, fallback) {
  if (!item.team?.approval_mode) return fallback;
  return item.team.approval_mode === 'manual';
}

export function statusText(status, usesManualApproval = true) {
  if (status === 'needs_more_evidence') return 'Needs more evidence';
  if (status === 'submitted') return 'Submitted';
  if (status === 'approved') return usesManualApproval ? 'Approved' : 'Done';
  if (status === 'claimed') return 'Claimed';
  return 'Open';
}

