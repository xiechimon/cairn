import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CLAUDE_CODE_MODELS } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { readClaudeCodeReport } from '../src/claude-code-models.js';
import { testTempDir } from './test-temp-dir.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpHome(settingsJson?: string): string {
  const dir = testTempDir('cairn-daemon-cc-');
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

  test('claude binary found but no settings.json → installed with the built-in models', () => {
    const report = readClaudeCodeReport(tmpHome(), {
      bin: { path: '/usr/bin/claude', version: '2.1.0' },
    });
    expect(report.installed).toBe(true);
    expect(report.models).toEqual(DEFAULT_CLAUDE_CODE_MODELS);
    expect(report.bin).toEqual({ path: '/usr/bin/claude', version: '2.1.0' });
  });

  test('claude binary found with settings.json that lists no model → built-in models', () => {
    const report = readClaudeCodeReport(tmpHome('{}'), {
      bin: { path: '/usr/bin/claude', version: null },
    });
    expect(report.installed).toBe(true);
    expect(report.models).toEqual(DEFAULT_CLAUDE_CODE_MODELS);
  });

  test('settings.json models win over the built-in list, with or without the binary', () => {
    const settings = JSON.stringify({ model: 'claude-opus-4-5' });
    const withBin = readClaudeCodeReport(tmpHome(settings), {
      bin: { path: '/usr/bin/claude', version: null },
    });
    expect(withBin.models).toEqual([
      { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
    ]);
    expect(readClaudeCodeReport(tmpHome(settings)).models).toEqual(withBin.models);
  });

  test('no binary and no settings.json stays not installed, and a missing bin probe is not a found binary', () => {
    expect(readClaudeCodeReport(tmpHome(), { bin: null }).installed).toBe(false);
    expect(readClaudeCodeReport(tmpHome(), { bin: null }).models).toEqual([]);
  });

  test('a logged-out machine keeps its auth state next to the built-in models', () => {
    const report = readClaudeCodeReport(tmpHome(), {
      bin: { path: '/usr/bin/claude', version: null },
      auth: { state: 'not-logged-in', provider: 'firstParty' },
    });
    expect(report.installed).toBe(true);
    expect(report.auth).toEqual({ state: 'not-logged-in', provider: 'firstParty' });
  });

  test('invalid JSON → installed:false (no throw)', () => {
    const report = readClaudeCodeReport(tmpHome('{ not json'));
    expect(report.installed).toBe(false);
    expect(report.models).toEqual([]);
  });
});
