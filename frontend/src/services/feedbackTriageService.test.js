import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canCreateTextFeedback,
  defaultTranscriptForTriage,
  FEEDBACK_DATA_LOSS,
  FEEDBACK_IMPACTS,
  FEEDBACK_KINDS,
  normalizeFeedbackTriage,
  parseFeedbackTriageFromLocation,
} from './feedbackTriageService.js';

test('defines the feedback taxonomy values', () => {
  assert.deepEqual(FEEDBACK_KINDS.map(item => item.value), [
    'bug',
    'data_loss',
    'confusing',
    'improvement',
    'sync_login',
    'share_install',
    'performance',
    'other',
  ]);
  assert.deepEqual(FEEDBACK_IMPACTS.map(item => item.value), ['blocked', 'degraded', 'annoyance', 'unsure']);
  assert.deepEqual(FEEDBACK_DATA_LOSS.map(item => item.value), ['no', 'yes', 'unsure']);
});

test('normalizes invalid triage values', () => {
  assert.deepEqual(normalizeFeedbackTriage({
    kind: 'unknown',
    impact: 'urgent',
    data_loss: 'maybe',
    surface: 'login',
  }), {
    kind: 'bug',
    impact: 'unsure',
    data_loss: 'no',
    surface: 'login',
  });
});

test('data loss kind implies data_loss yes', () => {
  assert.equal(normalizeFeedbackTriage({ kind: 'data_loss', data_loss: 'no' }).data_loss, 'yes');
});

test('allows data-loss reports without typed detail', () => {
  assert.equal(canCreateTextFeedback({ text: '', triage: { data_loss: 'yes' } }), true);
  assert.equal(defaultTranscriptForTriage({ data_loss: 'yes' }), 'Data loss report');
  assert.equal(canCreateTextFeedback({ text: '', triage: { data_loss: 'no' } }), false);
});

test('parses preselected triage from feedback hash query', () => {
  const triage = parseFeedbackTriageFromLocation({
    hash: '#feedback?kind=sync_login&impact=blocked&data_loss=unsure&surface=login',
    search: '',
  });

  assert.deepEqual(triage, {
    kind: 'sync_login',
    impact: 'blocked',
    data_loss: 'unsure',
    surface: 'login',
  });
});
