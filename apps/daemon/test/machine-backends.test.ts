import type { ClaimedStep, MachinePresenceResponse } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

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
    const { handle } = await boot({
      api,
      presenceIntervalMs: 20,
      devinManaged: {
        current: () =>
          installed
            ? { version: 'test', binPath: '/devin', args: ['acp'], home: '/devin-home' }
            : null,
        ensure: async () => {
          attempts += 1;
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          installed = true;
          return { version: 'test', binPath: '/devin', args: ['acp'], home: '/devin-home' };
        },
      },
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
    const { handle } = await boot({
      api,
      presenceIntervalMs: 20,
      devinManaged: {
        current: () =>
          installed
            ? { version: 'test', binPath: '/devin', args: ['acp'], home: '/devin-home' }
            : null,
        ensure: async () => {
          attempts += 1;
          installed = true;
          return { version: 'test', binPath: '/devin', args: ['acp'], home: '/devin-home' };
        },
      },
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
      devinManaged: {
        current: () => null,
        ensure: async () => {
          attempts += 1;
          return null;
        },
      },
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
        devinManaged: {
          current: () => null,
          ensure: async () => {
            attempts += 1;
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
            if (failure === 'rejected') throw new Error('download unavailable');
            return null;
          },
        },
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
    api.parked?.(CLAIMED);
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
    expect(msg).toContain('设置 → 模型服务');
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
    api.parked?.(CLAIMED);
    await waitFor(() => api.doneBodies.length === 2);
    expect(claudeCreated).toHaveLength(1);
    expect(piCreated).toHaveLength(1);
    expect(lines.filter((l) => l === 'Loading claude-code runtime…')).toHaveLength(1);
    await handle.stop();
    await handle.done;
  });
});
