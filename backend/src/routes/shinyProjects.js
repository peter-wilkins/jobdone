import { z } from 'zod';
import { createUuidV7 } from '../../../shared/contracts/clientId.js';
import {
  DesignDirectionSchema,
  QuoteInputSchema,
  applyProjectCommand,
  currentQuote,
  deriveProjectStatus,
  emptyProjectModel,
  isSellableDesignDirection,
  quoteAccepted,
  requiredPaymentReceived,
  sellableShinyDesignOptions,
  shinyDesignOptions,
} from '../../../shared/shiny-project/index.js';
import { createLocalReplicaStore } from '../services/localReplicaStore.js';
import {
  generateShinyDesignPreview,
  shinyGeneratorVersion,
} from '../services/shinyImageGenerator.js';

const defaultStore = createLocalReplicaStore({
  connectionString: process.env.LOCAL_REPLICA_DB_URL,
  schema: process.env.LOCAL_REPLICA_SCHEMA || 'jobdone',
});

const UploadSchema = z.object({
  projectId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  filename: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(120).refine(value => value.startsWith('image/'), 'mimeType must be an image'),
  dataBase64: z.string().min(1).max(20_000_000),
}).strict();

const PreviewRequestSchema = z.object({
  ownerUserId: z.string().uuid(),
  sourceImageId: z.string().uuid(),
  designDirection: DesignDirectionSchema,
}).strict();

const QuoteRequestSchema = z.object({
  ownerUserId: z.string().uuid(),
  quoteInput: QuoteInputSchema,
}).strict();

const AcceptQuoteRequestSchema = z.object({
  ownerUserId: z.string().uuid(),
  quoteSnapshotId: z.string().min(1),
  termsVersion: z.string().min(1),
  termsText: z.string().min(1),
}).strict();

const PayNowRequestSchema = z.object({
  ownerUserId: z.string().uuid(),
  quoteSnapshotId: z.string().min(1),
}).strict();

const ProjectLoadQuerySchema = z.object({
  ownerUserId: z.string().uuid(),
}).strict();

function stableHash(value) {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function command({ type, projectId, actor, now, extra = {}, index }) {
  return {
    id: createUuidV7(Date.parse(now) + index),
    projectId,
    actor,
    createdAt: new Date(Date.parse(now) + index).toISOString(),
    type,
    ...extra,
  };
}

function applyOrThrow(model, commandInput) {
  const result = applyProjectCommand(model, commandInput);
  if (!result.accepted) {
    const error = new Error(result.message || result.code || 'Project command rejected');
    error.statusCode = result.code === 'anonymous_preview_limit' ? 409 : 422;
    error.code = result.code;
    throw error;
  }
  return result.model;
}

function buildInitialProjectModel({ projectId, ownerUserId, filename, mimeType, dataBase64, now }) {
  const fileId = createUuidV7(Date.parse(now) + 10);
  const actor = { role: 'customer', userId: ownerUserId, anonymous: true };

  let model = emptyProjectModel();
  model = applyOrThrow(model, command({
    type: 'createProject',
    projectId,
    actor,
    now,
    index: 1,
    extra: {
      title: filename,
      ownerUserId,
      productSurface: 'shiny_art_shop',
    },
  }));
  model = applyOrThrow(model, command({
    type: 'uploadProjectFile',
    projectId,
    actor,
    now,
    index: 2,
    extra: {
      fileId,
      kind: 'customer_upload',
      filename,
      mimeType,
    },
  }));

  return {
    projectId,
    fileId,
    model: {
      ...model,
      files: model.files.map(file => file.id === fileId
        ? { ...file, dataBase64, byteSize: Buffer.byteLength(dataBase64, 'base64') }
        : file),
    },
  };
}

function projectPayload(model, status = 'source_image_uploaded', extra = {}) {
  return {
    kind: 'shinyProject',
    schemaVersion: 1,
    status,
    model,
    ...extra,
  };
}

async function pushObject({ store, ownerUserId, actorDeviceId, action, projectId, payloadJson, baseObjectT = null, now }) {
  const response = await store.push({
    actorUserId: ownerUserId,
    actorEmail: null,
    actorDeviceId,
    request: {
      replicaEpoch: createUuidV7(Date.parse(now) + 30),
      baseT: 0,
      intents: [{
        id: createUuidV7(Date.parse(now) + 20),
        ownerKind: 'user',
        ownerId: ownerUserId,
        collection: 'shinyProjects',
        action,
        objectId: projectId,
        baseObjectT,
        payloadJson,
        payloadHash: stableHash(payloadJson),
        createdAt: now,
      }],
    },
  });
  const result = response.results?.[0];
  if (!['accepted', 'idempotent'].includes(result?.status)) {
    const error = new Error(result?.reason || 'Project update conflicted');
    error.statusCode = 409;
    throw error;
  }
  return response.objects?.[0] || null;
}

async function loadProjectObject({ store, ownerUserId, projectId }) {
  const response = await store.pull({
    actorUserId: ownerUserId,
    request: {
      replicaEpoch: createUuidV7(),
      sinceT: 0,
      limit: 1000,
    },
  });
  return (response.objects || []).find(object =>
    object.ownerKind === 'user' &&
    object.ownerId === ownerUserId &&
    object.collection === 'shinyProjects' &&
    object.id === projectId
  ) || null;
}

function findGeneratedPreview(model, { sourceImageId, designDirectionHash, generatorVersion }) {
  const preview = (model.previews || []).find(item =>
    item.kind === 'generated_design_preview' &&
    item.sourceFileId === sourceImageId &&
    item.designDirectionHash === designDirectionHash &&
    item.generatorVersion === generatorVersion
  );
  if (!preview) return null;
  const file = (model.files || []).find(item => item.id === preview.outputFileId && item.kind === 'generated_preview');
  return file ? { preview, file } : null;
}

function latestDesignDirection(model) {
  const events = Array.isArray(model.events) ? model.events : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.designDirection) return event.designDirection;
  }
  return null;
}

function latestSourceImage(model, fallbackSourceImageId = null) {
  const files = Array.isArray(model.files) ? model.files : [];
  if (fallbackSourceImageId) {
    const file = files.find(item => item.id === fallbackSourceImageId && item.kind === 'customer_upload');
    if (file) return file;
  }
  return [...files].reverse().find(item => item.kind === 'customer_upload') || null;
}

function latestGeneratedPreview(model) {
  const previews = Array.isArray(model.previews) ? model.previews : [];
  const files = Array.isArray(model.files) ? model.files : [];
  for (let index = previews.length - 1; index >= 0; index -= 1) {
    const preview = previews[index];
    if (preview?.kind !== 'generated_design_preview') continue;
    const file = files.find(item => item.id === preview.outputFileId && item.kind === 'generated_preview');
    if (file) return { preview, file };
  }
  return null;
}

function projectResponseFromObject(object) {
  const payload = object.payloadJson || {};
  const model = payload.model || emptyProjectModel();
  const sourceImage = latestSourceImage(model, payload.sourceImageId);
  const generated = latestGeneratedPreview(model);
  const quote = currentQuote(model);
  const accepted = quote ? quoteAccepted(model, quote.id) : false;
  const paid = quote ? requiredPaymentReceived(model, quote) : false;
  return {
    projectId: object.id,
    ownerUserId: object.ownerId,
    status: payload.status || 'source_image_uploaded',
    projectStatus: deriveProjectStatus(model),
    sourceImageId: sourceImage?.id || payload.sourceImageId || null,
    sourceImage: sourceImage ? {
      fileId: sourceImage.id,
      filename: sourceImage.filename,
      mimeType: sourceImage.mimeType,
      dataBase64: sourceImage.dataBase64,
    } : null,
    designDirection: latestDesignDirection(model),
    previewImage: generated ? {
      fileId: generated.file.id,
      mimeType: generated.file.mimeType,
      dataBase64: generated.file.dataBase64,
    } : null,
    quote,
    quoteAccepted: accepted,
    requiredPaymentReceived: paid,
  };
}

function workshopQueueItemFromObject(object) {
  const response = projectResponseFromObject(object);
  const quoteInput = response.quote?.input || null;
  return {
    projectId: response.projectId,
    ownerUserId: response.ownerUserId,
    projectStatus: response.projectStatus,
    title: response.sourceImage?.filename || 'Untitled project',
    thumbnail: response.previewImage || response.sourceImage,
    designDirection: response.designDirection,
    quote: response.quote,
    quoteInput,
    quoteAccepted: response.quoteAccepted,
    requiredPaymentReceived: response.requiredPaymentReceived,
  };
}

export async function registerShinyProjectRoutes(fastify, deps = {}) {
  const store = deps.localReplicaStore ?? defaultStore;
  const imageGenerator = deps.imageGenerator ?? generateShinyDesignPreview;
  const options = deps.designOptions ?? shinyDesignOptions;

  fastify.get('/api/shiny/design-options', async () => sellableShinyDesignOptions(options));

  fastify.get('/api/shiny/workshop/queue', async (request, reply) => {
    if (!store?.configured) return reply.status(503).send({ error: 'Project database not configured' });
    if (typeof store.listObjects !== 'function') return reply.status(503).send({ error: 'Workshop queue unavailable' });

    const objects = await store.listObjects({ collection: 'shinyProjects', limit: 500 });
    const readyForWorkshop = objects
      .filter(object => object.payloadJson?.kind === 'shinyProject')
      .map(workshopQueueItemFromObject)
      .filter(project => project.projectStatus === 'ready_for_workshop');

    return { readyForWorkshop };
  });

  fastify.get('/api/shiny/projects/:projectId', async (request, reply) => {
    if (!store?.configured) return reply.status(503).send({ error: 'Project database not configured' });

    const parsed = ProjectLoadQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message || 'Invalid project load request',
        issues: parsed.error.issues.map(issue => issue.message),
      });
    }

    const object = await loadProjectObject({
      store,
      ownerUserId: parsed.data.ownerUserId,
      projectId: request.params.projectId,
    });
    if (!object) return reply.status(404).send({ error: 'Project not found' });
    return projectResponseFromObject(object);
  });

  fastify.post('/api/shiny/projects', async (request, reply) => {
    if (!store?.configured) return reply.status(503).send({ error: 'Project database not configured' });

    const parsed = UploadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message || 'Invalid project upload',
        issues: parsed.error.issues.map(issue => issue.message),
      });
    }

    try {
      const now = new Date().toISOString();
      const { projectId, ownerUserId, filename, mimeType, dataBase64 } = parsed.data;
      const { fileId, model } = buildInitialProjectModel({
        projectId,
        ownerUserId,
        filename,
        mimeType,
        dataBase64,
        now,
      });
      const payloadJson = projectPayload(model, 'source_image_uploaded', { sourceImageId: fileId });
      await pushObject({
        store,
        ownerUserId,
        actorDeviceId: request.headers['x-jobdone-device-id'] || null,
        action: 'createObject',
        projectId,
        payloadJson,
        now,
      });

      return {
        projectId,
        sourceImageId: fileId,
        status: 'source_image_uploaded',
      };
    } catch (error) {
      if (error.statusCode) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      request.log.error({ err: error }, 'shiny_project_create_failed');
      return reply.status(500).send({ error: 'Project upload failed' });
    }
  });

  fastify.post('/api/shiny/projects/:projectId/design-preview', async (request, reply) => {
    if (!store?.configured) return reply.status(503).send({ error: 'Project database not configured' });

    const parsed = PreviewRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message || 'Invalid design preview request',
        issues: parsed.error.issues.map(issue => issue.message),
      });
    }

    const projectId = request.params.projectId;
    const { ownerUserId, sourceImageId, designDirection } = parsed.data;
    if (!isSellableDesignDirection(designDirection, options)) {
      return reply.status(400).send({ error: 'That option is not currently available.' });
    }

    try {
      const object = await loadProjectObject({ store, ownerUserId, projectId });
      if (!object) return reply.status(404).send({ error: 'Project not found' });

      const generatorVersion = shinyGeneratorVersion();
      const designDirectionHash = stableHash({ sourceImageId, designDirection, generatorVersion });
      let model = object.payloadJson?.model || emptyProjectModel();
      const cached = findGeneratedPreview(model, { sourceImageId, designDirectionHash, generatorVersion });
      if (cached) {
        return {
          projectId,
          sourceImageId,
          status: 'design_preview_generated',
          cached: true,
          previewImage: {
            fileId: cached.file.id,
            mimeType: cached.file.mimeType,
            dataBase64: cached.file.dataBase64,
          },
        };
      }

      const sourceImage = (model.files || []).find(file => file.id === sourceImageId && file.kind === 'customer_upload');
      if (!sourceImage?.dataBase64) return reply.status(404).send({ error: 'Source image not found' });

      const now = new Date().toISOString();
      const actor = { role: 'customer', userId: ownerUserId, anonymous: true };
      model = applyOrThrow(model, command({
        type: 'requestDesignPreview',
        projectId,
        actor,
        now,
        index: 1,
        extra: {
          sourceFileId: sourceImageId,
          designDirection,
          designDirectionHash,
          generatorVersion,
        },
      }));

      const generated = await imageGenerator({ sourceImage, designDirection });
      if (!generated.ok) {
        model = applyOrThrow(model, command({
          type: 'recordDesignPreviewFailed',
          projectId,
          actor: { role: 'system', userId: 'system' },
          now,
          index: 2,
          extra: {
            sourceFileId: sourceImageId,
            designDirection,
            designDirectionHash,
            generatorVersion,
            errorCategory: generated.errorCategory || 'unknown',
            message: generated.message || 'Oops, we had a problem. Try again in a few minutes.',
          },
        }));
        await pushObject({
          store,
          ownerUserId,
          actorDeviceId: request.headers['x-jobdone-device-id'] || null,
          action: 'updateObject',
          projectId,
          baseObjectT: object.changedT,
          payloadJson: projectPayload(model, 'design_preview_failed', {
            sourceImageId,
            designDirectionHash,
          }),
          now,
        });
        return reply.status(generated.errorCategory === 'provider_not_configured' ? 503 : 502).send({
          error: 'Oops, we had a problem. Try again in a few minutes.',
          status: 'design_preview_failed',
          code: generated.errorCategory || 'unknown',
        });
      }

      const outputFileId = createUuidV7(Date.parse(now) + 50);
      model = applyOrThrow(model, command({
        type: 'recordDesignPreviewGenerated',
        projectId,
        actor: { role: 'system', userId: 'system' },
        now,
        index: 3,
        extra: {
          sourceFileId: sourceImageId,
          outputFileId,
          filename: `design-preview-${projectId}.jpg`,
          mimeType: generated.mimeType || 'image/jpeg',
          dataBase64: generated.dataBase64,
          designDirection,
          designDirectionHash,
          generatorVersion,
          provider: generated.provider || 'openai',
          promptText: generated.promptText,
          usage: generated.usage || {},
        },
      }));
      await pushObject({
        store,
        ownerUserId,
        actorDeviceId: request.headers['x-jobdone-device-id'] || null,
        action: 'updateObject',
        projectId,
        baseObjectT: object.changedT,
        payloadJson: projectPayload(model, 'design_preview_generated', {
          sourceImageId,
          designDirectionHash,
          previewFileId: outputFileId,
        }),
        now,
      });

      return {
        projectId,
        sourceImageId,
        status: 'design_preview_generated',
        cached: false,
        previewImage: {
          fileId: outputFileId,
          mimeType: generated.mimeType || 'image/jpeg',
          dataBase64: generated.dataBase64,
        },
      };
    } catch (error) {
      if (error.statusCode) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      request.log.error({ err: error }, 'shiny_design_preview_failed');
      return reply.status(500).send({ error: 'Design preview failed' });
    }
  });

  fastify.post('/api/shiny/projects/:projectId/quote', async (request, reply) => {
    if (!store?.configured) return reply.status(503).send({ error: 'Project database not configured' });

    const parsed = QuoteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message || 'Invalid quote request',
        issues: parsed.error.issues.map(issue => issue.message),
      });
    }

    const projectId = request.params.projectId;
    const { ownerUserId, quoteInput } = parsed.data;

    try {
      const object = await loadProjectObject({ store, ownerUserId, projectId });
      if (!object) return reply.status(404).send({ error: 'Project not found' });

      const now = new Date().toISOString();
      const actor = { role: 'customer', userId: ownerUserId, anonymous: true };
      const model = applyOrThrow(object.payloadJson?.model || emptyProjectModel(), command({
        type: 'configureQuote',
        projectId,
        actor,
        now,
        index: 1,
        extra: { quoteInput },
      }));
      const quote = currentQuote(model);
      await pushObject({
        store,
        ownerUserId,
        actorDeviceId: request.headers['x-jobdone-device-id'] || null,
        action: 'updateObject',
        projectId,
        baseObjectT: object.changedT,
        payloadJson: projectPayload(model, quote?.canAutoQuote ? 'quote_offered' : 'quote_needs_review', {
          quoteSnapshotId: quote?.id || null,
        }),
        now,
      });

      return {
        projectId,
        status: quote?.canAutoQuote ? 'quote_offered' : 'quote_needs_review',
        projectStatus: deriveProjectStatus(model),
        quote,
        quoteAccepted: quote ? quoteAccepted(model, quote.id) : false,
        requiredPaymentReceived: quote ? requiredPaymentReceived(model, quote) : false,
      };
    } catch (error) {
      if (error.statusCode) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      request.log.error({ err: error }, 'shiny_quote_failed');
      return reply.status(500).send({ error: 'Quote failed' });
    }
  });

  fastify.post('/api/shiny/projects/:projectId/accept-quote', async (request, reply) => {
    if (!store?.configured) return reply.status(503).send({ error: 'Project database not configured' });

    const parsed = AcceptQuoteRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message || 'Invalid quote acceptance',
        issues: parsed.error.issues.map(issue => issue.message),
      });
    }

    const projectId = request.params.projectId;
    const { ownerUserId, quoteSnapshotId, termsVersion, termsText } = parsed.data;

    try {
      const object = await loadProjectObject({ store, ownerUserId, projectId });
      if (!object) return reply.status(404).send({ error: 'Project not found' });

      const now = new Date().toISOString();
      const actor = { role: 'customer', userId: ownerUserId, anonymous: true };
      const model = applyOrThrow(object.payloadJson?.model || emptyProjectModel(), command({
        type: 'acceptQuote',
        projectId,
        actor,
        now,
        index: 1,
        extra: { quoteSnapshotId, termsVersion, termsText },
      }));
      const quote = currentQuote(model);
      await pushObject({
        store,
        ownerUserId,
        actorDeviceId: request.headers['x-jobdone-device-id'] || null,
        action: 'updateObject',
        projectId,
        baseObjectT: object.changedT,
        payloadJson: projectPayload(model, 'quote_accepted', { quoteSnapshotId }),
        now,
      });

      return {
        projectId,
        status: 'quote_accepted',
        projectStatus: deriveProjectStatus(model),
        quote,
        quoteAccepted: quote ? quoteAccepted(model, quote.id) : false,
        requiredPaymentReceived: quote ? requiredPaymentReceived(model, quote) : false,
      };
    } catch (error) {
      if (error.statusCode) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      request.log.error({ err: error }, 'shiny_quote_accept_failed');
      return reply.status(500).send({ error: 'Quote acceptance failed' });
    }
  });

  fastify.post('/api/shiny/projects/:projectId/pay-now', async (request, reply) => {
    if (!store?.configured) return reply.status(503).send({ error: 'Project database not configured' });

    const parsed = PayNowRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.issues[0]?.message || 'Invalid payment request',
        issues: parsed.error.issues.map(issue => issue.message),
      });
    }

    const projectId = request.params.projectId;
    const { ownerUserId, quoteSnapshotId } = parsed.data;

    try {
      const object = await loadProjectObject({ store, ownerUserId, projectId });
      if (!object) return reply.status(404).send({ error: 'Project not found' });

      const currentModel = object.payloadJson?.model || emptyProjectModel();
      const quote = currentQuote(currentModel);
      if (!quote || quote.id !== quoteSnapshotId) return reply.status(422).send({ error: 'Quote is not current.', code: 'quote_not_current' });
      if (requiredPaymentReceived(currentModel, quote)) {
        return {
          projectId,
          status: 'payment_received',
          projectStatus: deriveProjectStatus(currentModel),
          quote,
          quoteAccepted: quoteAccepted(currentModel, quote.id),
          requiredPaymentReceived: true,
        };
      }

      const now = new Date().toISOString();
      const model = applyOrThrow(currentModel, command({
        type: 'recordPaymentReceived',
        projectId,
        actor: { role: 'system', userId: 'system' },
        now,
        index: 1,
        extra: {
          paymentId: createUuidV7(Date.parse(now) + 40),
          quoteSnapshotId,
          amount: quote.result.depositDue,
        },
      }));
      await pushObject({
        store,
        ownerUserId,
        actorDeviceId: request.headers['x-jobdone-device-id'] || null,
        action: 'updateObject',
        projectId,
        baseObjectT: object.changedT,
        payloadJson: projectPayload(model, 'payment_received', { quoteSnapshotId }),
        now,
      });

      return {
        projectId,
        status: 'payment_received',
        projectStatus: deriveProjectStatus(model),
        quote: currentQuote(model),
        quoteAccepted: true,
        requiredPaymentReceived: true,
      };
    } catch (error) {
      if (error.statusCode) return reply.status(error.statusCode).send({ error: error.message, code: error.code });
      request.log.error({ err: error }, 'shiny_pay_now_failed');
      return reply.status(500).send({ error: 'Payment failed' });
    }
  });
}
