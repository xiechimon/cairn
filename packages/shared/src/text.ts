export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
