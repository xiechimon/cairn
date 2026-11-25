import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTO_MERGE_PATH_GLOBS,
  GATE_LIMITS,
  HUMAN_QUEUE_PATH_GLOBS,
  MERGE_GATE_SOURCE_GLOBS,
  PROTECTED_PATH_GLOBS,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { globToRegExp } from '../src/services/merge-gate/paths.js';

const ROOT = join(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

interface GatePaths {
  autoMerge: string[];
  protected: string[];
  humanQueue: Record<string, string[]>;
  mergeGateSource: string[];
  limits: { maxLines: number; maxFiles: number; maxQueueFiles: number; maxLinesEachWay: number };
}

const gatePaths = JSON.parse(read('packages/shared/merge-gate-paths.json')) as GatePaths;

describe('merge-gate-paths.json is the single source', () => {
  test('merge-gate.ts exports are exactly the JSON lists and limits', () => {
    expect([...AUTO_MERGE_PATH_GLOBS]).toEqual(gatePaths.autoMerge);
    expect([...PROTECTED_PATH_GLOBS]).toEqual(gatePaths.protected);
    expect([...MERGE_GATE_SOURCE_GLOBS]).toEqual(gatePaths.mergeGateSource);
    expect(HUMAN_QUEUE_PATH_GLOBS).toEqual(gatePaths.humanQueue);
    expect(GATE_LIMITS.maxLines).toBe(gatePaths.limits.maxLines);
    expect(GATE_LIMITS.maxFiles).toBe(gatePaths.limits.maxFiles);
    expect(GATE_LIMITS.maxLinesEachWay).toBe(gatePaths.limits.maxLinesEachWay);
    expect(GATE_LIMITS.maxQueueFiles).toBe(gatePaths.limits.maxQueueFiles);
    expect(gatePaths.limits).toEqual({
      maxLines: 800,
      maxFiles: 40,
      maxQueueFiles: 3000,
      maxLinesEachWay: 8000,
    });
  });

  test('every human-queue path is protected', () => {
    const protectedRe = [...gatePaths.protected, ...gatePaths.mergeGateSource].map((glob) =>
      globToRegExp(glob, { protect: true }),
    );
    const unprotected = Object.values(gatePaths.humanQueue)
      .flat()
      .filter((path) => !protectedRe.some((re) => re.test(path)));
    expect(unprotected).toEqual([]);
  });

  test('merge-gate.ts keeps no inline copy of the lists', () => {
    const path = 'packages/shared/src/records/merge-gate.ts';
    expect(read(path), path).not.toMatch(/secret-box|'\*\*\/drizzle\/\*\*'|'apps\/\*\/src\/\*\*'/);
  });
});
