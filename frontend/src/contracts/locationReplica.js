import { z } from 'zod';
import {
  buildLocationReplicaSchemas,
  createLocationReplicaParsers,
} from '../../../shared/contracts/locationReplica.js';

export const locationReplicaSchemas = buildLocationReplicaSchemas(z);
export const {
  parseLocationReplicaManifestRequest,
  parseLocationReplicaManifestResponse,
  parseLocationReplicaPushRequest,
  parseLocationReplicaPullRequest,
  parseLocationReplicaRecordsResponse,
} = createLocationReplicaParsers(z);
