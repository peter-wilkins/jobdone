#!/usr/bin/env node
import fs from 'node:fs';
import {
  formatRecallPropertyFailureMarkdown,
  formatRecallPropertyFailures,
  runV0RecallProperties,
} from '../src/services/recallPropertyHarness.js';

function escapeGitHubData(value) {
  return String(value || '')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function escapeGitHubProperty(value) {
  return escapeGitHubData(value)
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
  const title = escapeGitHubProperty('Recall property failure');
  const message = [
    `${failure.case}: ${failure.property}`,
    `query=${repro.query || ''}`,
    `expected=${(repro.expectedSources || []).join(', ') || 'none'}`,
    `actual=${(repro.actualSources || []).join(', ') || 'none'}`,
  ].join(' | ');

  console.error(`::error file=backend/src/services/recallRanking.js,title=${title}::${escapeGitHubData(message)}`);
}

function logFailure(failures) {
  if (!process.env.GITHUB_ACTIONS) {
    console.error(formatRecallPropertyFailures(failures));
    return;
  }

  const failure = failures[0];
  const repro = failure.repro || {};
  console.error(`Recall property failed: ${failure.case} / ${failure.property}`);
  console.error(`Query: ${repro.query || ''}`);
  console.error(`Expected sources: ${(repro.expectedSources || []).join(', ') || 'none'}`);
  console.error(`Actual sources: ${(repro.actualSources || []).join(', ') || 'none'}`);
  console.error('See the GitHub Actions job summary for the minimal repro JSON and likely next step.');
}

const result = runV0RecallProperties();
const markdown = formatRecallPropertyFailureMarkdown(result.failures);

writeJobSummary(markdown);

if (!result.failures.length) {
  console.log('Recall property diagnostics passed.');
  process.exit(0);
}

annotateFailure(result.failures[0]);
logFailure(result.failures);
process.exit(1);
