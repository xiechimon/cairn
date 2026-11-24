import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaimedStep, MachinePresenceResponse } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  boot,
  CLAIMED,
  FakeMachineApi,
  fakeBackend,
  stubManagedRuntime,
  waitFor,
} from './machine-loop-harness.js';

describe('per-step backend resolution (spec 17 A3: backendFor is the only branch point)', () => {
  test('pi startup never installs Devin; opting in installs once and reports readiness', async () => {
    const api = new FakeMachineApi();
    const presence = api.presence.bind(api);
    let requested: boolean | undefined;
    api.presence = async (body): Promise<MachinePresenceResponse> => ({
      ...(await presence(body)),
      ...(requested === undefined ? {} : { installDevin: requested }),
    });
    let attempts = 0;
    let installed = false;
    let finish: (() => void) | undefined;
    const testDevinInstall = {
      version: 'test',
      command: '/devin',
      binPath: '/devin',
      args: ['acp'],
      versionDir: null,
      source: 'managed' as const,
      home: '/devin-home',
    };
    const { handle } = await boot({
      api,
      presenceIntervalMs: 20,
      devinManaged: stubManagedRuntime({
        current: () => (installed ? testDevinInstall : null),
        ensure: async () => {
          attempts += 1;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          installed = true;
          return testDevinInstall;
        },
      }),
    });
    await waitFor(() => api.presenceBodies.length >= 3);
    expect(attempts).toBe(0);
    requested = false;
    const count = api.presenceBodies.length;
    await waitFor(() => api.presenceBodies.length >= count + 2);
    expect(attempts).toBe(0);
    requested = true;
    await waitFor(() => finish !== undefined);
    const pending = api.presenceBodies.length;
    await waitFor(() => api.presenceBodies.length >= pending + 2);
    expect(attempts).toBe(1);
    finish?.();
    await waitFor(() =>
      api.presenceBodies.some(
        (body) =>
          (body as { capabilities?: { devin?: { installed: boolean } } }).capabilities?.devin
            ?.installed === true,
      ),
    );
    expect(attempts).toBe(1);
    await handle.stop();
    await handle.done;
  });

  test('a Devin install that vanishes mid-session is re-ensured on the next beat', async () => {
    const api = new FakeMachineApi();
    const presence = api.presence.bind(api);
    api.presence = async (body): Promise<MachinePresenceResponse> => ({
      ...(await presence(body)),
      installDevin: true,
    });
    let attempts = 0;
    let installed = true;
    const testDevinInstall = {
      version: 'test',
      command: '/devin',
      binPath: '/devin',
      args: ['acp'],
      versionDir: null,
      source: 'managed' as const,
      home: '/devin-home',
    };
    const { handle } = await boot({
      api,
      presenceIntervalMs: 20,
      devinManaged: stubManagedRuntime({
        current: () => (installed ? testDevinInstall : null),
        ensure: async () => {
          attempts += 1;
          installed = true;
          return testDevinInstall;
        },
      }),
    });
    await waitFor(() => api.presenceBodies.length >= 3);
    const settled = attempts;
    installed = false;
    await waitFor(() => attempts === settled + 1);
    await handle.stop();
    await handle.done;
  });

  test('an Antigravity install that vanishes mid-session is re-ensured on the next beat', async () => {
    const api = new FakeMachineApi();
    let attempts = 0;
    let installed = true;
    const { handle } = await boot({
      api,
      presenceIntervalMs: 20,
      antigravityManaged: {
        current: () =>
          installed
            ? {
                version: 'test',
                binPath: '/agy',
                args: [],
                source: 'managed' as const,
                authenticated: true,
                models: [],
              }
            : null,
        ensure: async () => {
          attempts += 1;
          installed = true;
          return {
            version: 'test',
            binPath: '/agy',
            args: [],
            source: 'managed' as const,
            authenticated: true,
            models: [],
          };
        },
        probe: async () => null,
      },
    });
    await waitFor(() => api.presenceBodies.length >= 3);
    const settled = attempts;
    installed = false;
    await waitFor(() => attempts === settled + 1);
    await handle.stop();
    await handle.done;
  });

  test('an authenticated Antigravity install is re-probed so a later sign-out is seen', async () => {
    const api = new FakeMachineApi();
    let authenticated = true;
    let probes = 0;
    const { handle } = await boot({
      api,
      presenceIntervalMs: 20,
      antigravityReprobeMs: 80,
      antigravityManaged: {
        current: () => ({
          version: 'test',
          binPath: '/agy',
          args: [],
          source: 'managed' as const,
          authenticated,
          models: [],
        }),
        ensure: async () => null,
        probe: async () => {
          probes += 1;
          authenticated = false;
          return {
            version: 'test',
            binPath: '/agy',
            args: [],
            source: 'managed' as const,
            authenticated: false,
            models: [],
          };
        },
      },
    });
    await waitFor(() => probes >= 1);
    await waitFor(() =>
      api.presenceBodies.some(
        (body) =>
          (body as { capabilities?: { antigravity?: { authenticated?: boolean } } }).capabilities
            ?.antigravity?.authenticated === false,
      ),
    );
    await handle.stop();
    await handle.done;
  });

  test('a failing Antigravity ensure is not retried on every presence tick', async () => {
    const api = new FakeMachineApi();
    let attempts = 0;
    const { handle } = await boot({
      api,
      presenceIntervalMs: 20,
      antigravityEnsureRetryMs: 10_000,
      antigravityManaged: {
        current: () => null,
        ensure: async () => {
          attempts += 1;
          return null;
        },
        probe: async () => null,
      },
    });
    await waitFor(() => attempts === 2);
    await waitFor(() => api.presenceBodies.length >= 5);
    expect(attempts).toBe(2);
    await handle.stop();
    await handle.done;
  });

  test('checks the Antigravity release channel periodically even when already installed', async () => {
    const api = new FakeMachineApi();
    let version = '1.5.15';
    let ensures = 0;
    const { handle } = await boot({
      api,
      presenceIntervalMs: 20,
      antigravityUpdateCheckMs: 60,
      antigravityManaged: {
        current: () => ({
          version,
          binPath: `/agy/${version}`,
          args: ['acp', '--app-data-dir', 'antigravity-acp'],
          source: 'managed' as const,
          authenticated: true,
          models: [],
        }),
        ensure: async () => {
          ensures += 1;
          if (ensures >= 2) version = '1.5.16';
          return {
            version,
            binPath: `/agy/${version}`,
            args: ['acp', '--app-data-dir', 'antigravity-acp'],
            source: 'managed' as const,
            authenticated: true,
            models: [],
          };
        },
        probe: async () => null,
      },
    });
    await waitFor(() => ensures >= 2);
    await waitFor(() =>
      api.presenceBodies.some(
        (body) =>
          (body as { capabilities?: { antigravity?: { version?: string } } }).capabilities
            ?.antigravity?.version === '1.5.16',
      ),
    );
    await handle.stop();
    await handle.done;
  });

  test('running Antigravity sessions finish on their old runtime while new sessions switch to the updated runtime', async () => {
    const binDir = makeTestTempDir('agy-switch-');
    try {
      const gateFile = join(binDir, 'release-v1');
      const shQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
      const makeMock = (name: string, label: string, waitForFile?: string): string => {
        const script = join(binDir, name);
        const body = [
          "import { existsSync } from 'node:fs';",
          "import { createInterface } from 'node:readline';",
          'const send = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\\n");',
          'for await (const line of createInterface({ input: process.stdin })) {',
          '  const msg = JSON.parse(line);',
          '  if (msg.method === "initialize") {',
          `    send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, agentInfo: { name: "Antigravity ACP Server", version: ${JSON.stringify(label)} }, agentCapabilities: { loadSession: true } } });`,
          '  } else if (msg.method === "session/new") {',
          `    send({ id: msg.id, result: { sessionId: ${JSON.stringify(`sess-${label}`)}, configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "gemini-4-neon", options: [{ value: "gemini-4-neon", name: "Gemini 4 Neon" }] }] } });`,
          '  } else if (msg.method === "session/set_config_option") {',
          '    send({ id: msg.id, result: { configOptions: [] } });',
          '  } else if (msg.method === "session/prompt") {',
          ...(waitForFile !== undefined
            ? [
                `    while (!existsSync(${JSON.stringify(waitForFile)})) await new Promise((r) => setTimeout(r, 15));`,
              ]
            : []),
          `    send({ method: "session/update", params: { sessionId: ${JSON.stringify(`sess-${label}`)}, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: ${JSON.stringify(`ran-on-${label}`)} } } } });`,
          '    send({ id: msg.id, result: { stopReason: "end_turn" } });',
          '  }',
          '}',
        ].join('\n');
        writeFileSync(
          script,
          `#!/bin/sh\nexec ${shQuote(process.execPath)} --input-type=module -e ${shQuote(body)} -- "$0" "$@"\n`,
        );
        chmodSync(script, 0o755);
        return script;
      };
      const v1Bin = makeMock('agy-v1.sh', '1.5.15', gateFile);
      const v2Bin = makeMock('agy-v2.sh', '1.5.16');
      let current = {
        version: '1.5.15',
        binPath: v1Bin,
        args: ['acp', '--app-data-dir', 'antigravity-acp'],
        source: 'managed' as const,
        authenticated: true,
        models: [{ id: 'gemini-4-neon', name: 'Gemini 4 Neon' }],
      };
      const api = new FakeMachineApi();
      const { handle } = await boot({
        api,
        platform: 'win32',
        antigravityManaged: {
          current: () => current,
          ensure: async () => current,
          probe: async () => current,
        },
      });
      const stepFor = (id: string): ClaimedStep => ({
        ...CLAIMED,
        step: { ...CLAIMED.step, id, kind: 'build' },
        conversationId: `conv-${id}`,
        instruction: 'Hello',
        agent: { ...CLAIMED.agent!, provider: 'antigravity', modelId: 'gemini-4-neon' },
      });
      await waitFor(() => api.parked !== null);
      api.parked?.(stepFor('s-old'));
      await waitFor(() => api.calls.includes('token:s-old'));
      await waitFor(() => api.parked !== null);
      current = { ...current, version: '1.5.16', binPath: v2Bin };
      api.parked?.(stepFor('s-new'));
      await waitFor(() => api.doneBodies.some((entry) => entry.stepId === 's-new'), 10_000);
      expect(api.doneBodies.find((entry) => entry.stepId === 's-new')?.body).toMatchObject({
        status: 'success',
        sessionId: 'sess-1.5.16',
      });
      expect(api.doneBodies.some((entry) => entry.stepId === 's-old')).toBe(false);
      writeFileSync(gateFile, 'go');
      await waitFor(() => api.doneBodies.some((entry) => entry.stepId === 's-old'), 10_000);
      expect(api.doneBodies.find((entry) => entry.stepId === 's-old')?.body).toMatchObject({
        status: 'success',
        sessionId: 'sess-1.5.15',
      });
      await handle.stop();
      await handle.done;
    } finally {
      releaseTestTempDir(binDir);
    }
  });

  test('a failing Devin ensure is not retried on every presence send', async () => {
    const api = new FakeMachineApi();
    const presence = api.presence.bind(api);
    api.presence = async (body): Promise<MachinePresenceResponse> => ({
      ...(await presence(body)),
      installDevin: true,
    });
    let attempts = 0;
    const { handle } = await boot({
      api,
      presenceIntervalMs: 20,
      devinEnsureRetryMs: 10_000,
      devinManaged: stubManagedRuntime({
        current: () => null,
        ensure: async () => {
          attempts += 1;
          return null;
        },
      }),
    });
    await waitFor(() => attempts === 1);
    await waitFor(() => api.presenceBodies.length >= 5);
    expect(attempts).toBe(1);
    await handle.stop();
    await handle.done;
  });

  test.each(['rejected', 'unavailable'])(
    'a %s Devin install retries only while requested',
    async (failure) => {
      const api = new FakeMachineApi();
      const presence = api.presence.bind(api);
      let requested = true;
      api.presence = async (body): Promise<MachinePresenceResponse> => ({
        ...(await presence(body)),
        installDevin: requested,
      });
      let attempts = 0;
      let finish: (() => void) | undefined;
      const { handle } = await boot({
        api,
        presenceIntervalMs: 20,
        devinEnsureRetryMs: 0,
        devinManaged: stubManagedRuntime({
          current: () => null,
          ensure: async () => {
            attempts += 1;
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
            if (failure === 'rejected') throw new Error('download unavailable');
            return null;
          },
        }),
      });
      await waitFor(() => finish !== undefined);
      requested = false;
      finish?.();
      const count = api.presenceBodies.length;
      await waitFor(() => api.presenceBodies.length >= count + 2);
      expect(attempts).toBe(1);
      requested = true;
      await waitFor(() => attempts === 2);
      requested = false;
      finish?.();
      await handle.stop();
      await handle.done;
    },
  );

  function claudeClaimed(): ClaimedStep {
    return { ...CLAIMED, agent: { ...CLAIMED.agent!, provider: 'claude-code' } };
  }

  test('failure mode 1: claude-code step → executed by the claude backend, zero pi sessions + exactly one lazy line', async () => {
    const api = new FakeMachineApi();
    api.claudeSubscriptionToken = 'backends-subscription-token';
    const { backend: pi, created: piCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { backend: claude, created: claudeCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle, lines } = await boot({ api, backend: pi, claudeCodeBackend: claude });
    await waitFor(() => api.parked !== null);
    api.parked?.(claudeClaimed());
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    expect(claudeCreated).toHaveLength(1);
    expect(piCreated).toHaveLength(0);
    expect(lines).not.toContain('Loading pi runtime…');
    const claudeLines = lines.filter((l) => l === 'Loading claude-code runtime…');
    expect(claudeLines).toHaveLength(1);
    expect(lines).toContain('using model claude-code/stub-model');
    await handle.stop();
    await handle.done;
  });

  test('failure mode 2: pi-only step flow → claude backend not initialized, no lazy line', async () => {
    const api = new FakeMachineApi();
    const { backend: pi, created: piCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { backend: claude, created: claudeCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle, lines } = await boot({ api, backend: pi, claudeCodeBackend: claude });
    await waitFor(() => api.parked !== null);
    api.parked?.({ ...CLAIMED, step: { ...CLAIMED.step, id: 's2' } });
    await waitFor(() => api.doneBodies.length === 1);
    expect(piCreated).toHaveLength(1);
    expect(claudeCreated).toHaveLength(0);
    expect(lines.some((l) => l === 'Loading claude-code runtime…')).toBe(false);
    await handle.stop();
    await handle.done;
  });

  test('failure mode 4: runtime step without a subscription token fails before the step, even with a local login', async () => {
    const api = new FakeMachineApi();
    const { backend: pi, created: piCreated } = fakeBackend([]);
    const { backend: claude, created: claudeCreated } = fakeBackend([]);
    const { handle, lines } = await boot({
      api,
      backend: pi,
      claudeCodeBackend: claude,
      claudeCodeAuthProbe: async () => ({
        state: 'logged-in',
        method: 'claude.ai',
        provider: 'firstParty',
      }),
    });
    await waitFor(() => api.parked !== null);
    api.parked?.(claudeClaimed());
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('failed');
    const msg = api.doneBodies[0]?.body.errorMessage ?? '';
    expect(msg).toContain('claude setup-token');
    expect(msg).toContain('设置 → 模型路由');
    expect(claudeCreated).toHaveLength(0);
    expect(piCreated).toHaveLength(0);
    expect(lines.some((l) => l === 'Loading claude-code runtime…')).toBe(false);
    await handle.stop();
    await handle.done;
  });

  test('failure mode 3: mixed step flow (claude step + pi step) → each to its own backend, still exactly one lazy line', async () => {
    const api = new FakeMachineApi();
    api.claudeSubscriptionToken = 'backends-subscription-token';
    const { backend: pi, created: piCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { backend: claude, created: claudeCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle, lines } = await boot({ api, backend: pi, claudeCodeBackend: claude });
    await waitFor(() => api.parked !== null);
    api.parked?.(claudeClaimed());
    await waitFor(() => api.doneBodies.length === 1);
    await waitFor(() => api.parked !== null);
    api.parked?.({ ...CLAIMED, step: { ...CLAIMED.step, id: 's2' } });
    await waitFor(() => api.doneBodies.length === 2);
    expect(claudeCreated).toHaveLength(1);
    expect(piCreated).toHaveLength(1);
    expect(lines.filter((l) => l === 'Loading claude-code runtime…')).toHaveLength(1);
    await handle.stop();
    await handle.done;
  });
});
