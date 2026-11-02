export const PICKED_PROJECT_OPEN = '【输入框选定项目：';

export function pickedProjectIdOf(prompt: string | null): string | null {
  if (prompt === null || !prompt.startsWith(PICKED_PROJECT_OPEN)) return null;
  return /^[^\n]*（id: ([^）\n]+)）】\n/.exec(prompt)?.[1] ?? null;
}
