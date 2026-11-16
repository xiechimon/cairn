import { PICKED_PROJECT_OPEN } from '@cairn/shared';

export { PICKED_PROJECT_OPEN };

export function pickedProjectIdOf(prompt: string | null): string | null {
  if (prompt === null || !prompt.startsWith(PICKED_PROJECT_OPEN)) return null;
  return /^[^\n]*（id: ([^）\n]+)）】\n/.exec(prompt)?.[1] ?? null;
}

export function stepScopeProjectId(row: {
  scopeProjectId: string | null;
  prompt: string | null;
}): string | null {
  return row.scopeProjectId ?? pickedProjectIdOf(row.prompt);
}
