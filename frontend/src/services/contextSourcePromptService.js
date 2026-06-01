const COUNTERS_KEY = 'jobdone.contextSourcePrompt.counters';
const DISMISSED_KEY = 'jobdone.contextSourcePrompt.dismissed';

export const FRICTION_EVENTS = {
  BLANK_LOCATION: 'blank_location',
  MANUAL_LOCATION: 'manual_location',
  CONTACT_CORRECTION: 'contact_correction',
};

export const CONTEXT_SOURCE_PROMPTS = {
  location: {
    id: 'location',
    title: 'Use current location for suggestions?',
    body: 'Current location can help suggest a place during review. JobDone only saves it if you confirm it.',
    action: 'Use current location',
  },
  contact: {
    id: 'contact',
    title: 'Use phone contacts during review?',
    body: 'Pick one Contact when needed. JobDone does not silently import your address book.',
    action: 'Pick Contact',
  },
  calendar: {
    id: 'calendar',
    title: 'Calendar suggestions can wait',
    body: 'Calendar connection is deferred until capture-time Location and Contact review are working well.',
    action: 'Not available yet',
    disabled: true,
  },
};

const PROMPT_RULES = {
  location: [
    { event: FRICTION_EVENTS.BLANK_LOCATION, threshold: 3 },
    { event: FRICTION_EVENTS.MANUAL_LOCATION, threshold: 2 },
  ],
  contact: [
    { event: FRICTION_EVENTS.CONTACT_CORRECTION, threshold: 2 },
  ],
};

function storage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function readJson(key, fallback) {
  const store = storage();
  if (!store) return fallback;
  try {
    return JSON.parse(store.getItem(key) || 'null') || fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  storage()?.setItem(key, JSON.stringify(value));
}

export function getFrictionCounters() {
  return readJson(COUNTERS_KEY, {});
}

export function recordContextSourceFriction(event) {
  if (!Object.values(FRICTION_EVENTS).includes(event)) return getFrictionCounters();
  const counters = getFrictionCounters();
  const next = {
    ...counters,
    [event]: Number(counters[event] || 0) + 1,
  };
  writeJson(COUNTERS_KEY, next);
  return next;
}

export function getDismissedContextSourcePrompts() {
  return readJson(DISMISSED_KEY, {});
}

export function dismissContextSourcePrompt(promptId) {
  const dismissed = getDismissedContextSourcePrompts();
  writeJson(DISMISSED_KEY, {
    ...dismissed,
    [promptId]: new Date().toISOString(),
  });
}

export function shouldShowContextSourcePrompt(promptId, counters = getFrictionCounters(), dismissed = getDismissedContextSourcePrompts()) {
  if (dismissed[promptId]) return false;
  return (PROMPT_RULES[promptId] || []).some(rule => Number(counters[rule.event] || 0) >= rule.threshold);
}

export function getActiveContextSourcePrompts() {
  const counters = getFrictionCounters();
  const dismissed = getDismissedContextSourcePrompts();
  return Object.values(CONTEXT_SOURCE_PROMPTS)
    .filter(prompt => shouldShowContextSourcePrompt(prompt.id, counters, dismissed));
}

export function resetContextSourcePromptStateForTests() {
  storage()?.removeItem(COUNTERS_KEY);
  storage()?.removeItem(DISMISSED_KEY);
}
