import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { ScopedComputerProviders } from '../src/computer/provider.js';
import { PINNED_AGENT_BROWSER_VERSION } from '../src/orb/computer.js';
import { boot, FakeMachineApi, waitFor } from './machine-loop-harness.js';
import { FakeOrbProvider } from './orb-fake.js';
import { testTempDir } from './test-temp-dir.js';

describe('online sequence canon (02 §5.4/r3 §1.5)', () => {
  test('unregistered → enroll → full sequence line order', async () => {
    const { handle, api, lines, paths } = await boot({});
    await waitFor(() => lines.some((l) => l.includes('[wake] push channel connected')));
    expect(lines).not.toContain('Loading pi runtime…');
    expect(lines).toContain('Enrolled in team team-1 (machine m1)');
    expect(lines.some((l) => l === 'Online (machineId=m1); polling http://server')).toBe(true);
    expect(lines).toContain('[recover] no pending steps found');
    expect(lines).toContain('[wake] push channel connected');
    const idx = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(idx('Online (machineId')).toBeLessThan(idx('[recover]'));
    expect(idx('[recover]')).toBeLessThan(idx('[wake] push channel connected'));
    expect(existsSync(paths.machineJson)).toBe(true);
    expect(JSON.parse(readFileSync(paths.machineJson, 'utf8')).machineId).toBe('m1');
    expect(api.calls[0]).toBe('enroll:team-1');
    const enrollBody = api.enrollBodies[0] as { claudeCode?: unknown };
    const report = enrollBody.claudeCode as {
      installed: boolean;
      hostname: string;
      models: unknown[];
    };
    expect(typeof report.installed).toBe('boolean');
    expect(typeof report.hostname).toBe('string');
    expect(report.hostname).not.toBe('');
    expect(Array.isArray(report.models)).toBe(true);
    await waitFor(() => api.presenceBodies.length > 0);
    expect((api.presenceBodies[0] as { claudeCode?: unknown }).claudeCode !== undefined).toBe(true);
    const caps = (enrollBody as { capabilities?: unknown }).capabilities as {
      mcpServers: unknown;
      skills: unknown;
    };
    expect(Array.isArray(caps.mcpServers)).toBe(true);
    expect(Array.isArray(caps.skills)).toBe(true);
    expect((api.presenceBodies[0] as { capabilities?: unknown }).capabilities !== undefined).toBe(
      true,
    );
    await handle.stop();
    await handle.done;
    expect(lines).toContain('[machine] Shutting down…');
  });

  test('#1251 capability manifest uploaded with enroll and every presence beat (injected stub pins content)', async () => {
    const { handle, api } = await boot({
      capabilitiesProbe: () => ({ mcpServers: ['figma'], skills: ['verify-cairn'] }),
    });
    await waitFor(() => api.presenceBodies.length > 0);
    expect((api.enrollBodies[0] as { capabilities?: unknown }).capabilities).toMatchObject({
      mcpServers: ['figma'],
      skills: ['verify-cairn'],
      executor: 'host',
      codexLogin: { state: 'absent' },
    });
    expect((api.presenceBodies[0] as { capabilities?: unknown }).capabilities).toMatchObject({
      mcpServers: ['figma'],
      skills: ['verify-cairn'],
      executor: 'host',
      codexLogin: { state: 'absent' },
      confinement: expect.objectContaining({ state: 'checking' }),
    });
    await handle.stop();
    await handle.done;
  });

  test('D71 an Orb executor daemon reports executor orb on enroll and presence', async () => {
    const { handle, api } = await boot({
      capabilitiesProbe: () => ({ mcpServers: [], skills: [] }),
      orbProvider: new FakeOrbProvider({
        runner: async () => ({ code: 0, stdout: '', stderr: '' }),
      }),
    });
    await waitFor(() => api.presenceBodies.length > 0);
    expect(
      (api.enrollBodies[0] as { capabilities?: { executor?: string } }).capabilities?.executor,
    ).toBe('orb');
    expect(
      (api.presenceBodies[0] as { capabilities?: { executor?: string } }).capabilities?.executor,
    ).toBe('orb');
    await handle.stop();
    await handle.done;
  });

  test('D71 a probe that names an executor cannot override the provider the daemon actually runs', async () => {
    const { handle, api } = await boot({
      capabilitiesProbe: () => ({ mcpServers: [], skills: [], executor: 'orb' }),
    });
    await waitFor(() => api.presenceBodies.length > 0);
    expect(
      (api.presenceBodies[0] as { capabilities?: { executor?: string } }).capabilities?.executor,
    ).toBe('host');
    await handle.stop();
    await handle.done;
  });

  test('stop(cause) exit line carries a cause suffix (#691: signal name on record)', async () => {
    const { handle, lines } = await boot({});
    await waitFor(() => lines.some((l) => l.includes('[wake] push channel connected')));
    await handle.stop('SIGTERM');
    await handle.done;
    expect(lines).toContain('[machine] Shutting down… (SIGTERM)');
  });
});

describe('push channel failures are reported once per outage', () => {
  test('a failed stream logs the cause, then the reconnect is announced again', async () => {
    class FlakyStreamApi extends FakeMachineApi {
      private attempts = 0;
      override async stream(signal: AbortSignal, onEvent: unknown, onConnected?: () => void) {
        this.attempts += 1;
        if (this.attempts <= 2) throw new Error('stream refused');
        await super.stream(signal, onEvent, onConnected);
      }
    }
    const { handle, lines } = await boot({ api: new FlakyStreamApi() });
    await waitFor(() => lines.some((l) => l.includes('[wake] push channel connected')), 10_000);
    const down = lines.filter((l) => l.includes('[wake] push channel down: stream refused'));
    expect(down).toHaveLength(1);
    expect(lines.indexOf(down[0] as string)).toBeLessThan(
      lines.findIndex((l) => l.includes('[wake] push channel connected')),
    );
    await handle.stop();
    await handle.done;
  }, 15_000);
});

describe('server migration diagnosis (#519 control-plane move: machine.json serverUrl from registration differs from the current config)', () => {
  test('failure mode: old machine.json + new CAIRN_SERVER → startup warning line (contains both addresses and re-registration guidance), still goes online', async () => {
    const api = new FakeMachineApi();
    const { handle, lines } = await boot({
      api,
      preEnrolled: { serverUrl: 'http://old-host:8787' },
    });
    await waitFor(() =>
      lines.some((l) => l.includes('Online (machineId=m-old); polling http://server')),
    );
    const warn = lines.find((l) => l.includes('[machine]') && l.includes('re-enroll'));
    expect(warn).toBeDefined();
    expect(warn).toContain('http://old-host:8787');
    expect(warn).toContain('http://server');
    expect(api.calls).not.toContain('enroll:team-1');
    await handle.stop();
    await handle.done;
  });

  test('consistent (or unregistered) → no such warning line', async () => {
    const api = new FakeMachineApi();
    const { handle, lines } = await boot({ api, preEnrolled: { serverUrl: 'http://server' } });
    await waitFor(() => lines.some((l) => l.includes('Online (machineId=m-old)')));
    expect(lines.some((l) => l.includes('re-enroll'))).toBe(false);
    await handle.stop();
    await handle.done;
  });
});

describe('D75 own computer opt-in', () => {
  const report = async (capEnv: NodeJS.ProcessEnv) => {
    const { handle, api } = await boot({
      capabilitiesProbe: () => ({ mcpServers: [], skills: [] }),
      capEnv,
    });
    await waitFor(() => api.presenceBodies.length > 0 || api.enrollBodies.length > 0);
    const caps = (api.enrollBodies[0] as { capabilities?: { ownComputer?: true } }).capabilities;
    await handle.stop();
    await handle.done;
    return caps;
  };

  test('CAIRN_OWN_COMPUTER=1 reports ownComputer', async () => {
    expect((await report({ CAIRN_OWN_COMPUTER: '1' }))?.ownComputer).toBe(true);
  });

  test('without the switch the machine does not report ownComputer', async () => {
    expect((await report({}))?.ownComputer).toBeUndefined();
    expect((await report({ CAIRN_OWN_COMPUTER: 'true' }))?.ownComputer).toBeUndefined();
  });
});

describe('D75 orb computer capability', () => {
  const report = async (orbComputer?: ScopedComputerProviders, env: NodeJS.ProcessEnv = {}) => {
    const previous = { ...process.env };
    Object.assign(process.env, env);
    try {
      const { handle, api } = await boot({
        capabilitiesProbe: () => ({ mcpServers: [], skills: [] }),
        capEnv: {},
        ...(orbComputer ? { orbComputer } : {}),
      });
      await waitFor(() => api.presenceBodies.length > 0 || api.enrollBodies.length > 0);
      const caps = (api.enrollBodies[0] as { capabilities?: { computer?: true; browser?: true } })
        .capabilities;
      await handle.stop();
      await handle.done;
      return caps;
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key];
      }
      Object.assign(process.env, previous);
    }
  };

  const orbComputer: ScopedComputerProviders = {
    forScope: () => {
      throw new Error('unused');
    },
    killAll: async () => {},
  };

  test('a daemon with an Orb computer provider reports computer', async () => {
    expect((await report(orbComputer))?.computer).toBe(true);
  });

  test('a daemon without one does not', async () => {
    expect((await report())?.computer).toBeUndefined();
  });

  test('browser stays off until the computer image marker pins agent-browser', async () => {
    const caps = await report(orbComputer);
    expect(caps?.computer).toBe(true);
    expect(caps?.browser).toBeUndefined();
  });

  test('browser is advertised when the computer image marker pins agent-browser', async () => {
    const root = testTempDir('machine-boot-browser-');
    const dir = join(root, 'var/lib/cairn-orb');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'computer-image'),
      `recipe=abc\npackages=chromium\nagent-browser=${PINNED_AGENT_BROWSER_VERSION}\n`,
    );
    const caps = await report(orbComputer, { CAIRN_ORB_ROOT: root });
    expect(caps?.computer).toBe(true);
    expect(caps?.browser).toBe(true);
  });
});
