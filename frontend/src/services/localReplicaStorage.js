export const LOCAL_REPLICA_STATE_ID = 'default';

export function localReplicaObjectKey(object = {}) {
  return [
    object.ownerKind,
    object.ownerId,
    object.collection,
    object.id,
  ].map(value => String(value || '')).join(':');
}
