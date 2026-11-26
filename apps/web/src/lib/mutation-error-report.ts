const surfacedErrors = new WeakSet<object>();

function errorKey(error: unknown): object | null {
  if ((typeof error === 'object' && error !== null) || typeof error === 'function')
    return error as object;
  return null;
}

export function markErrorSurfaced(error: unknown): void {
  const key = errorKey(error);
  if (key !== null) surfacedErrors.add(key);
}

export function errorWasSurfaced(error: unknown): boolean {
  const key = errorKey(error);
  return key !== null && surfacedErrors.has(key);
}
