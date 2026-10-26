import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCP_NOT_IN_CONFIG_CANON } from '@cairn/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { cleanupTestDirs, makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { notInConfigLine, resolveMcpEndpoints } from '../src/backend/mcp-config.js';

const dirs: string[] = [];
afterAll(() => cleanupTestDirs(dirs.splice(0)));

function cfg(content: unknown): string {
  const dir = makeTestTempDir('cairn-mcp-daemon-cfg');
  dirs.push(dir);
  const p = join(dir, 'claude.json');
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return p;
}

const CONFIG = {
  mcpServers: {
    demo: { url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer sec' } },
    local: { command: 'npx', args: ['-y', 'x'], env: { API_KEY: 'k' } },
    broken: { nope: 1 },
  },
};

describe('resolveMcpEndpoints — slug → local config resolution (spec 13)', () => {
  test('normal: http with headers, stdio with command/args/env, values kept verbatim (execution surface reads locally)', () => {
    const eps = resolveMcpEndpoints(cfg(CONFIG), ['demo', 'local']);
    expect(eps).toEqual([
      {
        slug: 'demo',
        transport: 'http',
        url: 'https://example.invalid/mcp',
        headers: { Authorization: 'Bearer sec' },
      },
      {
        slug: 'local',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'x'],
        env: { API_KEY: 'k' },
      },
    ]);
  });

  test('unknown slug: skipped + onMissing callback; canon degradation line "not found in config"', () => {
    const missing: string[] = [];
    const eps = resolveMcpEndpoints(cfg(CONFIG), ['ghost', 'demo'], {
      onMissing: (slug) => missing.push(slug),
    });
    expect(eps.map((e) => e.slug)).toEqual(['demo']);
    expect(missing).toEqual(['ghost']);
    expect(notInConfigLine('ghost')).toBe(`ghost: ${MCP_NOT_IN_CONFIG_CANON}`);
    expect(notInConfigLine('ghost')).toContain('its tools are unavailable this turn');
  });

  test('bad entry: key present in config but malformed shape = skipped without crashing (same rule as the server read seam)', () => {
    const eps = resolveMcpEndpoints(cfg(CONFIG), ['broken']);
    expect(eps).toEqual([]);
  });

  test('missing file / bad JSON = empty set, everything goes through onMissing, no throw', () => {
    const missing: string[] = [];
    const absent = join(tmpdir(), 'cairn-no-such-claude.json');
    expect(resolveMcpEndpoints(absent, ['a'], { onMissing: (s) => missing.push(s) })).toEqual([]);
    expect(missing).toEqual(['a']);
    expect(resolveMcpEndpoints(cfg('{{{ not json'), ['a'])).toEqual([]);
  });

  test('case-normalized matching: config key Playwright ↔ claim slug playwright', () => {
    const eps = resolveMcpEndpoints(cfg({ mcpServers: { Playwright: { command: 'pw' } } }), [
      'playwright',
    ]);
    expect(eps).toEqual([{ slug: 'playwright', transport: 'stdio', command: 'pw' }]);
  });

  test('empty slug list = empty endpoint set (zero cost, no file read)', () => {
    expect(resolveMcpEndpoints(cfg(CONFIG), [])).toEqual([]);
  });
});
