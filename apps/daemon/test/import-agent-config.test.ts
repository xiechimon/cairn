import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { agentConfigImportDone, importAgentConfig } from '../src/import-agent-config.js';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) releaseTestTempDir(dir);
});

function homes(): { cairn: string; real: string } {
  const dir = tempDir('import-');
  return { cairn: join(dir, 'cairn'), real: join(dir, 'real') };
}

describe('importAgentConfig', () => {
  test('missing sources are recorded as skipped and the marker still lands', () => {
    const { cairn, real } = homes();
    const report = importAgentConfig({ cairnHome: cairn, realHome: real });
    expect(report).not.toBeNull();
    expect(report?.copied).toEqual([]);
    expect(report?.skipped.length).toBeGreaterThanOrEqual(3);
    expect(agentConfigImportDone(cairn)).toBe(true);
    expect(
      JSON.parse(readFileSync(join(cairn, 'imports', 'agent-config.json'), 'utf8')),
    ).toMatchObject({ version: 1 });
  });

  test('runs only once unless forced', () => {
    const { cairn, real } = homes();
    importAgentConfig({ cairnHome: cairn, realHome: real });
    expect(importAgentConfig({ cairnHome: cairn, realHome: real })).toBeNull();
    expect(importAgentConfig({ cairnHome: cairn, realHome: real, force: true })).not.toBeNull();
  });

  test('copies skills additively and never overwrites a managed skill', () => {
    const { cairn, real } = homes();
    mkdirSync(join(real, '.claude', 'skills', 'alpha'), { recursive: true });
    writeFileSync(join(real, '.claude', 'skills', 'alpha', 'SKILL.md'), 'alpha user\n');
    mkdirSync(join(real, '.claude', 'skills', 'beta'), { recursive: true });
    writeFileSync(join(real, '.claude', 'skills', 'beta', 'SKILL.md'), 'beta user\n');
    mkdirSync(join(cairn, 'homes', 'claude', 'skills', 'beta'), { recursive: true });
    writeFileSync(join(cairn, 'homes', 'claude', 'skills', 'beta', 'SKILL.md'), 'beta managed\n');

    const report = importAgentConfig({ cairnHome: cairn, realHome: real });
    expect(report?.copied).toContain('skills/alpha');
    expect(report?.skipped).toContainEqual(expect.objectContaining({ item: 'skills/beta' }));
    expect(
      readFileSync(join(cairn, 'homes', 'claude', 'skills', 'alpha', 'SKILL.md'), 'utf8'),
    ).toBe('alpha user\n');
    expect(readFileSync(join(cairn, 'homes', 'claude', 'skills', 'beta', 'SKILL.md'), 'utf8')).toBe(
      'beta managed\n',
    );
  });

  test('merges mcpServers from ~/.claude.json without touching existing keys', () => {
    const { cairn, real } = homes();
    mkdirSync(real, { recursive: true });
    writeFileSync(
      join(real, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          alpha: { command: 'npx', args: ['-y', 'alpha-mcp'] },
          beta: { url: 'https://beta.example/mcp' },
        },
        hasCompletedOnboarding: true,
      }),
    );
    mkdirSync(join(cairn, 'homes', 'claude'), { recursive: true });
    writeFileSync(
      join(cairn, 'homes', 'claude', '.claude.json'),
      JSON.stringify({
        mcpServers: { beta: { url: 'https://managed.example/mcp' } },
        oauthAccount: { email: 'managed@example.com' },
      }),
    );

    const report = importAgentConfig({ cairnHome: cairn, realHome: real });
    expect(report?.copied).toContain('claude.json:mcp/alpha');
    const managed = JSON.parse(
      readFileSync(join(cairn, 'homes', 'claude', '.claude.json'), 'utf8'),
    );
    expect(managed.mcpServers.alpha).toEqual({ command: 'npx', args: ['-y', 'alpha-mcp'] });
    expect(managed.mcpServers.beta).toEqual({ url: 'https://managed.example/mcp' });
    expect(managed.oauthAccount).toEqual({ email: 'managed@example.com' });
  });

  test('translates codex mcp_servers with env resolution', () => {
    const { cairn, real } = homes();
    mkdirSync(join(real, '.codex'), { recursive: true });
    writeFileSync(
      join(real, '.codex', 'config.toml'),
      [
        '[mcp_servers.context7]',
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp"]',
        'env_vars = ["CONTEXT7_KEY", "MISSING_VAR"]',
        '',
        '[mcp_servers.linear]',
        'url = "https://mcp.linear.app/sse"',
        'bearer_token_env_var = "LINEAR_TOKEN"',
        '',
      ].join('\n'),
    );
    const report = importAgentConfig({
      cairnHome: cairn,
      realHome: real,
      env: { CONTEXT7_KEY: 'k1', LINEAR_TOKEN: 'tok-1' },
    });
    expect(report?.skipped).toContainEqual(expect.objectContaining({ item: 'codex:mcp/context7' }));
    const managed = JSON.parse(
      readFileSync(join(cairn, 'homes', 'claude', '.claude.json'), 'utf8'),
    );
    expect(managed.mcpServers.context7).toBeUndefined();
    expect(managed.mcpServers.linear).toEqual({
      url: 'https://mcp.linear.app/sse',
      headers: { Authorization: 'Bearer tok-1' },
    });
  });

  test('codex stdio server copies when its env vars resolve', () => {
    const { cairn, real } = homes();
    mkdirSync(join(real, '.codex'), { recursive: true });
    writeFileSync(
      join(real, '.codex', 'config.toml'),
      ['[mcp_servers.context7]', 'command = "npx"', 'env_vars = ["CONTEXT7_KEY"]', ''].join('\n'),
    );
    importAgentConfig({
      cairnHome: cairn,
      realHome: real,
      env: { CONTEXT7_KEY: 'resolved' },
    });
    const managed = JSON.parse(
      readFileSync(join(cairn, 'homes', 'claude', '.claude.json'), 'utf8'),
    );
    expect(managed.mcpServers.context7).toEqual({
      command: 'npx',
      env: { CONTEXT7_KEY: 'resolved' },
    });
  });

  test('copies model and non-secret env, skips secret-like keys', () => {
    const { cairn, real } = homes();
    mkdirSync(join(real, '.claude'), { recursive: true });
    writeFileSync(
      join(real, '.claude', 'settings.json'),
      JSON.stringify({
        model: 'claude-opus-4-7',
        env: {
          ANTHROPIC_API_KEY: 'sk-secret',
          DISABLE_TELEMETRY: '1',
        },
        hooks: { PreToolUse: [{ matcher: '*', hooks: [] }] },
      }),
    );
    const report = importAgentConfig({ cairnHome: cairn, realHome: real });
    expect(report?.copied).toContain('settings:model');
    expect(report?.copied).toContain('settings:env/DISABLE_TELEMETRY');
    expect(report?.skipped).toContainEqual(
      expect.objectContaining({ item: 'settings:env/ANTHROPIC_API_KEY' }),
    );
    const managed = JSON.parse(
      readFileSync(join(cairn, 'homes', 'claude', 'settings.json'), 'utf8'),
    );
    expect(managed).toEqual({
      model: 'claude-opus-4-7',
      env: { DISABLE_TELEMETRY: '1' },
    });
  });

  test('a malformed user file records failed and other sources still import', () => {
    const { cairn, real } = homes();
    mkdirSync(join(real, '.claude', 'skills', 'alpha'), { recursive: true });
    writeFileSync(join(real, '.claude', 'skills', 'alpha', 'SKILL.md'), 'alpha\n');
    writeFileSync(join(real, '.claude.json'), 'not json {');
    const report = importAgentConfig({ cairnHome: cairn, realHome: real });
    expect(report?.copied).toContain('skills/alpha');
    expect(report?.failed).toContainEqual(
      expect.objectContaining({ item: join(real, '.claude.json') }),
    );
    expect(agentConfigImportDone(cairn)).toBe(true);
  });
});
