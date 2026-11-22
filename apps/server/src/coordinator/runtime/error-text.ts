function safeString(error: unknown): string {
  try {
    return String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

export function thrownErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : safeString(error);
  if (text.trim() !== '') return text;
  const name = error instanceof Error ? error.name.trim() : '';
  return name === '' ? 'unknown error' : name;
}
