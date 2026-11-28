import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOST_NAME_NEEDS_LOOPBACK_REFUSAL } from '@cairn/shared';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { HOST_DESKTOP_PROGRAMS } from '../src/computer/host-desktop.js';
import type { ScopedComputerProviders } from '../src/computer/provider.js';
import { MachineApiError } from '../src/machine-client.js';
import * as workspaceFileRead from '../src/workspace-file-read.js';
import { boot, FakeMachineApi, startMachine, waitFor } from './machine-loop-harness.js';
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

  test('startup waits for a server that is restarting instead of exiting', async () => {
    const api = new FakeMachineApi();
    const me = api.me.bind(api);
    let failures = 2;
    api.me = async () => {
      if (failures > 0) {
        failures -= 1;
        throw new TypeError('fetch failed');
      }
      return me();
    };
    const { lines } = await boot({ api });
    expect(lines.filter((l) => l.includes('server not reachable at startup'))).toHaveLength(2);
    expect(lines).toContain('Online (machineId=m1); polling http://server');
  });

  test('rejected credentials name their server and wait for a re-enroll instead of crash-looping', async () => {
    const api = new FakeMachineApi();
    api.me = async () => {
      throw new MachineApiError(401, 'unauthorized');
    };
    let supportChanged = () => {};
    const createService = workspaceFileRead.createWorkspaceFileService;
    const spy = vi
      .spyOn(workspaceFileRead, 'createWorkspaceFileService')
      .mockImplementation((opts) => {
        supportChanged = opts.onSupportChange ?? (() => {});
        return createService(opts);
      });
    onTestFinished(() => spy.mockRestore());
    const started = startMachine({ api, preEnrolled: { serverUrl: 'http://other-host:60805' } });
    onTestFinished(() => {
      releaseTestTempDir(started.home);
    });
    let settled = false;
    const outcome = started.handlePromise.then(
      () => 'online',
      (error: unknown) => {
        settled = true;
        return error instanceof Error ? error.message : String(error);
      },
    );
    await waitFor(() => started.lines.some((l) => l.includes('rejected them')));
    const notice = started.lines.find((l) => l.includes('rejected them'));
    expect(notice).toContain('http://other-host:60805');
    expect(notice).toContain('http://server');
    supportChanged();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(api.presenceBodies).toHaveLength(0);
    expect(settled).toBe(false);
    expect(started.lines.filter((l) => l.includes('rejected them'))).toHaveLength(1);
    writeFileSync(
      started.paths.machineJson,
      JSON.stringify({
        machineId: 'm-new',
        token: 'c'.repeat(64),
        teamId: 'team-1',
        serverUrl: 'http://server',
      }),
    );
    expect(await outcome).toContain('machine.json changed');
  });

  test('workspace support discovered during startup presence is reported after authentication', async () => {
    let supportChanged = () => {};
    let supported = false;
    const createService = workspaceFileRead.createWorkspaceFileService;
    const spy = vi
      .spyOn(workspaceFileRead, 'createWorkspaceFileService')
      .mockImplementation((opts) => {
        supportChanged = opts.onSupportChange ?? (() => {});
        return { ...createService(opts), supported: () => supported, probe: async () => false };
      });
    onTestFinished(() => spy.mockRestore());
    const api = Object.assign(new FakeMachineApi(), { replyWorkspaceFile: vi.fn() });
    const presence = api.presence.bind(api);
    let releasePresence = () => {};
    const blocked = new Promise<void>((resolve) => {
      releasePresence = resolve;
    });
    let first = true;
    api.presence = async (body) => {
      const result = await presence(body);
      if (first) {
        first = false;
        await blocked;
      }
      return result;
    };
    const started = startMachine({ api });
    onTestFinished(() => {
      releaseTestTempDir(started.home);
    });
    await waitFor(() => api.presenceBodies.length === 1);
    supported = true;
    supportChanged();
    releasePresence();
    const handle = await started.handlePromise;
    await waitFor(() => api.presenceBodies.length >= 2);
    const body = api.presenceBodies.at(-1) as { capabilities: { workspaceFileRead?: boolean } };
    expect(body.capabilities.workspaceFileRead).toBe(true);
    await handle.stop();
    await handle.done;
  });

  test('rejected credentials for the configured server name that server once', async () => {
    const api = new FakeMachineApi();
    api.me = async () => {
      throw new MachineApiError(401, 'unauthorized');
    };
    const started = startMachine({ api, preEnrolled: { serverUrl: 'http://server' } });
    onTestFinished(() => {
      releaseTestTempDir(started.home);
    });
    const outcome = started.handlePromise.catch((error: unknown) => error);
    await waitFor(() => started.lines.some((l) => l.includes('rejected them')));
    const notice = started.lines.find((l) => l.includes('rejected them')) ?? '';
    expect(notice.split('http://server')).toHaveLength(2);
    writeFileSync(started.paths.machineJson, '{}');
    await outcome;
  });

  test('a stop sent by the server says why the runner stops', async () => {
    const { handle, api, lines } = await boot({});
    await waitFor(() => lines.some((l) => l.includes('[wake] push channel connected')));
    api.onStreamEvent?.({ type: 'shutdown' });
    await handle.done;
    expect(lines).toContain(
      '[machine] Shutting down… (the server told this Runner to stop: it was removed, revoked or enrolled again, or another process connected with the same credentials)',
    );
  });

  test('an API key without a team id says it is not used', async () => {
    const { handle, lines } = await boot({ apiKeyWithoutTeam: true });
    expect(lines).toContain(
      '[machine] the API key is not used without --team <id>; approve this computer in the browser instead',
    );
    await handle.stop();
    await handle.done;
  });

  test('a local-host-proof enrollment refusal backs off, logs one recovery line, and continues after the stale row is gone', async () => {
    const api = new FakeMachineApi();
    let refused = true;
    let starts = 0;
    api.enrollStart = async () => {
      starts += 1;
      if (refused) {
        throw new MachineApiError(
          409,
          '{"error":"this enrollment does not prove it is the local host runner"}',
        );
      }
      return {
        enrollId: 'e1',
        url: 'http://server/app/machines/authorize?enroll=e1',
        pollSecret: 'sec',
      };
    };
    const started = startMachine({ api, browserEnrollment: true });
    onTestFinished(() => {
      releaseTestTempDir(started.home);
    });
    let settled = false;
    const observed = started.handlePromise.then(
      () => {
        settled = true;
        return 'online';
      },
      (error: unknown) => {
        settled = true;
        return error instanceof Error ? error.message : String(error);
      },
    );
    await waitFor(
      () =>
        settled ||
        started.lines.some((l) => l.includes('local Runner record belongs to another computer')),
    );
    expect(settled).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(starts).toBeGreaterThan(1);
    expect(settled).toBe(false);
    expect(
      started.lines.filter((l) => l.includes('local Runner record belongs to another computer')),
    ).toHaveLength(1);
    refused = false;
    expect(await observed).toBe('online');
    const handle = await started.handlePromise;
    await handle.stop();
    await handle.done;
    expect(started.lines).toContain('Enrolled in team team-1 (machine m1)');
  });

  test('a lasting enrollment refusal stays inside the server start limit and keeps one log line', async () => {
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const api = new FakeMachineApi();
    let sawFirstAttempt = () => {};
    const firstAttempt = new Promise<void>((resolve) => {
      sawFirstAttempt = resolve;
    });
    const admitted: number[] = [];
    let throttled = 0;
    let refused = true;
    api.enrollStart = async () => {
      if (!vi.isFakeTimers()) vi.useFakeTimers();
      sawFirstAttempt();
      const cutoff = Date.now() - 600_000;
      if (admitted.filter((at) => at > cutoff).length >= 20) {
        throttled += 1;
        throw new MachineApiError(429, '{"error":"too many enrollment requests; wait and retry"}');
      }
      admitted.push(Date.now());
      if (refused) {
        throw new MachineApiError(
          409,
          '{"error":"this enrollment does not prove it is the local host runner"}',
        );
      }
      return {
        enrollId: 'e1',
        url: 'http://server/app/machines/authorize?enroll=e1',
        pollSecret: 'sec',
      };
    };
    const started = startMachine({ api, browserEnrollment: true, claimBackoffBaseMs: 1_000 });
    onTestFinished(() => {
      releaseTestTempDir(started.home);
    });
    await firstAttempt;
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(throttled).toBe(0);
    const refusalLines = started.lines.filter((l) => l.includes('enrollment refused'));
    expect(refusalLines).toHaveLength(1);
    expect(refusalLines[0]).toContain('retrying until it is accepted, at most 60s apart');
    const busiestWindow = Math.max(
      ...admitted.map((at) => admitted.filter((t) => t >= at && t < at + 600_000).length),
    );
    expect(busiestWindow).toBeLessThanOrEqual(16);
    refused = false;
    await vi.advanceTimersByTimeAsync(61_000);
    vi.useRealTimers();
    const handle = await started.handlePromise;
    await handle.stop();
    await handle.done;
  });

  test('a loopback refusal never tells the user to delete a Runner', async () => {
    const api = new FakeMachineApi();
    const start = api.enrollStart.bind(api);
    let refusals = 1;
    api.enrollStart = async (body) => {
      if (refusals > 0) {
        refusals -= 1;
        throw new MachineApiError(409, JSON.stringify({ error: HOST_NAME_NEEDS_LOOPBACK_REFUSAL }));
      }
      return start(body);
    };
    const { handle, lines } = await boot({ api, browserEnrollment: true });
    const line = lines.find((l) => l.includes('enrollment refused')) ?? '';
    expect(line).toContain('--name');
    expect(line).not.toContain('delete');
    await handle.stop();
    await handle.done;
  });

  test('a refused lost-journal report at startup does not exit the runner', async () => {
    const api = new FakeMachineApi();
    api.recoverSteps = [
      { id: 'gone', buildId: 'b1', kind: 'build', machineId: 'm1', createdAt: 1 },
    ];
    api.done = async () => {
      throw new MachineApiError(410, '{"error":"step gone no longer exists"}');
    };
    const { handle, lines } = await boot({ api });
    expect(lines.some((l) => l.includes('server refused the lost-journal report (410)'))).toBe(
      true,
    );
    await handle.stop();
    await handle.done;
  });

  test('an api-key enrollment refusal backs off instead of exiting and continues when the server accepts', async () => {
    const api = new FakeMachineApi();
    let refused = true;
    let attempts = 0;
    api.enroll = async (body) => {
      attempts += 1;
      if (refused) {
        throw new MachineApiError(
          403,
          '{"error":"a revoked machine re-registers through the authorize page"}',
        );
      }
      return {
        machineId: 'm1',
        token: 'a'.repeat(64),
        teamId: body.teamId,
        serverUrl: 'http://server',
      };
    };
    const started = startMachine({ api });
    onTestFinished(() => {
      releaseTestTempDir(started.home);
    });
    let settled = false;
    const observed = started.handlePromise.then(
      () => {
        settled = true;
        return 'online';
      },
      (error: unknown) => {
        settled = true;
        return error instanceof Error ? error.message : String(error);
      },
    );
    await waitFor(
      () => settled || started.lines.some((l) => l.includes('approve this computer again')),
    );
    expect(settled).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(attempts).toBeGreaterThan(1);
    expect(
      started.lines.filter((l) => l.includes('a revoked machine re-registers through')),
    ).toHaveLength(1);
    refused = false;
    expect(await observed).toBe('online');
    const handle = await started.handlePromise;
    await handle.stop();
    await handle.done;
  });

  test('an unreachable server during browser enrollment backs off before enrollment exists', async () => {
    const api = new FakeMachineApi();
    let failures = 2;
    const start = api.enrollStart.bind(api);
    api.enrollStart = async (body) => {
      if (failures > 0) {
        failures -= 1;
        throw new TypeError('fetch failed');
      }
      return start(body);
    };
    const { handle, lines } = await boot({ api, browserEnrollment: true });
    expect(lines.filter((l) => l.includes('enrollment unreachable: fetch failed'))).toHaveLength(1);
    expect(
      lines.filter((l) => l.includes('check that the server is running and reachable')),
    ).toHaveLength(1);
    expect(lines).toContain('Enrolled in team team-1 (machine m1)');
    await handle.stop();
    await handle.done;
  });

  test('an expired or burned browser enrollment starts over inside the same process', async () => {
    const api = new FakeMachineApi();
    let enrollments = 0;
    api.enrollStart = async () => {
      enrollments += 1;
      return {
        enrollId: `e${enrollments}`,
        url: `http://server/app/machines/authorize?enroll=e${enrollments}`,
        pollSecret: 'sec',
      };
    };
    api.enrollPoll = async (enrollId: string) => {
      if (enrollId === 'e1') return { status: 'expired' as const };
      return {
        status: 'authorized' as const,
        machine: {
          machineId: 'm1',
          token: 'a'.repeat(64),
          teamId: 'team-1',
          serverUrl: 'http://server',
        },
      };
    };
    const { handle, lines } = await boot({ api, browserEnrollment: true });
    expect(enrollments).toBe(2);
    expect(lines.filter((l) => l.includes('enrollment expired: nobody approved'))).toHaveLength(1);
    expect(lines).toContain('Enrolled in team team-1 (machine m1)');
    await handle.stop();
    await handle.done;
  });

  test('an invalid poll secret discards only the burned pending enrollment and starts a new one', async () => {
    const api = new FakeMachineApi();
    let enrollments = 0;
    api.enrollStart = async () => {
      enrollments += 1;
      return {
        enrollId: `e${enrollments}`,
        url: `http://server/app/machines/authorize?enroll=e${enrollments}`,
        pollSecret: 'sec',
      };
    };
    api.enrollPoll = async (enrollId: string) => {
      if (enrollId === 'e1') throw new MachineApiError(403, '{"error":"invalid poll secret"}');
      return {
        status: 'authorized' as const,
        machine: {
          machineId: 'm1',
          token: 'a'.repeat(64),
          teamId: 'team-1',
          serverUrl: 'http://server',
        },
      };
    };
    const { handle, lines } = await boot({ api, browserEnrollment: true });
    expect(enrollments).toBe(2);
    expect(lines.filter((l) => l.includes('invalid poll secret'))).toHaveLength(1);
    expect(lines).toContain('Enrolled in team team-1 (machine m1)');
    await handle.stop();
    await handle.done;
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
    });
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
    const caps = (
      api.enrollBodies[0] as {
        capabilities?: { ownComputer?: true; ownComputerShell?: true };
      }
    ).capabilities;
    await handle.stop();
    await handle.done;
    return caps;
  };

  test('CAIRN_OWN_COMPUTER=1 reports the host shell, not the verified screen', async () => {
    const caps = await report({ CAIRN_OWN_COMPUTER: '1' });
    expect(caps?.ownComputerShell).toBe(true);
    expect(caps?.ownComputer).toBeUndefined();
  });

  test('without the switch the machine does not report ownComputer', async () => {
    expect((await report({}))?.ownComputer).toBeUndefined();
    expect((await report({ CAIRN_OWN_COMPUTER: 'true' }))?.ownComputerShell).toBeUndefined();
  });

  test('the bundled agent-desktop path reports ownComputer', async () => {
    const caps = await report({ CAIRN_AGENT_DESKTOP: '/Applications/Cairn.app/agent-desktop' });
    expect(caps?.ownComputer).toBe(true);
  });
});

describe('D75 computer capability', () => {
  const report = async (
    options: {
      orbComputer?: ScopedComputerProviders;
      capEnv?: NodeJS.ProcessEnv;
      platform?: string;
    } = {},
  ) => {
    const { handle, api } = await boot({
      capabilitiesProbe: () => ({ mcpServers: [], skills: [] }),
      capEnv: options.capEnv ?? {},
      ...(options.orbComputer ? { orbComputer: options.orbComputer } : {}),
      ...(options.platform ? { platform: options.platform } : {}),
    });
    await waitFor(() => api.presenceBodies.length > 0 || api.enrollBodies.length > 0);
    const caps = (
      api.enrollBodies[0] as {
        capabilities?: { computer?: true; browser?: true; computerKind?: 'host' | 'vm' };
      }
    ).capabilities;
    await handle.stop();
    await handle.done;
    return caps;
  };

  const desktopPrograms = () => {
    const bin = join(testTempDir('machine-boot-desktop-'), 'bin');
    mkdirSync(bin, { recursive: true });
    for (const name of HOST_DESKTOP_PROGRAMS) {
      writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    return bin;
  };

  test('an injected computer provider reports computer', async () => {
    const orbComputer: ScopedComputerProviders = {
      forScope: () => {
        throw new Error('unused');
      },
      killAll: async () => {},
    };
    expect((await report({ orbComputer }))?.computer).toBe(true);
  });

  test('a Linux daemon with the desktop programs offers the host desktop', async () => {
    const caps = await report({ platform: 'linux', capEnv: { PATH: desktopPrograms() } });
    expect(caps?.computer).toBe(true);
    expect(caps?.computerKind).toBe('host');
    expect(caps?.browser).toBeUndefined();
  });

  test('a Mac offers no built-in VM computer', async () => {
    const caps = await report({ platform: 'darwin', capEnv: { PATH: desktopPrograms() } });
    expect(caps?.computer).toBeUndefined();
    expect(caps?.computerKind).toBeUndefined();
  });

  test('a Linux daemon missing them offers no computer', async () => {
    const empty = join(testTempDir('machine-boot-empty-'), 'bin');
    mkdirSync(empty, { recursive: true });
    expect(
      (await report({ platform: 'linux', capEnv: { PATH: empty } }))?.computer,
    ).toBeUndefined();
  });
});
