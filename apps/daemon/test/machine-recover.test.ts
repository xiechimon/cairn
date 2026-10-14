// recover 对账（02 §5.4 步 journal 恢复）（#1128 自 machine-loop.test.ts 拆分；共享 harness 收编位
// = ./machine-loop-harness.ts，每个测试自 boot 自停）。

import type { AgentBackend, ClaimedStep, MachineDoneBody, StepEvent } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { SessionNotResumableError } from '../src/backend/errors.js';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import type { StepJournalEntry } from '../src/journal.js';
import { StepJournal } from '../src/journal.js';
import type { StatePaths } from '../src/state.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

describe('recover 对账（02 §5.4 步 journal 恢复）', () => {
  test('server 有 claimed 步而本地无 journal → done failed（journal lost）', async () => {
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

  // #1026：PUT 成功 / done 失败的残留（state=awaiting-upload + 终稿快照）→
  // recover 走快路径补报，不开新 agent 轮（对照：快照缺失仍走整步重跑）。
  /** s1 步 journal 预置（快路径两腿共用形状；patch 追加终稿快照与否分流）。 */
  function seedS1Journal(
    paths: StatePaths,
    patch: Partial<{
      state: StepJournalEntry['state'];
      planContent: string;
      doneBody: MachineDoneBody;
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

  test('awaiting-upload 残留含终稿快照 → recover 快路径补报（不开 agent 会话）', async () => {
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
    // 快路径行在位；agent 会话不开（无 new/continue session 行）。
    expect(lines.some((l) => l.includes('awaiting upload — replaying final report'))).toBe(true);
    expect(lines.some((l) => l.includes('new session conv-1'))).toBe(false);
    expect(lines.some((l) => l.includes('continue session conv-1'))).toBe(false);
    await handle.stop();
    await handle.done;
  });

  test('awaiting-upload 残留但终稿快照缺失（快照前崩溃）→ 整步重跑原路径', async () => {
    const api = new FakeMachineApi();
    api.recoverSteps = [
      { id: 's1', buildId: 'conv-1', kind: 'plan', machineId: 'm1', createdAt: 1 },
    ];
    const { handle, lines } = await boot({
      api,
      seedJournal: (paths) => seedS1Journal(paths, { state: 'awaiting-upload' }), // 无 doneBody/planContent
    });
    await waitFor(() => lines.some((l) => l.includes('continue session conv-1')));
    await handle.stop();
    await handle.done;
  });

  // 失败方式：换机 continue 的 journal 快照带 priorMachineId。崩溃 recover
  // 重拼 session 时若只留 action/sessionId，resumeMissNote 会写成
  // 「本机找不到会话」。注记应仍点名另一台机器。
  test('换机 continue 崩溃后续跑仍点名另一台机器', async () => {
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

  // 失败方式：换机 continue 降级后 journal.sessionId 已是本机新会话，
  // claim 上的 priorMachineId 仍指旧机器。再续这份本机会话失败时，
  // 注记应写「本机找不到会话」，不能再点名另一台机器。
  test('本机新会话再失败不再沿用旧机器号', async () => {
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
