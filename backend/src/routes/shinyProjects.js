import { z } from 'zod';
import { createUuidV7 } from '../../../shared/contracts/clientId.js';
import {
  applyProjectCommand,
  emptyProjectModel,
} from '../../../shared/shiny-project/index.js';
import { createLocalReplicaStore } from '../services/localReplicaStore.js';

const defaultStore = createLocalReplicaStore({
  connectionString: process.env.LOCAL_REPLICA_DB_URL,
  schema: process.env.LOCAL_REPLICA_SCHEMA || 'jobdone',
});

const UploadSchema = z.object({
  ownerUserId: z.string().uuid(),
  filename: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(120).refine(value => value.startsWith('image/'), 'mimeType must be an image'),
  dataBase64: z.string().min(1).max(20_000_000),
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

function buildInitialProjectModel({ ownerUserId, filename, mimeType, dataBase64, now }) {
  const projectId = createUuidV7(Date.parse(now));
  const fileId = createUuidV7(Date.parse(now) + 10);
  const actor = {
    role: 'customer',
    userId: ownerUserId,
    anonymous: true,
  };

  let model = emptyProjectModel();
  const commands = [
    command({
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
    }),
    command({
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
    }),
    command({
      type: 'generatePreview',
      projectId,
      actor,
      now,
      index: 3,
      extra: { sourceFileId: fileId },
    }),
  ];

  for (const item of commands) {
    const result = applyProjectCommand(model, item);
    if (!result.accepted) {
      const error = new Error(result.message || result.code || 'Project command rejected');
      error.statusCode = 422;
      throw error;
    }
    model = result.model;
  }

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

export async function registerShinyProjectRoutes(fastify, deps = {}) {
  const store = deps.localReplicaStore ?? defaultStore;

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
      const { ownerUserId, filename, mimeType, dataBase64 } = parsed.data;
      const { projectId, fileId, model } = buildInitialProjectModel({
        ownerUserId,
        filename,
        mimeType,
        dataBase64,
        now,
      });
      const intentId = createUuidV7(Date.parse(now) + 20);
      const replicaEpoch = createUuidV7(Date.parse(now) + 30);
      const payloadJson = {
        kind: 'shinyProject',
        schemaVersion: 1,
        status: 'previewed',
        previewFileId: fileId,
        model,
      };
      const response = await store.push({
        actorUserId: ownerUserId,
        actorEmail: null,
        actorDeviceId: request.headers['x-jobdone-device-id'] || null,
        request: {
          replicaEpoch,
          baseT: 0,
          intents: [{
            id: intentId,
            ownerKind: 'user',
            ownerId: ownerUserId,
            collection: 'shinyProjects',
            action: 'createObject',
            objectId: projectId,
            baseObjectT: null,
            payloadJson,
            payloadHash: stableHash(payloadJson),
            createdAt: now,
          }],
        },
      });
      const result = response.results?.[0];
      if (!['accepted', 'idempotent'].includes(result?.status)) {
        return reply.status(409).send({ error: result?.reason || 'Project upload conflicted' });
      }

      return {
        projectId,
        fileId,
        status: 'previewed',
        previewImage: { mimeType, dataBase64 },
      };
    } catch (error) {
      if (error.statusCode) return reply.status(error.statusCode).send({ error: error.message });
      request.log.error({ err: error }, 'shiny_project_create_failed');
      return reply.status(500).send({ error: 'Project upload failed' });
    }
  });
}
