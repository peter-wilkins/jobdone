const GENERIC_TASKS = [
  {
    id: 'explore-review-candidate',
    phase: 'explore',
    gate: 'exploring',
    title: 'Review candidate and rough budget',
    description: 'Check the field note, photos, dimensions, access notes, and rough budget before deciding whether to investigate further.',
  },
  {
    id: 'preapp-check-land-and-maps',
    phase: 'pre_application',
    gate: 'application_ready',
    title: 'Check Rural Payments land and maps',
    description: 'Confirm the business, land parcels, and digital maps are registered and up to date before applying.',
  },
  {
    id: 'preapp-check-control-and-funding',
    phase: 'pre_application',
    gate: 'application_ready',
    title: 'Check management control and existing funding',
    description: 'Confirm management control, existing agreements, and double-funding risk.',
  },
  {
    id: 'preapp-check-consents',
    phase: 'pre_application',
    gate: 'application_ready',
    title: 'Check consents and protected constraints',
    description: 'Check consent, permit, SSSI, archaeology, drainage, public access, and neighbour/downstream questions.',
  },
  {
    id: 'preapp-before-evidence',
    phase: 'pre_application',
    gate: 'application_ready',
    title: 'Collect before-work evidence',
    description: 'Capture dated before-work photos, GPS, rough dimensions, and a map or sketch where needed.',
  },
  {
    id: 'application-pack',
    phase: 'application',
    gate: 'submitted',
    title: 'Prepare and submit application pack',
    description: 'Prepare the official application data and supporting evidence. Submit through the official route, then save the reference.',
  },
  {
    id: 'agreement-record-offer',
    phase: 'agreement',
    gate: 'agreement_accepted',
    title: 'Record agreement offer and dates',
    description: 'If offered, record acceptance, agreement start date, end date, claim-by date, and durability period.',
  },
  {
    id: 'delivery-start-gate',
    phase: 'delivery',
    gate: 'work_allowed',
    title: 'Confirm work is allowed before starting',
    description: 'Do not start work or buy materials until the agreement is accepted and the agreement start date has arrived.',
  },
  {
    id: 'delivery-brief-workers',
    phase: 'delivery',
    gate: 'work_allowed',
    title: 'Brief workers or contractors',
    description: 'Make sure anyone doing the work understands the grant requirements, evidence needs, and specification.',
  },
  {
    id: 'delivery-collect-records',
    phase: 'delivery',
    gate: 'work_complete',
    title: 'Collect delivery records',
    description: 'Keep invoices, receipts, timesheets, measurements, during-work photos, and notes on any changes.',
  },
  {
    id: 'claim-pack',
    phase: 'claim',
    gate: 'claim_ready',
    title: 'Assemble claim pack',
    description: 'Collect after-work photos, invoices or timesheets, permissions, measurements, map references, and missing evidence notes.',
  },
  {
    id: 'claim-submit',
    phase: 'claim',
    gate: 'claim_submitted',
    title: 'Submit claim through official route',
    description: 'Submit the claim through Rural Payments or the relevant official route, then save the claim reference and date.',
  },
  {
    id: 'payment-review',
    phase: 'payment_review',
    gate: 'reviewed',
    title: 'Review estimate against actuals',
    description: 'Record actual payment and costs, explain variance, and capture what went better or worse for next time.',
  },
  {
    id: 'maintenance-schedule',
    phase: 'maintenance',
    gate: 'maintenance',
    title: 'Schedule durability and maintenance checks',
    description: 'Keep inspection notes, photos, and repair records through the durability period.',
  },
];

export const GRANT_LIFECYCLE_GUIDE_URL = 'https://github.com/peter-wilkins/jobdone/blob/main/docs/grant-lifecycle-task-guide.md';

const OPTION_SPECIFIC_TASKS = {
  'uk-england.capital-grants-2026/rp32-small-leaky-woody-dams': [
    {
      id: 'preapp-csf-support',
      phase: 'pre_application',
      gate: 'application_ready',
      title: 'Get Catchment Sensitive Farming support',
      description: 'Small leaky woody dams need Catchment Sensitive Farming support in the current seed model.',
    },
    {
      id: 'preapp-measure-channel',
      phase: 'pre_application',
      gate: 'application_ready',
      title: 'Confirm small dam size fit',
      description: 'Measure channel width or runoff pathway length and record whether it fits the small leaky dam rule.',
    },
  ],
  'uk-england.capital-grants-2026/rp33-large-leaky-woody-dams': [
    {
      id: 'preapp-csf-support',
      phase: 'pre_application',
      gate: 'application_ready',
      title: 'Get Catchment Sensitive Farming support',
      description: 'Large leaky woody dams need Catchment Sensitive Farming support in the current seed model.',
    },
    {
      id: 'preapp-measure-channel',
      phase: 'pre_application',
      gate: 'application_ready',
      title: 'Confirm large dam size fit',
      description: 'Measure channel width or runoff pathway length and record whether it fits the large leaky dam rule.',
    },
  ],
  'uk-england.capital-grants-2026/wn12-create-or-restore-ponds-up-to-2ha': [
    {
      id: 'preapp-measure-pond-area',
      phase: 'pre_application',
      gate: 'application_ready',
      title: 'Estimate pond area and buffer needs',
      description: 'Record proposed pond area and whether surrounding land use means a buffer strip may be needed.',
    },
    {
      id: 'preapp-pond-restoration-check',
      phase: 'pre_application',
      gate: 'application_ready',
      title: 'Check pond wildlife and historic interest',
      description: 'For restoration, check whether assessment is needed before disturbing the existing pond.',
    },
  ],
};

export const LIFECYCLE_PHASE_LABELS = {
  explore: 'Explore',
  pre_application: 'Pre-application',
  application: 'Application',
  agreement: 'Agreement',
  delivery: 'Delivery',
  claim: 'Claim',
  payment_review: 'Payment review',
  maintenance: 'Maintenance',
};

function mergeTasksForBudget(budget) {
  const optionTasks = OPTION_SPECIFIC_TASKS[budget?.fundingOptionId] || [];
  const byId = new Map();
  [...GENERIC_TASKS, ...optionTasks].forEach(task => {
    byId.set(task.id, {
      ...task,
      guideHref: `${GRANT_LIFECYCLE_GUIDE_URL}#${task.id}`,
    });
  });
  return [...byId.values()];
}

export function buildGrantLifecycleRecord({
  existing = null,
  site,
  budget,
  now = new Date().toISOString(),
}) {
  const existingTasksById = new Map((existing?.tasks || []).map(task => [task.id, task]));
  const tasks = mergeTasksForBudget(budget).map(task => {
    const existingTask = existingTasksById.get(task.id);
    return {
      ...task,
      completed: Boolean(existingTask?.completed),
      completedAt: existingTask?.completedAt || null,
    };
  });

  return {
    schemaVersion: 'jobdone.waterWalkGrantLifecycle.v1',
    id: existing?.id || `water-walk-lifecycle-${budget.id}`,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    siteId: site.id,
    siteLabel: site.label,
    budgetId: budget.id,
    targetType: budget.targetType,
    targetId: budget.targetId,
    targetTitle: budget.targetTitle,
    fundingOptionId: budget.fundingOptionId,
    fundingOptionName: budget.fundingOptionName,
    workAllowed: false,
    caution: 'Do not start work or buy materials until the agreement is accepted and the agreement start date has arrived.',
    tasks,
  };
}

export function lifecycleForBudget(lifecycles = [], budget = null) {
  if (!budget) return null;
  return lifecycles.find(lifecycle => lifecycle.budgetId === budget.id) || null;
}

export function upsertLifecycle(lifecycles = [], lifecycle) {
  const withoutExisting = lifecycles.filter(item => item.id !== lifecycle.id);
  return [lifecycle, ...withoutExisting];
}

export function toggleLifecycleTask(lifecycle, taskId, completed, now = new Date().toISOString()) {
  if (!lifecycle) return null;
  return {
    ...lifecycle,
    updatedAt: now,
    tasks: lifecycle.tasks.map(task => (
      task.id === taskId
        ? {
          ...task,
          completed,
          completedAt: completed ? now : null,
        }
        : task
    )),
  };
}

export function lifecycleProgress(lifecycle = null) {
  const tasks = lifecycle?.tasks || [];
  const completed = tasks.filter(task => task.completed).length;
  return {
    completed,
    total: tasks.length,
    label: `${completed}/${tasks.length}`,
  };
}
