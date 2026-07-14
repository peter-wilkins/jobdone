import { parseProjectCommand } from './schemas.js';
import { emptyProjectModel, deriveProjectStatus, currentQuote, quoteAccepted, requiredPaymentReceived } from './status.js';
import { evaluateQuote } from './quoteEngine.js';
import { shinyArtShopQuoteRules } from './quoteRules/shinyArtShop/index.js';

const ROLE_COMMANDS = {
  customer: new Set([
    'createProject',
    'uploadProjectFile',
    'generatePreview',
    'requestDesignPreview',
    'configureQuote',
    'acceptQuote',
    'cancelBeforeProduction',
    'requestAdjustment',
    'approveFinishedPiece',
  ]),
  builder: new Set(['startProduction', 'uploadWorkshopPhoto', 'markReady']),
  admin: new Set([
    'offerManualQuote',
    'declineProject',
    'startProduction',
    'uploadWorkshopPhoto',
    'markReady',
    'markComplete',
    'resolveHumanAttention',
    'recordRefund',
  ]),
  system: new Set([
    'generatePreview',
    'recordDesignPreviewGenerated',
    'recordDesignPreviewFailed',
    'recordPaymentReceived',
    'recordPaymentFailed',
    'recordRefund',
  ]),
};

function cloneModel(model = emptyProjectModel()) {
  return {
    project: model.project ? { ...model.project } : null,
    files: [...(model.files || [])],
    previews: [...(model.previews || [])],
    quotes: [...(model.quotes || [])],
    payments: [...(model.payments || [])],
    refunds: [...(model.refunds || [])],
    approvals: [...(model.approvals || [])],
    events: [...(model.events || [])],
    opsEvents: [...(model.opsEvents || [])],
  };
}

function businessEvent(command, type, payload = {}) {
  return {
    id: `${command.id}:${type}`,
    type,
    projectId: command.projectId,
    actorRole: command.actor.role,
    actorUserId: command.actor.userId,
    createdAt: command.createdAt,
    requestId: command.requestId || null,
    ...payload,
  };
}

function reject(message, code = 'invalid_command') {
  return { accepted: false, code, message };
}

function withHumanAttention(model, command, reason, statusBefore) {
  const next = cloneModel(model);
  next.events.push(businessEvent(command, 'requires_human_attention', { reason }));
  next.opsEvents.push({
    id: `${command.id}:ops`,
    type: 'project_command_attention',
    projectId: command.projectId,
    attemptedCommand: command.type,
    actorRole: command.actor.role,
    statusBefore,
    reason,
    requestId: command.requestId || null,
    createdAt: command.createdAt,
  });
  return {
    accepted: true,
    humanAttention: true,
    message: "This project needs a quick human check. Don't worry, we're on it and will update you shortly.",
    model: next,
    status: deriveProjectStatus(next),
  };
}

function applyAccepted(model, command, mutator) {
  const next = cloneModel(model);
  mutator(next);
  return { accepted: true, model: next, status: deriveProjectStatus(next) };
}

function quoteById(model, quoteId) {
  return (model.quotes || []).find(quote => quote.id === quoteId) || null;
}

function paymentById(model, paymentId) {
  return (model.payments || []).find(payment => payment.paymentId === paymentId) || null;
}

export function applyProjectCommand(rawModel = emptyProjectModel(), rawCommand, {
  ruleset = shinyArtShopQuoteRules.latest,
} = {}) {
  const command = parseProjectCommand(rawCommand);
  const model = cloneModel(rawModel);
  const statusBefore = deriveProjectStatus(model);

  if (!ROLE_COMMANDS[command.actor.role]?.has(command.type)) {
    return reject('This action is not available to this role.', 'forbidden');
  }

  if (command.type !== 'createProject' && !model.project) {
    return reject('Project does not exist yet.', 'project_missing');
  }

  if (command.type === 'createProject') {
    if (model.project) return reject('Project already exists.', 'project_exists');
    return applyAccepted(model, command, next => {
      next.project = {
        id: command.projectId,
        ownerUserId: command.ownerUserId,
        productSurface: command.productSurface,
        title: command.title,
        createdAt: command.createdAt,
      };
      next.events.push(businessEvent(command, 'project_created'));
    });
  }

  if (statusBefore === 'requires_human_attention' && command.type !== 'resolveHumanAttention') {
    return reject('Project needs human attention before more actions.', 'human_attention_required');
  }
  if (['cancelled', 'declined', 'complete'].includes(statusBefore)) {
    return reject('Project is closed.', 'project_closed');
  }

  switch (command.type) {
    case 'uploadProjectFile':
      return applyAccepted(model, command, next => {
        next.files.push({
          id: command.fileId,
          projectId: command.projectId,
          kind: command.kind,
          filename: command.filename,
          mimeType: command.mimeType,
          createdAt: command.createdAt,
        });
        next.events.push(businessEvent(command, 'project_file_uploaded', { fileId: command.fileId, kind: command.kind }));
      });

    case 'generatePreview': {
      const hasSource = model.files.some(file => file.id === command.sourceFileId && file.kind === 'customer_upload');
      if (!hasSource) return reject('Upload an image before generating a preview.', 'source_file_missing');
      const anonymousPreviewCount = command.actor.anonymous
        ? model.previews.filter(preview => preview.actorUserId === command.actor.userId).length
        : 0;
      if (anonymousPreviewCount >= 1) return reject('Sign in with Google to create more previews.', 'anonymous_preview_limit');
      return applyAccepted(model, command, next => {
        next.previews.push({
          id: `${command.id}:preview`,
          projectId: command.projectId,
          sourceFileId: command.sourceFileId,
          outputFileId: command.sourceFileId,
          actorUserId: command.actor.userId,
          createdAt: command.createdAt,
        });
        next.events.push(businessEvent(command, 'preview_generated', { sourceFileId: command.sourceFileId }));
      });
    }

    case 'requestDesignPreview': {
      const hasSource = model.files.some(file => file.id === command.sourceFileId && file.kind === 'customer_upload');
      if (!hasSource) return reject('Upload an image before creating a preview.', 'source_file_missing');
      const successfulPreviewForVersion = model.previews.some(preview =>
        preview.kind === 'generated_design_preview' &&
        preview.generatorVersion === command.generatorVersion
      );
      if (successfulPreviewForVersion) return reject('This project already has a generated preview.', 'anonymous_preview_limit');
      return applyAccepted(model, command, next => {
        next.events.push(businessEvent(command, 'design_preview_requested', {
          sourceFileId: command.sourceFileId,
          designDirection: command.designDirection,
          designDirectionHash: command.designDirectionHash,
          generatorVersion: command.generatorVersion,
        }));
      });
    }

    case 'recordDesignPreviewGenerated': {
      const hasSource = model.files.some(file => file.id === command.sourceFileId && file.kind === 'customer_upload');
      if (!hasSource) return withHumanAttention(model, command, 'generated preview source image was missing', statusBefore);
      return applyAccepted(model, command, next => {
        next.files.push({
          id: command.outputFileId,
          projectId: command.projectId,
          kind: 'generated_preview',
          filename: command.filename,
          mimeType: command.mimeType,
          dataBase64: command.dataBase64,
          byteSize: Math.ceil(command.dataBase64.length * 3 / 4),
          createdAt: command.createdAt,
        });
        next.previews.push({
          id: `${command.id}:preview`,
          kind: 'generated_design_preview',
          projectId: command.projectId,
          sourceFileId: command.sourceFileId,
          outputFileId: command.outputFileId,
          designDirection: command.designDirection,
          designDirectionHash: command.designDirectionHash,
          generatorVersion: command.generatorVersion,
          provider: command.provider,
          promptText: command.promptText,
          usage: command.usage,
          createdAt: command.createdAt,
        });
        next.events.push(businessEvent(command, 'design_preview_generated', {
          sourceFileId: command.sourceFileId,
          outputFileId: command.outputFileId,
          designDirectionHash: command.designDirectionHash,
          generatorVersion: command.generatorVersion,
          provider: command.provider,
        }));
      });
    }

    case 'recordDesignPreviewFailed':
      return applyAccepted(model, command, next => {
        next.events.push(businessEvent(command, 'design_preview_failed', {
          sourceFileId: command.sourceFileId,
          designDirection: command.designDirection,
          designDirectionHash: command.designDirectionHash,
          generatorVersion: command.generatorVersion,
          errorCategory: command.errorCategory,
          message: command.message,
        }));
      });

    case 'configureQuote': {
      if (!model.previews.length) return reject('Generate a preview before configuring a quote.', 'preview_missing');
      if (['ready_for_workshop', 'in_production', 'awaiting_customer_approval', 'awaiting_balance', 'ready'].includes(statusBefore)) {
        return reject('Paid order details cannot be changed here. Contact the workshop for changes.', 'paid_order_locked');
      }
      const result = evaluateQuote(ruleset, command.quoteInput);
      return applyAccepted(model, command, next => {
        next.quotes.push({
          id: `${command.id}:quote`,
          projectId: command.projectId,
          rulesetId: result.rulesetId,
          status: result.canAutoQuote ? 'offered' : 'needs_review',
          canAutoQuote: result.canAutoQuote,
          input: command.quoteInput,
          result,
          reviewReasons: result.reviewReasons,
          createdAt: command.createdAt,
        });
        next.events.push(businessEvent(command, 'quote_configured', {
          quoteSnapshotId: `${command.id}:quote`,
          canAutoQuote: result.canAutoQuote,
          reviewReasons: result.reviewReasons,
        }));
      });
    }

    case 'acceptQuote': {
      const quote = quoteById(model, command.quoteSnapshotId);
      if (!quote || quote.status !== 'offered') return withHumanAttention(model, command, 'accepted quote was missing or not offered', statusBefore);
      return applyAccepted(model, command, next => {
        next.events.push(businessEvent(command, 'custom_order_terms_accepted', {
          quoteSnapshotId: quote.id,
          termsVersion: command.termsVersion,
          termsText: command.termsText,
        }));
        next.events.push(businessEvent(command, 'quote_accepted', { quoteSnapshotId: quote.id }));
      });
    }

    case 'recordPaymentReceived': {
      const quote = quoteById(model, command.quoteSnapshotId);
      if (!quote || !quoteAccepted(model, quote.id)) {
        return withHumanAttention(model, command, 'payment received without active quote', statusBefore);
      }
      const existing = paymentById(model, command.paymentId);
      if (existing) {
        if (existing.amount === command.amount && existing.quoteSnapshotId === command.quoteSnapshotId) {
          return { accepted: true, idempotent: true, model, status: statusBefore };
        }
        return withHumanAttention(model, command, 'duplicate payment id with different details', statusBefore);
      }
      return applyAccepted(model, command, next => {
        next.payments.push({
          paymentId: command.paymentId,
          projectId: command.projectId,
          quoteSnapshotId: command.quoteSnapshotId,
          amount: command.amount,
          status: 'received',
          createdAt: command.createdAt,
        });
        next.events.push(businessEvent(command, 'payment_received', {
          paymentId: command.paymentId,
          quoteSnapshotId: command.quoteSnapshotId,
          amount: command.amount,
        }));
      });
    }

    case 'recordPaymentFailed':
      return applyAccepted(model, command, next => {
        next.payments.push({
          paymentId: command.paymentId,
          projectId: command.projectId,
          quoteSnapshotId: command.quoteSnapshotId,
          amount: 0,
          status: 'failed',
          reason: command.reason,
          createdAt: command.createdAt,
        });
        next.events.push(businessEvent(command, 'payment_failed', {
          paymentId: command.paymentId,
          quoteSnapshotId: command.quoteSnapshotId,
          reason: command.reason,
        }));
      });

    case 'cancelBeforeProduction':
      if (statusBefore !== 'ready_for_workshop') return reject('This project can only be cancelled automatically before production starts.', 'cannot_cancel_now');
      return applyAccepted(model, command, next => {
        next.events.push(businessEvent(command, 'project_cancelled_by_customer'));
      });

    case 'startProduction': {
      const quote = currentQuote(model);
      if (
        statusBefore !== 'ready_for_workshop'
        || !quote
        || quote.id !== command.quoteSnapshotId
        || !quoteAccepted(model, quote.id)
        || !requiredPaymentReceived(model, quote)
      ) {
        return withHumanAttention(model, command, 'production start attempted before project was ready', statusBefore);
      }
      return applyAccepted(model, command, next => {
        next.events.push(businessEvent(command, 'production_started', {
          confirmationText: command.confirmationText,
          quoteSnapshotId: command.quoteSnapshotId,
        }));
      });
    }

    case 'uploadWorkshopPhoto':
      if (statusBefore !== 'in_production') return reject('Workshop photo can be uploaded after production starts.', 'production_not_started');
      return applyAccepted(model, command, next => {
        next.files.push({
          id: command.fileId,
          projectId: command.projectId,
          kind: 'workshop_photo',
          filename: command.filename,
          mimeType: command.mimeType,
          createdAt: command.createdAt,
        });
        next.events.push(businessEvent(command, 'workshop_photo_uploaded', { fileId: command.fileId }));
      });

    case 'requestAdjustment':
      if (statusBefore !== 'awaiting_customer_approval') return reject('Adjustments can be requested after the workshop photo.', 'approval_photo_missing');
      return applyAccepted(model, command, next => {
        next.events.push(businessEvent(command, 'adjustment_requested', { reason: command.reason }));
      });

    case 'approveFinishedPiece': {
      if (statusBefore !== 'awaiting_customer_approval') return reject('Finished piece can be approved after the workshop photo.', 'approval_photo_missing');
      const hasPhoto = model.files.some(file => file.id === command.approvalPhotoFileId && file.kind === 'workshop_photo');
      if (!hasPhoto) return reject('Approval photo was not found.', 'approval_photo_missing');
      return applyAccepted(model, command, next => {
        next.approvals.push({
          id: `${command.id}:approval`,
          projectId: command.projectId,
          type: 'finished_piece_approved',
          approvalPhotoFileId: command.approvalPhotoFileId,
          createdAt: command.createdAt,
        });
        next.events.push(businessEvent(command, 'finished_piece_approved', {
          approvalPhotoFileId: command.approvalPhotoFileId,
        }));
      });
    }

    case 'offerManualQuote':
      return applyAccepted(model, command, next => {
        const result = {
          rulesetId: ruleset.id,
          canAutoQuote: false,
          price: command.price,
          priceEstimate: command.price,
          depositDue: command.depositDue,
          balanceDue: command.balanceDue,
          paymentPolicy: command.balanceDue > 0
            ? { type: 'deposit_then_balance', dueNow: command.depositDue }
            : { type: 'full_upfront', dueNow: command.depositDue },
          explanation: command.explanation,
          reviewReasons: [],
        };
        next.quotes.push({
          id: `${command.id}:quote`,
          projectId: command.projectId,
          rulesetId: ruleset.id,
          status: 'offered',
          canAutoQuote: false,
          input: command.quoteInput,
          result,
          reviewReasons: [],
          createdAt: command.createdAt,
        });
        next.events.push(businessEvent(command, 'manual_quote_offered', { quoteSnapshotId: `${command.id}:quote` }));
      });

    case 'declineProject':
      return applyAccepted(model, command, next => {
        next.events.push(businessEvent(command, 'project_declined', { reason: command.reason }));
      });

    case 'markReady':
      if (statusBefore !== 'ready') return reject('Project can be marked ready after approval and payment.', 'not_ready');
      return applyAccepted(model, command, next => {
        next.events.push(businessEvent(command, 'project_ready'));
      });

    case 'markComplete':
      if (statusBefore !== 'ready') return reject('Project can be completed once ready.', 'not_ready');
      return applyAccepted(model, command, next => {
        next.events.push(businessEvent(command, 'project_completed'));
      });

    case 'resolveHumanAttention':
      return applyAccepted(model, command, next => {
        next.events = next.events.map(event => (
          event.type === 'requires_human_attention' && !event.resolvedAt
            ? { ...event, resolvedAt: command.createdAt, resolution: command.resolution }
            : event
        ));
        next.events.push(businessEvent(command, 'human_attention_resolved', { resolution: command.resolution }));
      });

    case 'recordRefund':
      return applyAccepted(model, command, next => {
        next.refunds.push({
          paymentId: command.paymentId,
          amount: command.amount,
          status: command.status,
          createdAt: command.createdAt,
        });
        next.events.push(businessEvent(command, 'refund_recorded', {
          paymentId: command.paymentId,
          amount: command.amount,
          status: command.status,
        }));
      });

    default:
      return withHumanAttention(model, command, `Unhandled command: ${command.type}`, statusBefore);
  }
}
