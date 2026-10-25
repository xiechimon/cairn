import type { ClaimedStep } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

describe('per-step backend resolution (spec 17 A3: backendFor is the only branch point)', () => {
  function claudeClaimed(): ClaimedStep {
    return { ...CLAIMED, agent: { ...CLAIMED.agent!, provider: 'claude-code' } };
  }

  test('failure mode 1: claude-code step → executed by the claude backend, zero pi sessions + exactly one lazy line', async () => {
    const api = new FakeMachineApi();
    const { backend: pi, created: piCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { backend: claude, created: claudeCreated } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle, lines } = await boot({ api, backend: pi, claudeCodeBackend: claude });
    await waitFor(() => api.parked !== null);
    api.parked?.(claudeClaimed());
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    expect(claudeCreated).toHaveLength(1);
    expect(piCreated).toHaveLength(0);
    expect(lines[0]).toBe('Loading pi runtime…');
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

  test('failure mode 4: runtime step + no local claude credentials → fails before the step, wording names the local machine (#867 T6)', async () => {
    const api = new FakeMachineApi();
    const { backend: pi, created: piCreated } = fakeBackend([]);
    const { backend: claude, created: claudeCreated } = fakeBackend([]);
    const { handle, lines } = await boot({
      api,
      backend: pi,
      claudeCodeBackend: claude,
      claudeCodeAuthProbe: async () => ({ state: 'not-logged-in', provider: 'firstParty' }),
    });
    await waitFor(() => api.parked !== null);
    api.parked?.(claudeClaimed());
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('failed');
    const msg = api.doneBodies[0]?.body.errorMessage ?? '';
    expect(msg).toContain('test-mbp');
    expect(msg).toContain('ANTHROPIC_API_KEY');
    expect(claudeCreated).toHaveLength(0);
    expect(piCreated).toHaveLength(0);
    expect(lines.some((l) => l === 'Loading claude-code runtime…')).toBe(false);
    await handle.stop();
    await handle.done;
  });

  test('failure mode 3: mixed step flow (claude step + pi step) → each to its own backend, still exactly one lazy line', async () => {
    const api = new FakeMachineApi();
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
