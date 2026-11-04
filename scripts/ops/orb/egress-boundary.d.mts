import type { Stats } from 'node:fs';

type BoundaryStat = Pick<Stats, 'uid' | 'mode' | 'isDirectory' | 'isSocket' | 'isSymbolicLink'>;

export function inspectEgressBoundary(
  socketPath: string,
  options?: {
    uid?: number;
    stat?: (path: string) => BoundaryStat | null;
    entries?: (path: string) => string[];
    realpath?: (path: string) => string;
  },
): { ok: boolean; directory: string; reason: string };
