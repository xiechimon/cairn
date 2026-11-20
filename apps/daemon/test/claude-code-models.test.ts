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
    writeFileSync(join(dir, 'settings.json'), settingsJson);
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
      bin: { path: '/usr/bin/claude', version: '2.1.0', source: 'bundled' },
    });
    expect(report.installed).toBe(true);
    expect(report.models).toEqual(DEFAULT_CLAUDE_CODE_MODELS);
    expect(report.bin).toEqual({
      path: '/usr/bin/claude',
      version: '2.1.0',
      source: 'bundled',
    });
  });

  test('claude binary found with settings.json that lists no model → built-in models', () => {
    const report = readClaudeCodeReport(tmpHome('{}'), {
      bin: { path: '/usr/bin/claude', version: null, source: 'bundled' },
    });
    expect(report.installed).toBe(true);
    expect(report.models).toEqual(DEFAULT_CLAUDE_CODE_MODELS);
  });

  test('settings.json models come first and the built-in models stay beside them', () => {
    const settings = JSON.stringify({
      model: 'haiku',
      env: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-5-5',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5',
      },
    });
    const report = readClaudeCodeReport(tmpHome(settings), {
      bin: { path: '/usr/bin/claude', version: null, source: 'bundled' },
    });
    expect(report.models.map((model) => model.id)).toEqual([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
    ]);
    expect(report.models[0]?.slot).toBe('default');
  });

  test('without the binary, or with a custom backend, only the settings.json models are reported', () => {
    const settings = JSON.stringify({ model: 'claude-opus-4-5' });
    expect(readClaudeCodeReport(tmpHome(settings)).models).toEqual([
      { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
    ]);
    const relay = JSON.stringify({
      model: 'fable',
      env: {
        ANTHROPIC_BASE_URL: 'https://relay.example',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'deepseek-v4.1-flash',
      },
    });
    expect(
      readClaudeCodeReport(tmpHome(relay), {
        bin: { path: '/usr/bin/claude', version: null, source: 'bundled' },
      }).models.map((model) => model.id),
    ).toEqual(['deepseek-v4.1-flash']);
  });

  test('no binary and no settings.json stays not installed, and a missing bin probe is not a found binary', () => {
    expect(readClaudeCodeReport(tmpHome(), { bin: null }).installed).toBe(false);
    expect(readClaudeCodeReport(tmpHome(), { bin: null }).models).toEqual([]);
  });

  test('a logged-out machine keeps its auth state next to the built-in models', () => {
    const report = readClaudeCodeReport(tmpHome(), {
      bin: { path: '/usr/bin/claude', version: null, source: 'bundled' },
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
