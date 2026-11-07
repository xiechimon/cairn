const REWIND_PATTERN = /^rewind:(\d+):(.+)$/;

export type Watermark =
  | { kind: 'mirrored'; entryId: number }
  | { kind: 'rewind'; entryId: number; anchorMessageId: string };

export function rewindWatermark(entryId: number, anchorMessageId: string): string {
  return `rewind:${entryId}:${anchorMessageId}`;
}

export function parseWatermark(value: string | null): Watermark | null {
  if (value === null) return null;
  const rewind = REWIND_PATTERN.exec(value);
  if (rewind !== null) {
    return { kind: 'rewind', entryId: Number(rewind[1]), anchorMessageId: rewind[2] ?? '' };
  }
  const entryId = Number(value);
  return Number.isInteger(entryId) ? { kind: 'mirrored', entryId } : null;
}
