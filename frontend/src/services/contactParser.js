function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeEmail(value) {
  return normalizeWhitespace(value).toLowerCase();
}

export function normalizePhone(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';

  const hasPlus = raw.trim().startsWith('+');
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';

  return hasPlus ? `+${digits}` : digits;
}

function unfoldVCard(text) {
  return String(text || '').replace(/\r?\n[ \t]/g, '');
}

function splitVCardBlocks(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const matches = normalized.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi);
  if (matches && matches.length > 0) {
    return matches.map(block => block.trim());
  }

  return normalized.toUpperCase().includes('BEGIN:VCARD') ? [normalized] : [];
}

function parseVCardField(line, key) {
  const upper = line.toUpperCase();
  if (!upper.startsWith(key)) return null;

  const separator = line.indexOf(':');
  if (separator < 0) return null;

  return line.slice(separator + 1).trim();
}

function extractVCardName(lines) {
  const fnLine = lines.find(line => line.toUpperCase().startsWith('FN'));
  const nLine = lines.find(line => line.toUpperCase().startsWith('N'));

  const fullName = fnLine ? parseVCardField(fnLine, 'FN') : '';
  if (fullName) return fullName;

  if (!nLine) return '';
  const value = parseVCardField(nLine, 'N') || '';
  const [family, given, additional, prefix, suffix] = value.split(';');
  return normalizeWhitespace([prefix, given, additional, family, suffix].filter(Boolean).join(' '));
}

function parseVCardBlock(rawText) {
  const unfolded = unfoldVCard(rawText);
  const lines = unfolded
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const phones = [];
  const emails = [];
  let organization = '';
  let title = '';
  let note = '';

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('TEL')) {
      const value = parseVCardField(line, 'TEL');
      if (value) phones.push({
        value: normalizeWhitespace(value),
        normalized: normalizePhone(value),
      });
      continue;
    }
    if (upper.startsWith('EMAIL')) {
      const value = parseVCardField(line, 'EMAIL');
      if (value) emails.push({
        value: normalizeWhitespace(value),
        normalized: normalizeEmail(value),
      });
      continue;
    }
    if (upper.startsWith('ORG')) {
      organization = organization || normalizeWhitespace(parseVCardField(line, 'ORG'));
      continue;
    }
    if (upper.startsWith('TITLE')) {
      title = title || normalizeWhitespace(parseVCardField(line, 'TITLE'));
      continue;
    }
    if (upper.startsWith('NOTE')) {
      note = note || normalizeWhitespace(parseVCardField(line, 'NOTE'));
    }
  }

  const displayName = extractVCardName(lines) || organization || title || phones[0]?.value || emails[0]?.value || 'Shared contact';

  return {
    kind: 'contact',
    format: 'vcard',
    rawText: unfolded,
    displayName,
    givenName: '',
    familyName: '',
    organization,
    title,
    note,
    phones,
    emails,
    normalizedPhones: phones.map(phone => phone.normalized).filter(Boolean),
    normalizedEmails: emails.map(email => email.normalized).filter(Boolean),
  };
}

function looksLikeContactText(text) {
  const content = normalizeWhitespace(text);
  if (!content) return false;
  if (/BEGIN:VCARD/i.test(content)) return true;

  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(content);
  const hasPhone = /(?:\+?\d[\d\s().-]{6,}\d)/.test(content);
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const hasNameishLine = lines.length > 0 && lines.length <= 6;

  return hasNameishLine && (hasEmail || hasPhone);
}

function parseContactText(rawText, title = '') {
  const text = normalizeWhitespace(rawText);
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const emails = [];
  for (const email of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || []) {
    const normalized = normalizeEmail(email);
    if (!normalized || emails.some(item => item.normalized === normalized)) continue;
    emails.push({
      value: normalizeWhitespace(email),
      normalized,
    });
  }

  const phones = [];
  for (const match of text.match(/(?:\+?\d[\d\s().-]{6,}\d)/g) || []) {
    const normalized = normalizePhone(match);
    if (normalized) phones.push({ value: normalizeWhitespace(match), normalized });
  }

  const displayName = normalizeWhitespace(
    title ||
    lines.find(line => !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(line) && !/(?:\+?\d[\d\s().-]{6,}\d)/.test(line)) ||
    phones[0]?.value ||
    emails[0]?.value ||
    'Shared contact'
  );

  return {
    kind: 'contact',
    format: 'text',
    rawText: text,
    displayName,
    givenName: '',
    familyName: '',
    organization: '',
    title: '',
    note: '',
    phones,
    emails,
    normalizedPhones: phones.map(phone => phone.normalized).filter(Boolean),
    normalizedEmails: emails.map(email => email.normalized).filter(Boolean),
  };
}

export function parseContactPayload(payload) {
  const rawText = String(payload?.rawText || payload?.text || payload?.title || '');
  const title = normalizeWhitespace(payload?.title || '');

  if (!String(rawText).trim() && !title) return [];

  const blocks = splitVCardBlocks(rawText);
  if (blocks.length > 0) {
    return blocks.map(block => parseVCardBlock(block));
  }

  if (looksLikeContactText(rawText)) {
    return [parseContactText(rawText, title)];
  }

  return [];
}

export function buildContactSummary(person) {
  const phones = person?.phones?.map(phone => phone.value).filter(Boolean) || [];
  const emails = person?.emails?.map(email => email.value).filter(Boolean) || [];
  return [person?.displayName, phones[0], emails[0], person?.organization]
    .filter(Boolean)
    .join(' • ');
}

export function getContactIdentity(person) {
  const keys = [
    ...(person?.normalizedEmails || []),
    ...(person?.normalizedPhones || []),
  ].filter(Boolean);
  return Array.from(new Set(keys)).sort().join('|');
}

export function summarizeContactConflicts(existing, incoming) {
  if (!existing) return [];

  const conflicts = [];
  if (normalizeWhitespace(existing.displayName) && normalizeWhitespace(incoming.displayName) && normalizeWhitespace(existing.displayName) !== normalizeWhitespace(incoming.displayName)) {
    conflicts.push({ field: 'name', existing: existing.displayName, incoming: incoming.displayName });
  }
  const existingEmail = existing.emails?.[0]?.value || '';
  const incomingEmail = incoming.emails?.[0]?.value || '';
  if (existingEmail && incomingEmail && normalizeEmail(existingEmail) !== normalizeEmail(incomingEmail)) {
    conflicts.push({ field: 'email', existing: existingEmail, incoming: incomingEmail });
  }
  const existingPhone = existing.phones?.[0]?.value || '';
  const incomingPhone = incoming.phones?.[0]?.value || '';
  if (existingPhone && incomingPhone && normalizePhone(existingPhone) !== normalizePhone(incomingPhone)) {
    conflicts.push({ field: 'phone', existing: existingPhone, incoming: incomingPhone });
  }
  const existingOrg = normalizeWhitespace(existing.organization);
  const incomingOrg = normalizeWhitespace(incoming.organization);
  if (existingOrg && incomingOrg && existingOrg !== incomingOrg) {
    conflicts.push({ field: 'organization', existing: existingOrg, incoming: incomingOrg });
  }
  return conflicts;
}
