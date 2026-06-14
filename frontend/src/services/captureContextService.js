const CAPTURE_CONTEXT_KEY = 'jobdone.captureContext.v1';
const MAX_CONTEXT_NOTES_LENGTH = 500;

export const CAPTURE_CONTEXT_TEMPLATES = [
  {
    id: 'farm_land_work',
    label: 'Farm or land work',
    contextLabel: 'farm and land work',
    examples: 'fields, ponds, fencing, tracks, drainage, machinery, livestock, seasonal jobs',
  },
  {
    id: 'plumber_customer_work',
    label: 'Customer work as a plumber',
    contextLabel: 'plumbing customer work',
    examples: 'boilers, leaks, radiators, invoices, materials, follow-ups',
  },
  {
    id: 'mechanic_vehicle_work',
    label: 'Work on vehicles as a mechanic',
    contextLabel: 'vehicle mechanic work',
    examples: 'vehicles, faults, parts, inspections, mileage, follow-ups',
  },
  {
    id: 'gardening_home_jobs',
    label: 'Gardening or home jobs',
    contextLabel: 'gardening and home jobs',
    examples: 'beds, lawns, pruning, planting, tools, seasonal work',
  },
  {
    id: 'family_chores',
    label: 'Family or household jobs',
    contextLabel: 'family and household jobs',
    examples: 'chores, routines, evidence, progress, household tasks',
  },
  {
    id: 'something_else',
    label: 'Something else',
    contextLabel: 'general work notes',
    examples: 'projects, jobs, people, places, things to remember',
  },
];

function compact(value, maxLength = 240) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function compactCaptureContextNotes(value) {
  return compact(value, MAX_CONTEXT_NOTES_LENGTH);
}

export function buildCaptureContext(templateId, notes = '') {
  const template = CAPTURE_CONTEXT_TEMPLATES.find(candidate => candidate.id === templateId)
    || CAPTURE_CONTEXT_TEMPLATES[CAPTURE_CONTEXT_TEMPLATES.length - 1];
  return {
    version: 1,
    source: 'personal_onboarding',
    templateId: template.id,
    label: template.contextLabel,
    examples: template.examples,
    notes: compactCaptureContextNotes(notes),
    createdAt: new Date().toISOString(),
  };
}

export function buildTeamCaptureContext(teamName = '', notes = '') {
  const cleanedNotes = compactCaptureContextNotes(notes);
  return {
    version: 1,
    source: 'team_settings',
    label: compact(teamName, 80) || 'Team work',
    examples: '',
    notes: cleanedNotes,
    createdAt: new Date().toISOString(),
  };
}

export function normalizeCaptureContext(context = null) {
  if (!context || typeof context !== 'object') return null;
  const source = context.source === 'team_settings' ? 'team_settings' : 'personal_onboarding';
  const label = compact(context.label, 80);
  const notes = compactCaptureContextNotes(context.notes);
  const examples = compact(context.examples, 240);
  if (!label && !notes && !examples) return null;
  return {
    version: 1,
    source,
    templateId: compact(context.templateId, 80) || undefined,
    label,
    examples,
    notes,
    createdAt: context.createdAt || context.created_at || new Date().toISOString(),
  };
}

export const captureContextService = {
  get() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(CAPTURE_CONTEXT_KEY) || 'null');
      return parsed && parsed.version === 1 ? normalizeCaptureContext(parsed) : null;
    } catch {
      return null;
    }
  },

  save(context) {
    window.localStorage.setItem(CAPTURE_CONTEXT_KEY, JSON.stringify(context));
  },

  isConfigured() {
    return Boolean(this.get());
  },
};
