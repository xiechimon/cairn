export const WAKE_PROMPT_PREFIX = '[wake:';
export const CHIEF_ABANDONED_STEP_MS = 120_000;
export const REPORT_PROVENANCE_PREFIX = 'report:';

const WAKE_PROVENANCE_RE = /^\[wake:\w+\] provenance=(\S+)\n/;

export function turnProvenance(prompt: string | null): string | null {
  return WAKE_PROVENANCE_RE.exec(prompt ?? '')?.[1] ?? null;
}

export function reportProvenance(todoId: string): string {
  return `${REPORT_PROVENANCE_PREFIX}${todoId}`;
}
