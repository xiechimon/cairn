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
} from '@cairn/shared';
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
  const home = mkdtempSync(join(tmpdir(), 'cairn-reclaim-'));
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

describe('#1473 only one copy of a step runs on the same machine', () => {
  test('an in-flight step dispatched back to the same machine: no second session, exactly one done', async () => {
    const api = new FakeMachineApi();
    api.mePatch = { maxConcurrent: 1 };
    const release = defer();
    const { backend, probe } = gatedBackend(release.promise);
    const { handle, lines } = await boot({ api, backend });
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => probe.createCalls === 1);
    await waitFor(() => api.parked !== null);
    api.parked?.(CLAIMED);
    await waitFor(() => lines.some((l) => l.includes('already running here')));
    await waitFor(() => api.parked !== null);
    release.resolve();
    await waitFor(() => api.doneBodies.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(probe.createCalls).toBe(1);
    expect(api.doneBodies.map((d) => `${d.stepId}:${d.body.status}`)).toEqual(['s1:success']);
    await handle.stop();
    await handle.done;
  });

  test('heartbeat runs during workspace preparation; stops after preparation failure', async () => {
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

  test('no heartbeat during upload and reporting after the session ends', async () => {
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
