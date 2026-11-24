import { expect, test } from 'vitest';
import type { AntigravityInstall, AntigravityManaged } from '../src/backend/antigravity-managed.js';
import { MachineClient } from '../src/machine-client.js';
import { boot, FakeMachineApi, waitFor } from './machine-loop-harness.js';

test('every claim advertises attachment verification support while preserving claim limits', async () => {
  const bodies: unknown[] = [];
  const client = new MachineClient({
    serverUrl: 'http://server',
    fetchImpl: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ step: null });
    },
  });
  await client.claim();
  await client.claim(undefined, { maxWorkers: 2, role: 'coordinator' });
  expect(bodies).toEqual([
    { verifyAttachments: true },
    { maxWorkers: 2, role: 'coordinator', verifyAttachments: true },
  ]);
});

test('me() keeps working when the server stored a sandbox cause this daemon does not know', async () => {
  const confinement = {
    state: 'unavailable',
    reason: 'startup-failed',
    invocation: '7d4f6a2e-8b1c-4e3a-9f5d-2c6b8a1e4f70',
    generation: 3,
    revision: 2,
  };
  const client = new MachineClient({
    serverUrl: 'http://server',
    fetchImpl: async () =>
      Response.json({
        id: 'm1',
        name: 'box',
        teamId: 't1',
        online: true,
        latestCliVersion: null,
        kind: 'remote',
        enabledRuntimes: [],
        capabilities: {
          mcpServers: [],
          skills: [],
          osPlatform: 'linux',
          confinement,
          confinementCause: { kind: 'cgroup-too-old' },
        },
      }),
  });
  const me = await client.me();
  expect(me.capabilities?.confinement).toEqual(confinement);
  expect(me.capabilities?.confinementCause).toBeUndefined();
});

test('reportAntigravityVerify posts the live probe payload to /api/machine/antigravity/verify', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const client = new MachineClient({
    serverUrl: 'http://server',
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true });
    },
  });
  await client.reportAntigravityVerify({
    checkId: 'chk-1',
    installed: true,
    authenticated: true,
    version: '1.5.10',
    source: 'managed',
    models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
    durationMs: 310,
  });
  expect(calls).toEqual([
    {
      url: 'http://server/api/machine/antigravity/verify',
      body: {
        checkId: 'chk-1',
        installed: true,
        authenticated: true,
        version: '1.5.10',
        source: 'managed',
        models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        durationMs: 310,
      },
    },
  ]);
});

test('background antigravity probe immediately pushes presence when sign-in status changes', async () => {
  const api = new FakeMachineApi();
  let install: AntigravityInstall = {
    version: '1.5.15',
    binPath: '/fake/antigravity',
    args: ['acp'],
    source: 'managed',
    authenticated: false,
    models: [],
  };
  let probeDoneAt = 0;
  const antigravityManaged: AntigravityManaged = {
    current: () => install,
    ensure: async () => install,
    probe: async () => {
      await new Promise((r) => setTimeout(r, 25));
      install = {
        ...install,
        authenticated: true,
        models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
      };
      probeDoneAt = Date.now();
      return install;
    },
    probeDetailed: async () => ({ kind: 'ok', install: (await antigravityManaged.probe())! }),
  };

  await boot({
    api,
    antigravityManaged,
    presenceIntervalMs: 500,
  });

  await waitFor(() => probeDoneAt > 0, 2_000);
  await waitFor(
    () =>
      api.presenceBodies.some(
        (body) =>
          (body as { capabilities?: { antigravity?: { authenticated?: boolean } } })?.capabilities
            ?.antigravity?.authenticated === true,
      ),
    1_500,
  );
  const delayAfterProbeMs = Date.now() - probeDoneAt;
  expect(delayAfterProbeMs).toBeLessThan(200);
});

test('antigravity.verify reports timedOut without clearing installed when probeDetailed times out', async () => {
  const api = new FakeMachineApi();
  const install: AntigravityInstall = {
    version: '1.5.15',
    binPath: '/fake/antigravity',
    args: ['acp'],
    source: 'managed',
    authenticated: true,
    models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
  };
  const antigravityManaged: AntigravityManaged = {
    current: () => install,
    ensure: async () => install,
    probe: async () => install,
    probeDetailed: async () => ({ kind: 'timeout' }),
  };

  await boot({ api, antigravityManaged });
  await waitFor(() => api.onStreamEvent !== null, 2_000);
  api.onStreamEvent?.({ type: 'antigravity.verify', checkId: 'chk-timeout-1' });
  await waitFor(() => api.antigravityVerifyBodies.length === 1, 2_000);
  expect(api.antigravityVerifyBodies[0]).toMatchObject({
    checkId: 'chk-timeout-1',
    installed: true,
    authenticated: false,
    timedOut: true,
  });
});
