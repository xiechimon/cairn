import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SESSION_JSONL_MAX_BYTES } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { readSessionJsonlForUpload } from '../src/session-jsonl.js';

function capture(): { lines: string[]; log: (msg: string) => void } {
  const lines: string[] = [];
  return { lines, log: (msg) => lines.push(msg) };
}

describe('readSessionJsonlForUpload（#1512）', () => {
  test('上限与 spec 20 单件 10MiB 对齐', () => {
    expect(SESSION_JSONL_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  test('失败方式 1：路径缺席 → null、不落日志', () => {
    const { lines, log } = capture();
    expect(readSessionJsonlForUpload(undefined, log)).toBeNull();
    expect(lines).toEqual([]);
  });

  test('失败方式 2：文件不存在 → null + 日志', () => {
    const { lines, log } = capture();
    const missing = join(tmpdir(), `pacman-session-missing-${Date.now()}.jsonl`);
    expect(readSessionJsonlForUpload(missing, log)).toBeNull();
    expect(lines.some((l) => l.includes('missing') && l.includes(missing))).toBe(true);
  });

  test('失败方式 3：读取失败 → null + 日志', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-session-unreadable-'));
    const { lines, log } = capture();
    expect(readSessionJsonlForUpload(dir, log)).toBeNull();
    expect(lines.some((l) => l.includes('read failed'))).toBe(true);
  });

  test('失败方式 4：超过上限 → 跳过 + 日志，不截断', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-session-oversize-'));
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, 'x'.repeat(40));
    const { lines, log } = capture();
    expect(readSessionJsonlForUpload(file, log, 20)).toBeNull();
    expect(lines.some((l) => l.includes('over') && l.includes('20'))).toBe(true);
  });

  test('失败方式 5：未超上限 → 原样返回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-session-ok-'));
    const file = join(dir, 'session.jsonl');
    const body = '{"type":"assistant","stopReason":"length"}\n';
    writeFileSync(file, body);
    const { lines, log } = capture();
    expect(readSessionJsonlForUpload(file, log)).toBe(body);
    expect(lines).toEqual([]);
  });
});
