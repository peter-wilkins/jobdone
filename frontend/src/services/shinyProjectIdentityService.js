import { createUuidV7 } from '../../../shared/contracts/clientId.js';

const OWNER_KEY = 'shiny-art-shop-owner-id';

export function getShinyProjectOwnerId(storage = globalThis.localStorage) {
  try {
    const existing = storage?.getItem?.(OWNER_KEY);
    if (existing) return existing;
    const next = createUuidV7();
    storage?.setItem?.(OWNER_KEY, next);
    return next;
  } catch {
    return createUuidV7();
  }
}

export function createShinyProjectId() {
  return createUuidV7();
}
