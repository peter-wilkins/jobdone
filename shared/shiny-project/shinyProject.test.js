import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROJECT_STATUSES,
  applyProjectCommand,
  currentQuote,
  deriveProjectStatus,
  emptyProjectModel,
  evaluateQuote,
  shinyArtShopQuoteRules,
} from './index.js';

const projectId = 'project-1';
const customer = { role: 'customer', userId: 'customer-1', email: 'customer@example.com' };
const anonymousCustomer = { role: 'customer', userId: 'anon-1', anonymous: true };
const builder = { role: 'builder', userId: 'builder-1', email: 'builder@example.com' };
const system = { role: 'system', userId: 'system' };
const now = '2026-07-12T10:00:00.000Z';

const baseQuoteInput = {
  productType: 'embossed_metal_picture',
  material: 'aluminium',
  finish: 'natural',
  size: 'A4',
  quantity: 1,
  deadline: 'standard',
  orderNotes: '',
};

function cmd(type, extra = {}, actor = customer, n = 1) {
  return {
    id: `${type}-${n}`,
    projectId,
    actor,
    createdAt: new Date(Date.parse(now) + n * 1000).toISOString(),
    type,
    ...extra,
  };
}

function apply(model, command) {
  const result = applyProjectCommand(model, command);
  if (result.accepted) return result.model;
  return model;
}

function buildQuotedProject() {
  let model = emptyProjectModel();
  model = apply(model, cmd('createProject', {
    title: 'Boat name plate',
    ownerUserId: customer.userId,
    productSurface: 'shiny_art_shop',
  }, customer, 1));
  model = apply(model, cmd('uploadProjectFile', {
    fileId: 'file-1',
    kind: 'customer_upload',
    filename: 'boat.jpg',
    mimeType: 'image/jpeg',
  }, customer, 2));
  model = apply(model, cmd('generatePreview', { sourceFileId: 'file-1' }, customer, 3));
  model = apply(model, cmd('configureQuote', { quoteInput: baseQuoteInput }, customer, 4));
  return model;
}

function acceptAndPay(model) {
  const quote = currentQuote(model);
  model = apply(model, cmd('acceptQuote', {
    quoteSnapshotId: quote.id,
    termsVersion: 'v1',
    termsText: 'Custom order terms accepted.',
  }, customer, 5));
  return apply(model, cmd('recordPaymentReceived', {
    paymentId: 'pay-1',
    quoteSnapshotId: quote.id,
    amount: quote.result.depositDue,
  }, system, 6));
}

test('quote rules are deterministic and send notes to human review', () => {
  const auto = evaluateQuote(shinyArtShopQuoteRules.latest, baseQuoteInput);
  assert.equal(auto.canAutoQuote, true);
  assert.equal(auto.price, 80);
  assert.equal(auto.depositDue, 16);
  assert.equal(auto.balanceDue, 64);

  const withNotes = evaluateQuote(shinyArtShopQuoteRules.latest, {
    ...baseQuoteInput,
    orderNotes: 'Can you make it look like old brass?',
  });
  assert.equal(withNotes.canAutoQuote, false);
  assert.deepEqual(withNotes.reviewReasons, ['order_notes_present']);
});

test('Zod rejects malformed command input at the pure model boundary', () => {
  assert.throws(() => applyProjectCommand(emptyProjectModel(), {
    type: 'createProject',
    id: 'bad',
    projectId,
    actor: { role: 'customer', userId: 'customer-1' },
    createdAt: 'not-a-date',
    title: 'Bad date',
    ownerUserId: customer.userId,
    productSurface: 'shiny_art_shop',
  }));
});

test('happy path reaches workshop, approval, balance, and complete states', () => {
  let model = acceptAndPay(buildQuotedProject());
  const quote = currentQuote(model);
  assert.equal(deriveProjectStatus(model), 'ready_for_workshop');

  model = apply(model, cmd('startProduction', {
    quoteSnapshotId: quote.id,
    confirmationText: 'Materials ready and custom-order terms checked.',
  }, builder, 7));
  assert.equal(deriveProjectStatus(model), 'in_production');

  model = apply(model, cmd('uploadWorkshopPhoto', {
    fileId: 'photo-1',
    filename: 'finished.jpg',
    mimeType: 'image/jpeg',
  }, builder, 8));
  assert.equal(deriveProjectStatus(model), 'awaiting_customer_approval');

  model = apply(model, cmd('approveFinishedPiece', { approvalPhotoFileId: 'photo-1' }, customer, 9));
  assert.equal(deriveProjectStatus(model), 'awaiting_balance');

  model = apply(model, cmd('recordPaymentReceived', {
    paymentId: 'pay-2',
    quoteSnapshotId: quote.id,
    amount: quote.result.balanceDue,
  }, system, 10));
  assert.equal(deriveProjectStatus(model), 'ready');

  model = apply(model, cmd('markComplete', {}, { role: 'admin', userId: 'admin-1' }, 11));
  assert.equal(deriveProjectStatus(model), 'complete');
});

test('customer cannot start production and cannot cancel after production starts', () => {
  let model = acceptAndPay(buildQuotedProject());
  const quote = currentQuote(model);

  const customerStart = applyProjectCommand(model, cmd('startProduction', {
    quoteSnapshotId: quote.id,
    confirmationText: 'I want this started.',
  }, customer, 7));
  assert.equal(customerStart.accepted, false);
  assert.equal(customerStart.code, 'forbidden');
  assert.equal(deriveProjectStatus(model), 'ready_for_workshop');

  model = apply(model, cmd('startProduction', {
    quoteSnapshotId: quote.id,
    confirmationText: 'Builder checked paid deposit.',
  }, builder, 8));
  const cancel = applyProjectCommand(model, cmd('cancelBeforeProduction', {}, customer, 9));
  assert.equal(cancel.accepted, false);
  assert.equal(cancel.code, 'cannot_cancel_now');
  assert.equal(deriveProjectStatus(model), 'in_production');
});

test('quote snapshots stay immutable after quote acceptance', () => {
  let model = buildQuotedProject();
  const before = JSON.stringify(model.quotes);
  const quote = currentQuote(model);
  model = apply(model, cmd('acceptQuote', {
    quoteSnapshotId: quote.id,
    termsVersion: 'v1',
    termsText: 'Custom order terms accepted.',
  }, customer, 5));

  assert.equal(JSON.stringify(model.quotes), before);
  assert.equal(currentQuote(model).id, quote.id);
});

test('anonymous preview quota is enforced as a defined user error', () => {
  let model = emptyProjectModel();
  model = apply(model, cmd('createProject', {
    title: 'Anonymous art',
    ownerUserId: anonymousCustomer.userId,
    productSurface: 'shiny_art_shop',
  }, anonymousCustomer, 1));
  model = apply(model, cmd('uploadProjectFile', {
    fileId: 'file-1',
    kind: 'customer_upload',
    filename: 'upload.jpg',
    mimeType: 'image/jpeg',
  }, anonymousCustomer, 2));
  model = apply(model, cmd('generatePreview', { sourceFileId: 'file-1' }, anonymousCustomer, 3));

  const second = applyProjectCommand(model, cmd('generatePreview', { sourceFileId: 'file-1' }, anonymousCustomer, 4));
  assert.equal(second.accepted, false);
  assert.equal(second.code, 'anonymous_preview_limit');
});

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function choose(rand, items) {
  return items[Math.floor(rand() * items.length)];
}

function quoteFingerprints(model) {
  return new Map((model.quotes || []).map(quote => [quote.id, JSON.stringify(quote)]));
}

function assertInvariants(model, previousQuotes) {
  const status = deriveProjectStatus(model);
  assert.ok(PROJECT_STATUSES.includes(status), `unknown status ${status}`);

  const events = model.events || [];
  const hasProduction = events.some(event => event.type === 'production_started');
  const hasApproval = (model.approvals || []).some(approval => approval.type === 'finished_piece_approved');
  const hasWorkshopPhoto = (model.files || []).some(file => file.kind === 'workshop_photo');
  const current = currentQuote(model);
  const paymentTotal = current
    ? (model.payments || [])
      .filter(payment => payment.quoteSnapshotId === current.id && payment.status === 'received')
      .reduce((sum, payment) => sum + payment.amount, 0)
    : 0;

  if (['in_production', 'awaiting_customer_approval', 'awaiting_balance', 'ready', 'complete'].includes(status)) {
    assert.equal(hasProduction, true, `${status} without production_started`);
    assert.ok(current, `${status} without quote`);
    assert.ok(paymentTotal >= current.result.depositDue, `${status} without required payment`);
  }
  if (['awaiting_customer_approval', 'awaiting_balance', 'ready', 'complete'].includes(status)) {
    assert.equal(hasWorkshopPhoto, true, `${status} without workshop photo`);
  }
  if (['ready', 'complete'].includes(status)) {
    assert.equal(hasApproval, true, `${status} without customer approval`);
    assert.ok(paymentTotal >= current.result.price, `${status} without full balance`);
  }
  if (status === 'cancelled') {
    assert.equal(hasProduction, false, 'cancelled after production_started');
  }

  for (const quote of model.quotes || []) {
    if (previousQuotes.has(quote.id)) {
      assert.equal(JSON.stringify(quote), previousQuotes.get(quote.id), `quote snapshot mutated: ${quote.id}`);
    }
  }
}

test('property loop: random command streams preserve project invariants', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const rand = random(seed);
    let model = emptyProjectModel();
    let previousQuotes = quoteFingerprints(model);

    for (let step = 1; step <= 80; step += 1) {
      const quote = currentQuote(model);
      const file = model.files.find(item => item.kind === 'customer_upload');
      const workshopPhoto = model.files.find(item => item.kind === 'workshop_photo');
      const actor = choose(rand, [customer, builder, { role: 'admin', userId: 'admin-1' }, system]);
      const action = choose(rand, [
        'createProject',
        'uploadProjectFile',
        'generatePreview',
        'configureQuote',
        'acceptQuote',
        'recordPaymentReceived',
        'cancelBeforeProduction',
        'startProduction',
        'uploadWorkshopPhoto',
        'approveFinishedPiece',
        'markComplete',
      ]);
      const n = seed * 1000 + step;
      const command = {
        createProject: () => cmd('createProject', {
          title: `Generated project ${seed}`,
          ownerUserId: customer.userId,
          productSurface: 'shiny_art_shop',
        }, actor, n),
        uploadProjectFile: () => cmd('uploadProjectFile', {
          fileId: `file-${n}`,
          kind: 'customer_upload',
          filename: `upload-${n}.jpg`,
          mimeType: 'image/jpeg',
        }, actor, n),
        generatePreview: () => cmd('generatePreview', {
          sourceFileId: file?.id || `missing-${n}`,
        }, actor, n),
        configureQuote: () => cmd('configureQuote', {
          quoteInput: {
            ...baseQuoteInput,
            size: choose(rand, ['A5', 'A4']),
            quantity: Math.floor(rand() * 4) + 1,
            deadline: choose(rand, ['standard', 'rush_3_5_days', 'next_day']),
            orderNotes: rand() > 0.8 ? 'Please check this detail.' : '',
          },
        }, actor, n),
        acceptQuote: () => cmd('acceptQuote', {
          quoteSnapshotId: quote?.id || `missing-quote-${n}`,
          termsVersion: 'v1',
          termsText: 'Custom order terms accepted.',
        }, actor, n),
        recordPaymentReceived: () => cmd('recordPaymentReceived', {
          paymentId: `pay-${n}`,
          quoteSnapshotId: quote?.id || `missing-quote-${n}`,
          amount: quote?.result?.depositDue || 10,
        }, actor, n),
        cancelBeforeProduction: () => cmd('cancelBeforeProduction', {}, actor, n),
        startProduction: () => cmd('startProduction', {
          quoteSnapshotId: quote?.id || `missing-quote-${n}`,
          confirmationText: 'Workshop checked payment and terms.',
        }, actor, n),
        uploadWorkshopPhoto: () => cmd('uploadWorkshopPhoto', {
          fileId: `workshop-${n}`,
          filename: `workshop-${n}.jpg`,
          mimeType: 'image/jpeg',
        }, actor, n),
        approveFinishedPiece: () => cmd('approveFinishedPiece', {
          approvalPhotoFileId: workshopPhoto?.id || `missing-photo-${n}`,
        }, actor, n),
        markComplete: () => cmd('markComplete', {}, actor, n),
      }[action]();

      const result = applyProjectCommand(model, command);
      if (result.accepted) model = result.model;
      assertInvariants(model, previousQuotes);
      previousQuotes = quoteFingerprints(model);
    }
  }
});
