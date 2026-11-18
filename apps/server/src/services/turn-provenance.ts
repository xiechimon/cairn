export const WAKE_PROMPT_PREFIX = '[wake:';
export const CHIEF_ABANDONED_STEP_MS = 120_000;

const WAKE_PROVENANCE_RE = /^\[wake:\w+\] provenance=(\S+)\n/;

export function turnProvenance(prompt: string | null): string | null {
  return WAKE_PROVENANCE_RE.exec(prompt ?? '')?.[1] ?? null;
}
