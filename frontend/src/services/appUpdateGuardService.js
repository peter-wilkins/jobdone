let shouldDeferAppUpdate = () => false;

export function setAppUpdateGuard(guard) {
  shouldDeferAppUpdate = typeof guard === 'function' ? guard : () => false;
}

export function shouldDeferAppUpdateNow() {
  try {
    return Boolean(shouldDeferAppUpdate());
  } catch {
    return false;
  }
}
