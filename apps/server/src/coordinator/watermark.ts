const REWIND_PREFIX = 'rewind:';

export type Watermark = { kind: 'mirrored'; entryId: number } | { kind: 'rewind'; entryId: number };

export function rewindWatermark(entryId: number): string {
  return `${REWIND_PREFIX}${entryId}`;
}

export function parseWatermark(value: string | null): Watermark | null {
  if (value === null) return null;
  const rewind = value.startsWith(REWIND_PREFIX);
  const entryId = Number(rewind ? value.slice(REWIND_PREFIX.length) : value);
  if (!Number.isInteger(entryId)) return null;
  return { kind: rewind ? 'rewind' : 'mirrored', entryId };
}
