import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, onTestFinished, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { STEP_ATTACHMENTS_TTL_MS, sweepStepAttachments } from '../src/step-attachments.js';

const DAY = 24 * 60 * 60 * 1000;

const fixtureDirectories: string[] = [];

afterAll(() => {
  try {
    expect(fixtureDirectories.filter((directory) => existsSync(directory))).toEqual([]);
  } finally {
    for (const directory of fixtureDirectories) rmSync(directory, { recursive: true, force: true });
  }
});

function tmpRoot(): string {
  const root = makeTestTempDir('step-att-');
  onTestFinished(() => {
    releaseTestTempDir(root);
  });
  fixtureDirectories.push(root);
  return root;
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

test.fails('fixture cleanup survives a failed test', () => {
  tmpRoot();
  throw new Error('deliberate fixture assertion failure');
});
