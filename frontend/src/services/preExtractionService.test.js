import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { runPreExtraction } from './preExtractionService.js';

const FAILURE_PATH = resolve(process.cwd(), '../tmp/pre-extraction-property-failures/latest.json');
const KINDS = ['contacts', 'locations', 'tags', 'teams', 'backlogItems'];

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function shuffle(random, values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function candidateField(kind) {
  if (kind === 'backlogItems') return 'description';
  if (kind === 'tags') return 'label';
  if (kind === 'teams') return 'name';
  return 'displayName';
}

function makeCandidate(kind, id, label, overrides = {}) {
  return {
    id,
    [candidateField(kind)]: label,
    ...overrides,
  };
}

function makeWorld(seed) {
  const random = rng(seed);
  const userId = 'user-main';
  const otherUserId = 'user-other';
  const words = ['boiler', 'sink', 'garden', 'pump', 'fence', 'radiator', 'van', 'shed', 'valve'];
  const people = ['Sarah Jenkins', 'Mrs Jones', 'Alex Patel', 'Ben Carter'];
  const places = ['14 Bell Street', 'Rose Cottage', 'Unit 7 Yard', 'North Field'];
  const tags = ['Follow Up', 'Invoice Needed', 'Safety Check', 'Parts Ordered'];
  const teams = ['Dogfood Team', 'Family Jobs', 'Workshop Crew', 'Garden Work'];
  const backlog = ['Clean kitchen sink trap', 'Cut back north hedge', 'Check van battery', 'Replace boiler valve'];

  return {
    seed,
    userId,
    targetKind: pick(random, KINDS),
    noise: shuffle(random, words).slice(0, 4).join(' '),
    labels: {
      contacts: pick(random, people),
      locations: pick(random, places),
      tags: pick(random, tags),
      teams: pick(random, teams),
      backlogItems: pick(random, backlog),
    },
    otherUserId,
  };
}

function buildExactCase(world) {
  const label = world.labels[world.targetKind];
  const targetId = `${world.targetKind}-target-${world.seed}`;
  const candidates = {};
  for (const kind of KINDS) {
    candidates[kind] = [
      makeCandidate(kind, `${kind}-noise-${world.seed}`, `${world.noise} noise`, { userId: world.userId }),
    ];
  }
  candidates[world.targetKind].push(makeCandidate(world.targetKind, targetId, label, { userId: world.userId }));

  return {
    id: `exact-${world.seed}`,
    property: 'exact candidate names are suggested first',
    seed: world.seed,
    userId: world.userId,
    captureText: `Please note ${label}. ${world.noise}.`,
    candidates,
    expect: {
      kind: world.targetKind,
      firstId: targetId,
    },
  };
}

function buildWrongUserCase(world) {
  const label = world.labels[world.targetKind];
  const blockedId = `${world.targetKind}-wrong-user-${world.seed}`;
  return {
    id: `wrong-user-${world.seed}`,
    property: 'wrong-user candidates are never suggested',
    seed: world.seed,
    userId: world.userId,
    captureText: `This clearly mentions ${label}.`,
    candidates: {
      [world.targetKind]: [
        makeCandidate(world.targetKind, blockedId, label, { userId: world.otherUserId }),
      ],
    },
    expect: {
      kind: world.targetKind,
      absentId: blockedId,
    },
  };
}

function buildUnavailableCase(world) {
  const label = world.labels[world.targetKind];
  const blockedId = `${world.targetKind}-unavailable-${world.seed}`;
  return {
    id: `unavailable-${world.seed}`,
    property: 'unavailable candidates are never suggested',
    seed: world.seed,
    userId: world.userId,
    captureText: `This clearly mentions ${label}.`,
    candidates: {
      [world.targetKind]: [
        makeCandidate(world.targetKind, blockedId, label, { userId: world.userId, available: false }),
      ],
    },
    expect: {
      kind: world.targetKind,
      absentId: blockedId,
    },
  };
}

function buildAmbiguousCase(world) {
  const label = world.labels[world.targetKind];
  return {
    id: `ambiguous-${world.seed}`,
    property: 'ambiguous exact matches remain suggestions',
    seed: world.seed,
    userId: world.userId,
    captureText: `This clearly mentions ${label}.`,
    candidates: {
      [world.targetKind]: [
        makeCandidate(world.targetKind, `${world.targetKind}-a-${world.seed}`, label, { userId: world.userId }),
        makeCandidate(world.targetKind, `${world.targetKind}-b-${world.seed}`, label, { userId: world.userId }),
      ],
    },
    expect: {
      kind: world.targetKind,
      ambiguous: true,
    },
  };
}

function buildPreservedSelectionCase(world) {
  const selected = `${world.targetKind}-selected-${world.seed}`;
  const suggested = `${world.targetKind}-suggested-${world.seed}`;
  return {
    id: `preserved-${world.seed}`,
    property: 'user-set context is preserved',
    seed: world.seed,
    userId: world.userId,
    captureText: `This clearly mentions ${world.labels[world.targetKind]}.`,
    candidates: {
      [world.targetKind]: [
        makeCandidate(world.targetKind, suggested, world.labels[world.targetKind], { userId: world.userId }),
      ],
    },
    userSelections: {
      [world.targetKind]: [selected],
    },
    expect: {
      preservedSelection: {
        kind: world.targetKind,
        id: selected,
      },
    },
  };
}

function generateCases() {
  const cases = [];
  for (let seed = 1000; seed < 1030; seed += 1) {
    const world = makeWorld(seed);
    cases.push(
      buildExactCase(world),
      buildWrongUserCase(world),
      buildUnavailableCase(world),
      buildAmbiguousCase(world),
      buildPreservedSelectionCase(world),
    );
  }
  return cases;
}

function validateCase(testCase) {
  const result = runPreExtraction(testCase);
  const suggestions = result.suggestions[testCase.expect.kind] || [];
  const actualIds = suggestions.map(candidate => candidate.id);
  const failures = [];

  if (testCase.expect.firstId && suggestions[0]?.id !== testCase.expect.firstId) {
    failures.push(`expected ${testCase.expect.firstId} first, got ${suggestions[0]?.id || '(none)'}`);
  }
  if (testCase.expect.absentId && actualIds.includes(testCase.expect.absentId)) {
    failures.push(`expected ${testCase.expect.absentId} to be absent, got ${actualIds.join(', ')}`);
  }
  if (testCase.expect.ambiguous === true && suggestions.some(candidate => !candidate.ambiguous)) {
    failures.push(`expected ambiguous suggestions, got ${JSON.stringify(suggestions)}`);
  }
  if (testCase.expect.preservedSelection) {
    const { kind, id } = testCase.expect.preservedSelection;
    const preserved = result.preservedUserSelections[kind] || [];
    if (!preserved.includes(id)) {
      failures.push(`expected user selection ${id} to be preserved, got ${preserved.join(', ')}`);
    }
  }
  if (result.durable !== false) {
    failures.push('expected pre-extraction result to be non-durable');
  }

  return { ok: failures.length === 0, failures, result };
}

function shrinkFailure(testCase, validation) {
  const kind = testCase.expect.kind || testCase.expect.preservedSelection?.kind;
  return {
    seed: testCase.seed,
    caseId: testCase.id,
    property: testCase.property,
    captureText: testCase.captureText,
    kind,
    candidates: {
      [kind]: testCase.candidates[kind] || [],
    },
    userSelections: testCase.userSelections || {},
    expect: testCase.expect,
    actual: validation.result.suggestions[kind] || [],
    preservedUserSelections: validation.result.preservedUserSelections,
    failures: validation.failures,
  };
}

async function writeFailure(failure) {
  await mkdir(dirname(FAILURE_PATH), { recursive: true });
  await writeFile(FAILURE_PATH, `${JSON.stringify(failure, null, 2)}\n`);
}

test('pre-extraction property loop keeps deterministic suggestions source-grounded', async () => {
  let checked = 0;
  for (const testCase of generateCases()) {
    checked += 1;
    const validation = validateCase(testCase);
    if (!validation.ok) {
      const failure = shrinkFailure(testCase, validation);
      await writeFailure(failure);
      assert.fail([
        `Pre-Extraction property failed: ${failure.property}`,
        `Seed: ${failure.seed}`,
        `Capture: ${failure.captureText}`,
        `Failures: ${failure.failures.join('; ')}`,
        `Shrunk repro: ${FAILURE_PATH}`,
      ].join('\n'));
    }
  }

  assert.equal(checked, 150);
});

test('pre-extraction ranks exact names over weaker keyword matches', () => {
  const result = runPreExtraction({
    userId: 'user-main',
    captureText: 'Follow up with Mrs Jones about the shed.',
    candidates: {
      contacts: [
        { id: 'weak', displayName: 'Jones Roofing', userId: 'user-main' },
        { id: 'exact', displayName: 'Mrs Jones', userId: 'user-main' },
      ],
    },
  });

  assert.deepEqual(result.suggestions.contacts.map(candidate => candidate.id), ['exact', 'weak']);
});

test('pre-extraction matches common address abbreviations', () => {
  const result = runPreExtraction({
    captureText: 'Finished the stopcock at Bell Rd.',
    candidates: {
      locations: [
        { id: 'wrong', displayName: 'Bell Lane' },
        { id: 'right', displayName: 'Bell Road' },
      ],
    },
  });

  assert.equal(result.suggestions.locations[0]?.id, 'right');
});

test('pre-extraction prefers greedy multi-token overlap over short accidental candidates', () => {
  const result = runPreExtraction({
    captureText: 'Replace the kitchen sink tap washer today.',
    candidates: {
      backlogItems: [
        { id: 'short', title: 'Do do', description: 'Do do' },
        { id: 'target', title: 'Replace sink tap', description: 'Kitchen tap washer replacement' },
      ],
    },
  });

  assert.equal(result.suggestions.backlogItems[0]?.id, 'target');
  assert.equal(result.suggestions.backlogItems.some(candidate => candidate.id === 'short'), false);
});

test('pre-extraction suggests backlog items from several description words', () => {
  const result = runPreExtraction({
    captureText: 'Did the kitchen sink trap clean today.',
    candidates: {
      backlogItems: [
        { id: 'weak', status: 'open', description: 'Clean windows' },
        { id: 'target', status: 'open', description: 'Clean kitchen sink trap' },
      ],
    },
  });

  assert.equal(result.suggestions.backlogItems[0]?.id, 'target');
});

test('pre-extraction property loop prefers higher meaningful overlap across generated backlog items', () => {
  const actionWords = ['replace', 'clean', 'check', 'repair', 'paint'];
  const objectWords = ['sink', 'boiler', 'fence', 'pump', 'radiator'];
  const detailWords = ['washer', 'valve', 'panel', 'seal', 'bracket'];
  let checked = 0;

  for (const action of actionWords) {
    for (const object of objectWords) {
      for (const detail of detailWords) {
        checked += 1;
        const result = runPreExtraction({
          captureText: `${action} the kitchen ${object} ${detail}`,
          candidates: {
            backlogItems: [
              { id: 'weak', title: action, description: 'Tiny accidental match' },
              { id: 'target', title: `${action} ${object}`, description: `Kitchen ${object} ${detail}` },
            ],
          },
        });

        if (result.suggestions.backlogItems[0]?.id !== 'target') {
          assert.fail(`Expected target first for ${action}/${object}/${detail}, got ${JSON.stringify(result.suggestions.backlogItems)}`);
        }
      }
    }
  }

  assert.equal(checked, 125);
});

test('pre-extraction keeps candidate detail for review controls', () => {
  const result = runPreExtraction({
    captureText: 'Went to 14 Bell Street.',
    candidates: {
      locations: [
        {
          id: 'loc-1',
          displayName: '14 Bell Street',
          addressText: '14 Bell Street, Exampletown',
          latitude: 53.1,
          longitude: -6.2,
        },
      ],
    },
  });

  assert.deepEqual(result.suggestions.locations[0], {
    id: 'loc-1',
    displayName: '14 Bell Street',
    addressText: '14 Bell Street, Exampletown',
    latitude: 53.1,
    longitude: -6.2,
    kind: 'locations',
    label: '14 Bell Street',
    score: 100,
    reason: 'exact_name_match',
    source: 'deterministic_pre_extraction',
    ambiguous: false,
    index: undefined,
  });
});
