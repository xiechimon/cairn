export function resolveDevinCap(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`eval: invalid EVAL_MAX_DEVIN_RUNS=${raw}`);
  }
  return Number(trimmed);
}
