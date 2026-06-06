import { z } from 'zod';
import { buildLocalReplicaSchemas, createLocalReplicaParsers } from '../../../shared/contracts/localReplica.js';

export const localReplicaSchemas = buildLocalReplicaSchemas(z);

export const {
  parseSyncObject,
  parseSyncTransaction,
  parseSyncIntent,
  parsePullRequest,
  parsePullResponse,
  parsePushRequest,
  parsePushResponse,
} = createLocalReplicaParsers(z);
