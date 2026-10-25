import type { AgentBackend, ClaimedStep, MachineDoneBody, StepEvent } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { SessionNotResumableError } from '../src/backend/errors.js';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import type { StepJournalEntry } from '../src/journal.js';
import { StepJournal } from '../src/journal.js';
import type { StatePaths } from '../src/state.js';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';

describe('recover reconciliation (02 §5.4 step journal recovery)', () => {
  test('server has a claimed step but no local journal → done failed (journal lost)', async () => {
    const api = new FakeMachineApi();
    api.recoverSteps = [{ id: 'ghost', buildId: 'b', kind: 'plan', machineId: 'm1', createdAt: 1 }];
    const { handle, lines } = await boot({ api });
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]).toMatchObject({
      stepId: 'ghost',
      body: { status: 'failed', errorMessage: 'daemon journal lost across restart' },
    });
    expect(lines.some((l) => l.includes('[recover] 1 pending step(s) found'))).toBe(true);
    await handle.stop();
    await handle.done;
  });

  function seedS1Journal(
    paths: StatePaths,
    patch: Partial<{
      state: StepJournalEntry['state'];
      planContent: string;
      doneBody: MachineDoneBody;
      stopRequest: { discard: boolean };
    }>,
  ): void {
    const journal = new StepJournal(paths.outboxDir);
    journal.claim({
      stepId: 's1',
      buildId: 'conv-1',
      kind: 'plan',
      conversationId: 'conv-1',
      sessionAction: 'new',
      sessionId: 'pi-sess-1',
      prompt: '写方案',
      claimed: CLAIMED,
    });
    journal.update('s1', patch);
  }

  test('awaiting-upload residue with a final-draft snapshot → recover fast-path reports it (no agent session opened)', async () => {
    const api = new FakeMachineApi();
    api.recoverSteps = [
      { id: 's1', buildId: 'conv-1', kind: 'plan', machineId: 'm1', createdAt: 1 },
    ];
    const { handle, lines } = await boot({
      api,
      seedJournal: (paths) =>
        seedS1Journal(paths, {
          state: 'awaiting-upload',
          planContent: '# 方案',
          doneBody: { status: 'success', sessionId: 'pi-sess-1' },
        }),
    });
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]).toMatchObject({
      stepId: 's1',
      body: { status: 'success', sessionId: 'pi-sess-1' },
    });
    expect(lines.some((l) => l.includes('awaiting upload — replaying final report'))).toBe(true);
    expect(lines.some((l) => l.includes('new session conv-1'))).toBe(false);
    expect(lines.some((l) => l.includes('continue session conv-1'))).toBe(false);
    await handle.stop();
    await handle.done;
  });

  test('stop received before restart, session never finished → recover reports stopped, no session opened', async () => {
    const api = new FakeMachineApi();
    api.recoverSteps = [
      { id: 's1', buildId: 'conv-1', kind: 'plan', machineId: 'm1', createdAt: 1 },
    ];
    const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
    const { handle, paths } = await boot({
      api,
      backend,
      seedJournal: (paths) =>
        seedS1Journal(paths, { state: 'running', stopRequest: { discard: true } }),
    });
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]).toMatchObject({
      stepId: 's1',
      body: { status: 'stopped', sessionId: 'pi-sess-1' },
    });
    expect(created).toHaveLength(0);
    expect(new StepJournal(paths.outboxDir).get('s1')).toBeNull();
    await handle.stop();
    await handle.done;
  });

  test('stop received before restart, session finished awaiting report → original result reported (completion first)', async () => {
    const api = new FakeMachineApi();
    api.recoverSteps = [
      { id: 's1', buildId: 'conv-1', kind: 'plan', machineId: 'm1', createdAt: 1 },
    ];
    const { handle } = await boot({
      api,
      seedJournal: (paths) =>
        seedS1Journal(paths, {
          state: 'awaiting-upload',
          planContent: '# 方案',
          doneBody: { status: 'success', sessionId: 'pi-sess-1' },
          stopRequest: { discard: true },
        }),
    });
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    await handle.stop();
    await handle.done;
  });

  test('awaiting-upload residue but final-draft snapshot missing (crashed before snapshot) → whole step reruns the original path', async () => {
    const api = new FakeMachineApi();
    api.recoverSteps = [
      { id: 's1', buildId: 'conv-1', kind: 'plan', machineId: 'm1', createdAt: 1 },
    ];
    const { handle, lines } = await boot({
      api,
      seedJournal: (paths) => seedS1Journal(paths, { state: 'awaiting-upload' }),
    });
    await waitFor(() => lines.some((l) => l.includes('continue session conv-1')));
    await handle.stop();
    await handle.done;
  });

  test('continue on another machine crashed and resumed still names the other machine', async () => {
    const api = new FakeMachineApi();
    api.recoverSteps = [
      { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    ];
    const claimed: ClaimedStep = {
      ...CLAIMED,
      step: { ...CLAIMED.step, kind: 'build' },
      session: {
        action: 'continue',
        sessionId: 'sess-cross',
        priorMachineId: 'other-box',
      },
    };
    const done: StepEvent = { type: 'done', usage: [] };
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        return {
          sessionId: 'fresh-1',
          events: (async function* () {
            yield done;
          })(),
          async steer() {},
          async stop() {},
          usage: () => [],
        };
      },
      async continueSession() {
        throw new SessionNotResumableError('sess-cross');
      },
    };
    const { handle } = await boot({
      api,
      backend,
      seedJournal: (paths) => {
        const journal = new StepJournal(paths.outboxDir);
        journal.claim({
          stepId: 's1',
          buildId: 'conv-1',
          kind: 'build',
          conversationId: 'conv-1',
          sessionAction: 'continue',
          sessionId: 'sess-cross',
          prompt: '方案已确认。请按方案执行，完成改动。',
          claimed,
        });
      },
    });
    await waitFor(() => api.uploads.length === 1);
    const note = api.uploads[0]?.body.messages.find((message) => message.role === 'system');
    expect(String(note?.content)).toContain('另一台机器');
    expect(String(note?.content)).not.toContain('本机找不到会话');
    await handle.stop();
    await handle.done;
  });

  test('a fresh local session that fails again does not reuse the old machine number', async () => {
    const api = new FakeMachineApi();
    api.recoverSteps = [
      { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    ];
    const claimed: ClaimedStep = {
      ...CLAIMED,
      step: { ...CLAIMED.step, kind: 'build' },
      session: {
        action: 'continue',
        sessionId: 'sess-cross',
        priorMachineId: 'other-box',
      },
    };
    const done: StepEvent = { type: 'done', usage: [] };
    const backend: AgentBackend = {
      capabilities: PI_CAPABILITIES,
      async createSession() {
        return {
          sessionId: 'fresh-2',
          events: (async function* () {
            yield done;
          })(),
          async steer() {},
          async stop() {},
          usage: () => [],
        };
      },
      async continueSession() {
        throw new SessionNotResumableError('local-1');
      },
    };
    const { handle } = await boot({
      api,
      backend,
      seedJournal: (paths) => {
        const journal = new StepJournal(paths.outboxDir);
        journal.claim({
          stepId: 's1',
          buildId: 'conv-1',
          kind: 'build',
          conversationId: 'conv-1',
          sessionAction: 'continue',
          sessionId: 'local-1',
          prompt: '方案已确认。请按方案执行，完成改动。',
          claimed,
        });
      },
    });
    await waitFor(() => api.uploads.length === 1);
    const note = api.uploads[0]?.body.messages.find((message) => message.role === 'system');
    expect(String(note?.content)).toContain('本机找不到会话 local-1');
    expect(String(note?.content)).not.toContain('另一台机器');
    await handle.stop();
    await handle.done;
  });
});
