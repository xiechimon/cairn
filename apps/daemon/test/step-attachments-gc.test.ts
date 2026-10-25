import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { STEP_ATTACHMENTS_TTL_MS, sweepStepAttachments } from '../src/step-attachments.js';

const DAY = 24 * 60 * 60 * 1000;

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'cairn-step-att-'));
}

function putStep(root: string, stepId: string, mtimeAgoMs: number): void {
  const dir = join(root, stepId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'fig.svg'), '<svg></svg>');
  const at = new Date(Date.now() - mtimeAgoMs);
  utimesSync(dir, at, at);
}

describe('sweepStepAttachments', () => {
  test('step directories older than 72h are collected, new ones untouched', () => {
    const root = tmpRoot();
    try {
      putStep(root, 'step-old', STEP_ATTACHMENTS_TTL_MS + DAY);
      putStep(root, 'step-new', DAY);
      const removed = sweepStepAttachments(root, { now: Date.now() });
      expect(removed).toEqual(['step-old']);
      expect(existsSync(join(root, 'step-old'))).toBe(false);
      expect(existsSync(join(root, 'step-new', 'fig.svg'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('missing root directory → empty array, no throw', () => {
    const removed = sweepStepAttachments(join(tmpRoot(), 'no-such-root'), {
      now: Date.now(),
    });
    expect(removed).toEqual([]);
  });

  test('stray files under the root are untouched, only step directories are collected', () => {
    const root = tmpRoot();
    try {
      writeFileSync(join(root, 'loose.txt'), 'x');
      const removed = sweepStepAttachments(root, { now: Date.now() });
      expect(removed).toEqual([]);
      expect(existsSync(join(root, 'loose.txt'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
