#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MAGIC_LINK_TEMPLATE = path.join(REPO_ROOT, 'supabase/auth-email-templates/magic_link.html');

export function projectRefFromSupabaseUrl(value = '') {
  try {
    const url = new URL(value);
    return url.hostname.split('.')[0] || '';
  } catch {
    return '';
  }
}

export function buildAuthEmailPayload({
  magicLinkTemplate = fs.readFileSync(MAGIC_LINK_TEMPLATE, 'utf8'),
} = {}) {
  if (!magicLinkTemplate.includes('{{ .ConfirmationURL }}')) {
    throw new Error('Magic-link template must include {{ .ConfirmationURL }}');
  }
  if (magicLinkTemplate.includes('email_kind') || magicLinkTemplate.includes('.Data.')) {
    throw new Error('Magic-link template must not depend on persistent Supabase user metadata for transient email context');
  }
  if (!magicLinkTemplate.includes('Open JobDone')) {
    throw new Error('Magic-link template must use neutral Open JobDone copy');
  }

  return {
    mailer_subjects_magic_link: 'Open JobDone',
    mailer_templates_magic_link_content: magicLinkTemplate,
  };
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function hasArg(args, name) {
  return args.includes(name);
}

function supabaseUrlForEnvironment(environment) {
  if (environment === 'production' || environment === 'prod') {
    return process.env.JOBDONE_PROD_SUPABASE_URL || process.env.SUPABASE_URL || '';
  }
  if (environment === 'staging') {
    return process.env.JOBDONE_STAGING_SUPABASE_URL || process.env.SUPABASE_URL || '';
  }
  return process.env.SUPABASE_URL || process.env.JOBDONE_PROD_SUPABASE_URL || '';
}

function resolveProjectRef(args) {
  const explicit = argValue(args, '--project-ref') || process.env.SUPABASE_PROJECT_REF || '';
  if (explicit) return explicit;

  const environment = argValue(args, '--env');
  const explicitUrl = argValue(args, '--supabase-url');
  return projectRefFromSupabaseUrl(explicitUrl || supabaseUrlForEnvironment(environment));
}

async function main() {
  const args = process.argv.slice(2);
  const apply = hasArg(args, '--apply');
  const projectRef = resolveProjectRef(args);
  const payload = buildAuthEmailPayload();
  const keys = Object.keys(payload);

  if (!projectRef) {
    throw new Error('Missing Supabase project ref. Pass --project-ref or set JOBDONE_PROD_SUPABASE_URL / JOBDONE_STAGING_SUPABASE_URL.');
  }

  if (!apply) {
    console.log(JSON.stringify({
      dryRun: true,
      projectRef,
      payloadKeys: keys,
      templateBytes: payload.mailer_templates_magic_link_content.length,
      next: 'Run with --apply and SUPABASE_ACCESS_TOKEN to update hosted Supabase Auth templates.',
    }, null, 2));
    return;
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN || '';
  if (!token) {
    throw new Error('Missing SUPABASE_ACCESS_TOKEN. Create one at https://supabase.com/dashboard/account/tokens');
  }

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase Auth template update failed: HTTP ${response.status} ${body}`);
  }

  console.log(JSON.stringify({
    updated: true,
    projectRef,
    payloadKeys: keys,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
