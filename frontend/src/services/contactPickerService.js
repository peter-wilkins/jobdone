import { normalizeEmail, normalizePhone } from './contactParser.js';

function firstValue(values) {
  return Array.isArray(values) ? values.find(Boolean) || '' : String(values || '');
}

function contactValue(value, normalizer) {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = normalizer(text);
  if (!normalized) return null;
  return { value: text, normalized };
}

export function isContactPickerSupported() {
  return Boolean(navigator.contacts?.select);
}

export function contactDraftFromPickerResult(result = {}) {
  const displayName = firstValue(result.name).trim();
  const phones = (Array.isArray(result.tel) ? result.tel : [])
    .map(value => contactValue(value, normalizePhone))
    .filter(Boolean);
  const emails = (Array.isArray(result.email) ? result.email : [])
    .map(value => contactValue(value, normalizeEmail))
    .filter(Boolean);

  return {
    displayName: displayName || phones[0]?.value || emails[0]?.value || 'Picked contact',
    givenName: '',
    familyName: '',
    organization: '',
    title: '',
    note: '',
    phones,
    emails,
    normalizedPhones: phones.map(phone => phone.normalized),
    normalizedEmails: emails.map(email => email.normalized),
    primaryPhone: phones[0]?.normalized || null,
    primaryEmail: emails[0]?.normalized || null,
    source: 'contact_picker',
  };
}

export function contactDraftFromManualInput({ displayName = '', phone = '', email = '' } = {}) {
  const phones = [contactValue(phone, normalizePhone)].filter(Boolean);
  const emails = [contactValue(email, normalizeEmail)].filter(Boolean);

  return {
    displayName: String(displayName || '').trim(),
    givenName: '',
    familyName: '',
    organization: '',
    title: '',
    note: '',
    phones,
    emails,
    normalizedPhones: phones.map(item => item.normalized),
    normalizedEmails: emails.map(item => item.normalized),
    primaryPhone: phones[0]?.normalized || null,
    primaryEmail: emails[0]?.normalized || null,
    source: 'manual_review',
  };
}

export function validateContactDraftForCreation(contact = {}) {
  if (!String(contact.displayName || '').trim()) {
    return { valid: false, error: 'Contact name is required' };
  }
  if (!contact.primaryPhone && !contact.primaryEmail) {
    return { valid: false, error: 'Add a phone number or email to create a Contact' };
  }
  return { valid: true, error: null };
}

export async function pickContact() {
  if (!isContactPickerSupported()) {
    return { ok: false, reason: 'unsupported' };
  }

  const selected = await navigator.contacts.select(['name', 'email', 'tel'], { multiple: false });
  const contact = Array.isArray(selected) ? selected[0] : null;
  if (!contact) return { ok: false, reason: 'empty' };

  return { ok: true, contact: contactDraftFromPickerResult(contact) };
}
