import { z } from 'zod';
import { buildWaterWalkDatasetSchemas, createWaterWalkDatasetParsers } from '../../../shared/contracts/waterWalkDataset.js';

export const waterWalkDatasetSchemas = buildWaterWalkDatasetSchemas(z);

export const {
  parseWaterWalkDataset,
} = createWaterWalkDatasetParsers(z);
