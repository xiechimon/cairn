import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SESSION_JSONL_MAX_BYTES } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { readSessionJsonlForUpload } from '../src/session-jsonl.js';

function capture(): { lines: string[]; log: (msg: string) => void } {
  const lines: string[] = [];
  return { lines, log: (msg) => lines.push(msg) };
}

describe('readSessionJsonlForUpload（#1512）', () => {
  test('cap aligned with spec 20 single-item 10MiB', () => {
    expect(SESSION_JSONL_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  test('failure mode 1: path absent → null, no log line', () => {
    const { lines, log } = capture();
    expect(readSessionJsonlForUpload(undefined, log)).toBeNull();
    expect(lines).toEqual([]);
  });

  test('failure mode 2: file missing → null + log', () => {
    const { lines, log } = capture();
    const missing = join(tmpdir(), `cairn-session-missing-${Date.now()}.jsonl`);
    expect(readSessionJsonlForUpload(missing, log)).toBeNull();
    expect(lines.some((l) => l.includes('missing') && l.includes(missing))).toBe(true);
  });

  test('failure mode 3: read failure → null + log', () => {
    const dir = makeTestTempDir('cairn-session-unreadable-');
    const { lines, log } = capture();
    expect(readSessionJsonlForUpload(dir, log)).toBeNull();
    expect(lines.some((l) => l.includes('read failed'))).toBe(true);
  });

  test('failure mode 4: over the cap → skipped + log, not truncated', () => {
    const dir = makeTestTempDir('cairn-session-oversize-');
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, 'x'.repeat(40));
    const { lines, log } = capture();
    expect(readSessionJsonlForUpload(file, log, 20)).toBeNull();
    expect(lines.some((l) => l.includes('over') && l.includes('20'))).toBe(true);
  });

  test('failure mode 5: under the cap → returned as-is', () => {
    const dir = makeTestTempDir('cairn-session-ok-');
    const file = join(dir, 'session.jsonl');
    const body = '{"type":"assistant","stopReason":"length"}\n';
    writeFileSync(file, body);
    const { lines, log } = capture();
    expect(readSessionJsonlForUpload(file, log)).toBe(body);
    expect(lines).toEqual([]);
  });
});
