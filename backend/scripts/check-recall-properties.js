#!/usr/bin/env node
import fs from 'node:fs';
import {
  formatRecallPropertyFailureMarkdown,
  formatRecallPropertyFailures,
  runV0RecallProperties,
} from '../src/services/recallPropertyHarness.js';

function escapeGitHubCommand(value) {
  return String(value || '')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

function writeJobSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  fs.appendFileSync(summaryPath, `${markdown}\n`);
}

function annotateFailure(failure) {
  const repro = failure.repro || {};
  const title = escapeGitHubCommand('Recall property failure');
  const message = [
    `${failure.case}: ${failure.property}`,
    `query=${repro.query || ''}`,
    `expected=${(repro.expectedSources || []).join(', ') || 'none'}`,
    `actual=${(repro.actualSources || []).join(', ') || 'none'}`,
  ].join(' | ');

  console.error(`::error file=backend/src/services/recallRanking.js,title=${title}::${escapeGitHubCommand(message)}`);
}

const result = runV0RecallProperties();
const markdown = formatRecallPropertyFailureMarkdown(result.failures);

writeJobSummary(markdown);

if (!result.failures.length) {
  console.log('Recall property diagnostics passed.');
  process.exit(0);
}

annotateFailure(result.failures[0]);
console.error(formatRecallPropertyFailures(result.failures));
process.exit(1);
