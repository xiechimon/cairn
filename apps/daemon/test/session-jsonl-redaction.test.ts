import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { readSessionJsonlForUpload, redactSessionJsonl } from '../src/session-jsonl.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sessionFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-jsonl-'));
  dirs.push(dir);
  const file = join(dir, 'session.jsonl');
  writeFileSync(file, content);
  return file;
}

const KEY = `sk-${'a1B2c3D4e5F6g7H8i9J0'}`;
const GITHUB = `ghp_${'a1B2c3D4e5F6g7H8i9J0k1'}`;

describe('session record redaction before upload', () => {
  test('replaces secrets in every line and keeps each line valid JSON', () => {
    const raw = [
      JSON.stringify({ type: 'tool_result', content: `OPENAI_API_KEY=${KEY}` }),
      JSON.stringify({
        type: 'tool_use',
        input: { command: `curl -H "Authorization: Bearer abc.def-123" ${GITHUB}` },
      }),
      '',
    ].join('\n');
    const out = redactSessionJsonl(raw);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain(GITHUB);
    expect(out).not.toContain('abc.def-123');
    expect(out.endsWith('\n')).toBe(true);
    for (const line of out.split('\n').filter((l) => l !== '')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(out).toContain('[REDACTED]');
  });

  test('keeps ordinary content unchanged', () => {
    const line = JSON.stringify({ type: 'text', text: 'hello from the Mac app' });
    expect(redactSessionJsonl(`${line}\n`)).toBe(`${line}\n`);
  });

  test('uploads nothing when a line is not JSON', () => {
    const logs: string[] = [];
    const file = sessionFile(`{"ok":true}\nnot json\n`);
    expect(readSessionJsonlForUpload(file, (m) => logs.push(m))).toBeNull();
    expect(logs.join('\n')).toContain('session jsonl read failed');
  });

  test('redacts what readSessionJsonlForUpload returns', () => {
    const file = sessionFile(`${JSON.stringify({ text: KEY })}\n`);
    const out = readSessionJsonlForUpload(file, () => {});
    expect(out).not.toBeNull();
    expect(out).not.toContain(KEY);
  });
});
