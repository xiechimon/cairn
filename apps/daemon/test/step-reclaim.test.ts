// #1473 同一步在一台机器上只有一个 runStep（verify-step-claim F1 / P1 的
// daemon 半）。失败方式（先于实现固化）：
//   1. 重复领取：server 把本机在飞的步放回 pending 又发回本机，领取循环再起
//      一个 runStep——同一 worktree、同一分支两个会话，两次 done。
//   2. 准备期无心跳：心跳计时器在 workspace.prepare 之后才起，clone / 项目锁
//      / setup 期间 120s 无心跳，server 扫尾把在线机器上的步放回 pending。
//   3. 心跳泄漏：早退失败路径不清计时器，步结束后仍在给 server 发心跳。
//   4. 收尾期仍发心跳：上传 / 回报期间心跳应已停（会话结束即停的现行为）。

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  StepEvent,
  WorktreeOps,
} from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

function defer<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 门闩会话：事件流挂起直到 release，然后 done 收尾。 */
function gatedBackend(release: Promise<void>) {
  const probe = { createCalls: 0 };
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession() {
      probe.createCalls += 1;
      const handle: AgentSessionHandle = {
        sessionId: `pi-sess-${probe.createCalls}`,
        events: (async function* () {
          await release;
          yield { type: 'text_delta', text: 'working' } as StepEvent;
          yield { type: 'done', usage: [] } as StepEvent;
        })(),
        async steer() {},
        async stop() {},
        usage: () => [],
      };
      return handle;
    },
    async continueSession() {
      throw new Error('unused');
    },
  };
  return { backend, probe };
}

function heartbeats(api: FakeMachineApi): number {
  return api.calls.filter((c) => c === 'heartbeat:s1').length;
}

function silentLogger(): DaemonLogger {
  const noop = () => {};
  return {
    raw: noop,
    prefixed: noop,
    supervisor: noop,
    machine: noop,
    step: noop,
    workspace: noop,
    recover: noop,
    wake: noop,
    mcp: noop,
    skills: noop,
    gate: noop,
    trust: noop,
  };
}

function repoStep(): ClaimedStep {
  return {
    ...CLAIMED,
    step: { ...CLAIMED.step, kind: 'build' },
    project: {
      id: 'p1',
      name: 'demo',
      repo: { kind: 'hosted', cloneUrl: 'http://server/git/demo.git' },
    },
  };
}

/** prepare 挂起到 gate 再按 outcome 结束的工作区（其余原语不该被调用到）。 */
function gatedWorkspace(gate: Promise<void>): WorktreeOps {
  const unused = async (): Promise<never> => {
    throw new Error('unused');
  };
  return {
    async prepare() {
      await gate;
      throw new Error('setup failed');
    },
    commitAll: unused,
    push: unused,
    mergeDefaultBranch: unused,
    headCommit: unused,
    countAhead: unused,
    restoreCheckpoint: unused,
    cleanupOrphans: unused,
  };
}

function stepDeps(api: FakeMachineApi, extra: { workspace?: WorktreeOps; backend?: AgentBackend }) {
  const home = mkdtempSync(join(tmpdir(), 'pacman-reclaim-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const backend = extra.backend ?? gatedBackend(Promise.resolve()).backend;
  return {
    client: api,
    journal: new StepJournal(paths.outboxDir),
    backendFor: () => backend,
    logger: silentLogger(),
    paths,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 5,
    ...(extra.workspace !== undefined ? { workspace: extra.workspace } : {}),
  };
}

describe('#1473 同机同步只跑一份', () => {
  test('在飞步被再次发回本机：不起第二个会话，只有一次 done', async () => {
    const api = new FakeMachineApi();
    api.mePatch = { maxConcurrent: 1 };
    const release = defer();
    const { backend, probe } = gatedBackend(release.promise);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => probe.createCalls === 1);
    // server 扫尾放回 pending 后同机重领：同一步号再次发回。
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('already running here')));
    // 领取循环照常继续（下一条 claim 挂起），不被重领卡住。
    await waitFor(() => api.parked !== null);
    release.resolve();
    await waitFor(() => api.doneBodies.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(probe.createCalls).toBe(1);
    expect(api.doneBodies.map((d) => `${d.stepId}:${d.body.status}`)).toEqual(['s1:success']);
    await handle.stop();
    await handle.done;
  });

  test('准备工作区期间就有心跳；准备失败后心跳停止', async () => {
    const api = new FakeMachineApi();
    const gate = defer();
    const run = runStep(stepDeps(api, { workspace: gatedWorkspace(gate.promise) }), repoStep());
    await waitFor(() => heartbeats(api) >= 2);
    gate.resolve();
    await run;
    expect(api.doneBodies.map((d) => d.body.status)).toEqual(['failed']);
    expect(api.doneBodies[0]?.body.errorMessage).toBe('setup failed');
    const after = heartbeats(api);
    await new Promise((r) => setTimeout(r, 40));
    expect(heartbeats(api)).toBe(after);
  });

  test('会话结束后上传与回报期间不再发心跳', async () => {
    const reporting = defer();
    const report = defer();
    let heartbeatsAtReport = -1;
    class GatedDone extends FakeMachineApi {
      override async done(stepId: string, body: MachineDoneBody) {
        heartbeatsAtReport = heartbeats(this);
        reporting.resolve();
        await report.promise;
        await super.done(stepId, body);
      }
    }
    const api = new GatedDone();
    const release = defer();
    const { backend } = gatedBackend(release.promise);
    const run = runStep(stepDeps(api, { backend }), CLAIMED);
    await waitFor(() => heartbeats(api) >= 2);
    release.resolve();
    await reporting.promise;
    await new Promise((r) => setTimeout(r, 40));
    expect(heartbeats(api)).toBe(heartbeatsAtReport);
    report.resolve();
    await run;
    expect(api.doneBodies.map((d) => d.body.status)).toEqual(['success']);
    await new Promise((r) => setTimeout(r, 40));
    expect(heartbeats(api)).toBe(heartbeatsAtReport);
  });
});
