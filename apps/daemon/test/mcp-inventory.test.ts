import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { probeMachineCapabilities } from '../src/machine-capabilities.js';
import { testTempDir } from './test-temp-dir.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const homeDir = testTempDir('cairn-inventory-');
  roots.push(homeDir);
  return {
    homeDir,
    mcpConfigPath: join(homeDir, '.claude.json'),
    skillsDir: join(homeDir, 'skills'),
  };
}

describe('metadata-only MCP inventory', () => {
  test('reports Claude, Codex and pi user sources without conflating their runtimes', () => {
    const sources = fixture();
    mkdirSync(join(sources.homeDir, '.codex'), { recursive: true });
    mkdirSync(join(sources.homeDir, '.pi', 'agent'), { recursive: true });
    writeFileSync(
      sources.mcpConfigPath,
      JSON.stringify({ mcpServers: { browser: { command: 'browser-server' } } }),
    );
    writeFileSync(
      join(sources.homeDir, '.codex', 'config.toml'),
      '[mcp_servers.repository]\ncommand = "repository-server"\n',
    );
    writeFileSync(
      join(sources.homeDir, '.pi', 'agent', 'mcp.json'),
      JSON.stringify({
        mcpServers: { filesystem: { command: 'filesystem-server', enabled: false } },
      }),
    );

    const report = probeMachineCapabilities(sources);
    expect(report).toMatchObject({
      mcpInventory: {
        sources: expect.arrayContaining([
          expect.objectContaining({
            runtime: 'claude-code',
            scope: 'user',
            status: 'complete',
            entries: [
              expect.objectContaining({ slug: 'browser', transport: 'stdio', enabled: true }),
            ],
          }),
          expect.objectContaining({
            runtime: 'codex',
            scope: 'user',
            status: 'complete',
            entries: [
              expect.objectContaining({ slug: 'repository', transport: 'stdio', enabled: true }),
            ],
          }),
          expect.objectContaining({
            runtime: 'pi',
            scope: 'user',
            status: 'complete',
            entries: [
              expect.objectContaining({ slug: 'filesystem', transport: 'stdio', enabled: false }),
            ],
          }),
        ]),
      },
    });
  });

  test('reports malformed source as invalid instead of asserting an empty complete inventory', () => {
    const sources = fixture();
    writeFileSync(sources.mcpConfigPath, '{not json');
    expect(probeMachineCapabilities(sources)).toMatchObject({
      mcpInventory: {
        sources: expect.arrayContaining([
          expect.objectContaining({
            runtime: 'claude-code',
            scope: 'user',
            status: 'invalid',
            entries: [],
          }),
          expect.objectContaining({
            runtime: 'codex',
            scope: 'user',
            status: 'absent',
            entries: [],
          }),
        ]),
      },
    });
  });

  test('credential-shaped object keys do not escape through legacy capability slugs', () => {
    const sources = fixture();
    const fakeCredential = `ghp_${'X'.repeat(36)}`;
    writeFileSync(
      sources.mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          [fakeCredential]: { command: 'server' },
          browser: {
            url: `https://user:${fakeCredential}@example.invalid/${fakeCredential}?token=${fakeCredential}`,
            headers: { Authorization: `Bearer ${fakeCredential}` },
            env: { TOKEN: fakeCredential },
            args: [fakeCredential],
            description: fakeCredential,
            oauth: { clientSecret: fakeCredential },
          },
        },
      }),
    );
    const serialized = JSON.stringify(probeMachineCapabilities(sources)).toLowerCase();
    expect(serialized.includes(fakeCredential.toLowerCase())).toBe(false);
  });
});
