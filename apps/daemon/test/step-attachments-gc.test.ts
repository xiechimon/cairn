// step-attachments scratch 回收（issue #759 R3，策略正本 docs/spec/20 §4）。
// 失败方式清单（先固化）：
// ① 超 TTL 的步目录 → 整目录被收（返回 stepId）
// ② TTL 内的步目录 → 不动
// ③ 根目录不存在 → 空数组（不上报、不抛）
// ④ 根下零散文件（非目录）→ 不动（只收步目录）

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
  // 目录 mtime 随文件落盘刷新——显式回拨，模拟步结束多时的目录。
  utimesSync(dir, at, at);
}

describe('sweepStepAttachments', () => {
  test('超 72h 的步目录被收，新目录不动', () => {
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

  test('根目录不存在 → 空数组，不抛', () => {
    const removed = sweepStepAttachments(join(tmpRoot(), 'no-such-root'), {
      now: Date.now(),
    });
    expect(removed).toEqual([]);
  });

  test('根下零散文件不动，只收步目录', () => {
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
