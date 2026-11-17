import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { buildSkillsCatalog, collectVisibleSkillNames } from '../src/backend/skills.js';
import { buildProgram } from '../src/cli.js';
import { createMachineCapabilitiesProbe } from '../src/machine-capabilities.js';
import {
  activateWebTools,
  agentReachEnabled,
  ensureWebTools,
  readScrapling,
  runAgentReach,
  ScraplingProbe,
  setAgentReachEnabled,
  uvArchive,
  WEB_TOOLS_REFRESH_MS,
  webToolsBin,
} from '../src/web-tools.js';
import { boot, waitFor } from './machine-loop-harness.js';
import { testTempDir } from './test-temp-dir.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function executable(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
}

describe('default web tools', () => {
  it('reports HTTP readiness in machine presence without advertising Agent Reach by default', async () => {
    const { api, home } = await boot({
      presenceIntervalMs: 30,
      capEnv: {},
      otel: null,
      seedJournal: (paths) => {
        const bin = webToolsBin(paths.home);
        mkdirSync(bin, { recursive: true });
        executable(join(bin, 'python'), 'echo 0.5.1');
      },
    });
    onTestFinished(() => rmSync(`${home}-web-tools`, { recursive: true, force: true }));
    await waitFor(() =>
      api.presenceBodies.some(
        (body) =>
          (body as { capabilities?: { scrapling?: { version: string } } }).capabilities?.scrapling
            ?.version === '0.5.1',
      ),
    );
    for (const body of [...api.enrollBodies, ...api.presenceBodies])
      expect((body as { capabilities: unknown }).capabilities).not.toHaveProperty('agentReach');
  });

  it('keeps the default disabled even with a preinstalled binary and skill, and preserves them through opt-in/out', async () => {
    const home = join(testTempDir('cairn-web-tools-'), 'state');
    vi.stubEnv('CAIRN_HOME', home);
    vi.stubEnv('PATH', '/usr/bin:/bin');
    const bin = webToolsBin(home, 'agent-reach');
    mkdirSync(bin, { recursive: true });
    const binary = join(bin, 'agent-reach');
    executable(binary, 'printf \'{"ok":true,"action":"%s"}\\n\' "$1"');
    const skillsDir = join(home, 'skills');
    mkdirSync(join(skillsDir, 'agent-reach'), { recursive: true });
    writeFileSync(
      join(skillsDir, 'agent-reach', 'SKILL.md'),
      '---\nname: agent-reach\ndescription: platform channels\n---\nKeep this skill.\n',
    );
    const sources = { skillsDir, mcpConfigPath: join(home, 'mcp.json') };
    const capabilities = createMachineCapabilitiesProbe(sources);
    const catalogOpts = { skillsDir, cwd: home };
    expect(agentReachEnabled(home)).toBe(false);
    expect(buildSkillsCatalog(catalogOpts)).not.toContain('platform channels');
    expect(capabilities().skills).toEqual([]);
    await expect(runAgentReach(home, ['doctor'])).rejects.toThrow('Enable Agent Reach first');
    await buildProgram().parseAsync(['node', 'cairn', 'web-tools', 'agent-reach', '--enable']);
    expect(agentReachEnabled(home)).toBe(true);
    expect(collectVisibleSkillNames(catalogOpts).has('agent-reach')).toBe(true);
    expect(capabilities().skills).toEqual(['agent-reach']);
    expect(await runAgentReach(home, ['doctor'])).toContain('"action":"doctor"');
    await setAgentReachEnabled(home, false);
    expect(agentReachEnabled(home)).toBe(false);
    expect(collectVisibleSkillNames(catalogOpts).has('agent-reach')).toBe(false);
    expect(capabilities().skills).toEqual([]);
    expect(readFileSync(binary, 'utf8')).toContain('printf');
    expect(existsSync(join(skillsDir, 'agent-reach', 'SKILL.md'))).toBe(true);
  });

  it('does not redownload a working installation and reports missing or broken imports as unavailable', async () => {
    const home = join(testTempDir('cairn-scrapling-'), 'state');
    vi.stubEnv('PATH', process.env.PATH);
    const bin = webToolsBin(home);
    mkdirSync(bin, { recursive: true });
    expect(await readScrapling(home)).toBeUndefined();
    executable(join(bin, 'python'), 'echo 0.5.1');
    vi.stubGlobal('fetch', () => {
      throw new Error('No network expected');
    });
    const logs: string[] = [];
    await ensureWebTools(home, (message) => logs.push(message));
    expect(await readScrapling(home)).toEqual({ version: '0.5.1' });
    expect(logs).toEqual([]);
    executable(join(bin, 'python'), 'exit 1');
    expect(await readScrapling(home)).toBeUndefined();
  });

  it('cleans failed downloads, stays unavailable, and retries on the next install', async () => {
    const home = join(testTempDir('cairn-scrapling-offline-'), 'state');
    vi.stubEnv('PATH', process.env.PATH);
    vi.stubGlobal('fetch', async () => new Response('unavailable', { status: 503 }));
    const logs: string[] = [];
    await ensureWebTools(home, (message) => logs.push(message));
    expect(logs.join('\n')).toContain('uv download: HTTP 503');
    expect(await readScrapling(home)).toBeUndefined();
    expect(readdirSync(`${home}-web-tools`)).toEqual([]);
    vi.stubGlobal('fetch', async () => new Response('corrupted archive'));
    await ensureWebTools(home, (message) => logs.push(message));
    expect(logs.join('\n')).toContain('uv checksum mismatch');
    expect(readdirSync(`${home}-web-tools`)).toEqual([]);
  });

  it('activates private commands without depending on a shell profile or duplicating PATH', () => {
    const home = '/private/cairn home';
    const env = { PATH: '/usr/bin' };
    activateWebTools(home, env);
    activateWebTools(home, env);
    expect(env.PATH.split(delimiter)).toEqual([webToolsBin(home), '/usr/bin']);
    expect(uvArchive('darwin', 'arm64').target).toBe('aarch64-apple-darwin');
    expect(uvArchive('darwin', 'x64').target).toBe('x86_64-apple-darwin');
    expect(uvArchive('linux', 'x64').target).toBe('x86_64-unknown-linux-gnu');
    expect(uvArchive('linux', 'arm64').target).toBe('aarch64-unknown-linux-gnu');
    expect(() => uvArchive('win32', 'x64')).toThrow('do not support');
  });

  it('refreshes HTTP readiness once per window and removes stale capability on failure', async () => {
    let clock = 0;
    let available = true;
    let runs = 0;
    const probe = new ScraplingProbe(
      async () => {
        runs++;
        if (!available) throw new Error('Python removed');
        return { version: '0.5.1' };
      },
      () => clock,
    );
    expect(probe.current()).toBeUndefined();
    await probe.settled();
    expect(probe.current()).toEqual({ version: '0.5.1' });
    clock = WEB_TOOLS_REFRESH_MS - 1;
    probe.current();
    expect(runs).toBe(1);
    available = false;
    clock++;
    probe.current();
    await probe.settled();
    expect(probe.current()).toBeUndefined();
    expect(runs).toBe(2);
  });
});
