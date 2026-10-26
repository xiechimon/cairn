import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { readClaudeCodeReport } from '../src/claude-code-models.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpHome(settingsJson?: string): string {
  const dir = makeTestTempDir('cairn-daemon-cc-');
  dirs.push(dir);
  if (settingsJson !== undefined) {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), settingsJson);
  }
  return dir;
}

describe('readClaudeCodeReport', () => {
  test('missing settings.json → installed:false + empty models (no throw)', () => {
    expect(readClaudeCodeReport(tmpHome())).toEqual({
      installed: false,
      hostname: hostname(),
      models: [],
    });
  });

  test('model + env slot parsing (same source as shared slot semantics)', () => {
    const report = readClaudeCodeReport(
      tmpHome(
        JSON.stringify({
          model: 'claude-opus-4-5',
          env: { ANTHROPIC_OPUS_MODEL: 'claude-opus-4-1' },
        }),
      ),
    );
    expect(report).toEqual({
      installed: true,
      hostname: hostname(),
      models: [
        { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
        { id: 'claude-opus-4-1', name: 'claude-opus-4-1', slot: 'opus' },
      ],
    });
  });

  test('invalid JSON → installed:false (no throw)', () => {
    const report = readClaudeCodeReport(tmpHome('{ not json'));
    expect(report.installed).toBe(false);
    expect(report.models).toEqual([]);
  });
});
