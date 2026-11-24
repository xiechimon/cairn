import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import type { AgentBackend, AgentSessionHandle, StepEvent } from '@cairn/shared';
import { afterEach, describe, expect, onTestFinished, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { boot, CLAIMED, FakeMachineApi, waitFor } from './machine-loop-harness.js';

const STEP_TREE_ENV = 'CAIRN_STEP_TREE';

const ESCAPEES = `
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const outFile = process.argv[1];
const portFile = process.argv[2];
const spawnOpts = { detached: true, stdio: 'ignore', env: { ...process.env } };
const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], spawnOpts);
sleeper.unref();
const ignorer = spawn(
  process.execPath,
  ['-e', 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 600000)'],
  spawnOpts,
);
ignorer.unref();
const holder = spawn(
  process.execPath,
  [
    '-e',
    'const srv = require("node:net").createServer().listen(0, "127.0.0.1", () => require("node:fs").writeFileSync(process.argv[1], String(srv.address().port))); setTimeout(() => {}, 600000)',
    portFile,
  ],
  spawnOpts,
);
holder.unref();
writeFileSync(
  outFile,
  JSON.stringify({ sleeper: sleeper.pid, ignorer: ignorer.pid, holder: holder.pid }),
);
`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function connectable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(2_000, () => done(false));
  });
}

interface EscapeePids {
  sleeper: number;
  ignorer: number;
  holder: number;
}

function readPids(outFile: string): number[] {
  const rec = JSON.parse(readFileSync(outFile, 'utf8')) as EscapeePids;
  return [rec.sleeper, rec.ignorer, rec.holder];
}

function spawnSleep(): number {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid as number;
}

function escapeeBackend(
  outFile: string,
  portFile: string,
  events: StepEvent[] | 'open',
): AgentBackend {
  let releaseGate: () => void = () => {};
  const openGate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      spawn(process.execPath, ['-e', ESCAPEES, outFile, portFile], {
        env: { ...(opts.env ?? {}) },
        stdio: 'ignore',
      }).unref();
      const handle: AgentSessionHandle = {
        sessionId: 'escapee-sess',
        events: (async function* () {
          yield { type: 'text_delta', text: 'starting' } as StepEvent;
          const deadline = Date.now() + 5_000;
          while (!existsSync(outFile) || !existsSync(portFile)) {
            if (Date.now() > deadline) throw new Error('escapees did not start');
            await new Promise((r) => setTimeout(r, 10));
          }
          if (events === 'open') {
            await openGate;
          } else {
            for (const ev of events) yield ev;
          }
        })(),
        async steer() {},
        async stop() {
          releaseGate();
        },
        usage: () => [],
      };
      return handle;
    },
    async continueSession() {
      throw new Error('unused');
    },
  };
}

async function claimStep(api: FakeMachineApi) {
  await waitFor(() => api.parked !== null);
  api.parked?.(CLAIMED);
}

describe('step process reaping: nothing a step started survives the step', () => {
  const spawned: number[] = [];
  afterEach(() => {
    for (const pid of spawned.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  });

  test('finish: detached sleeper, setsid port-holder and TERM-ignorer die before the done report; unmarked sibling survives', async () => {
    const dir = makeTestTempDir('reap-finish-');
    const outFile = join(dir, 'escapees.json');
    const portFile = join(dir, 'port');
    onTestFinished(() => {
      releaseTestTempDir(dir);
    });
    const sibling = spawnSleep();
    spawned.push(sibling);
    const api = new FakeMachineApi();
    const backend = escapeeBackend(outFile, portFile, [{ type: 'done', usage: [] } as StepEvent]);
    await boot({ api, backend });
    await claimStep(api);
    await waitFor(() => existsSync(outFile));
    const pids = readPids(outFile);
    spawned.push(...pids);
    await waitFor(() => api.doneBodies.length === 1, 8_000);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    await waitFor(() => pids.every((pid) => !alive(pid)), 6_000);
    const port = Number(readFileSync(portFile, 'utf8'));
    expect(await connectable(port)).toBe(false);
    expect(alive(sibling)).toBe(true);
  });

  test('stop: accepted stop reaps the step tree before the stopped report', async () => {
    const dir = makeTestTempDir('reap-stop-');
    const outFile = join(dir, 'escapees.json');
    const portFile = join(dir, 'port');
    onTestFinished(() => {
      releaseTestTempDir(dir);
    });
    const api = new FakeMachineApi();
    api.stopResponse = true;
    const backend = escapeeBackend(outFile, portFile, 'open');
    await boot({ api, backend });
    await claimStep(api);
    await waitFor(() => existsSync(outFile));
    const pids = readPids(outFile);
    spawned.push(...pids);
    api.onStreamEvent?.({ type: 'stop', stepId: 's1' });
    await waitFor(() => api.doneBodies.length === 1, 8_000);
    expect(api.doneBodies[0]?.body.status).toBe('stopped');
    await waitFor(() => pids.every((pid) => !alive(pid)), 6_000);
  });

  test('agent crash: failed report only lands after the step tree is dead', async () => {
    const dir = makeTestTempDir('reap-crash-');
    const outFile = join(dir, 'escapees.json');
    const portFile = join(dir, 'port');
    onTestFinished(() => {
      releaseTestTempDir(dir);
    });
    const api = new FakeMachineApi();
    const backend = escapeeBackend(outFile, portFile, [
      {
        type: 'error',
        error: { message: 'agent process crashed', retryable: false },
      } as StepEvent,
    ]);
    await boot({ api, backend });
    await claimStep(api);
    await waitFor(() => existsSync(outFile));
    const pids = readPids(outFile);
    spawned.push(...pids);
    await waitFor(() => api.doneBodies.length === 1, 8_000);
    expect(api.doneBodies[0]?.body.status).toBe('failed');
    await waitFor(() => pids.every((pid) => !alive(pid)), 6_000);
  });

  test('daemon restart: a stale marker from the previous run is reaped during boot', async () => {
    const marker = `stale-${randomUUID()}`;
    const stale = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, [STEP_TREE_ENV]: marker },
    });
    stale.unref();
    const stalePid = stale.pid as number;
    spawned.push(stalePid);
    await boot({
      api: new FakeMachineApi(),
      seedJournal: (paths) => {
        mkdirSync(paths.outboxDir, { recursive: true });
        writeFileSync(
          join(paths.outboxDir, 'step-s-old.json'),
          `${JSON.stringify({
            stepId: 's-old',
            buildId: 'b-old',
            kind: 'build',
            conversationId: 'conv-old',
            state: 'claimed',
            sessionAction: 'new',
            sessionId: null,
            prompt: null,
            claimed: null,
            treeMarker: marker,
            claimedAt: 1,
            updatedAt: 1,
          })}\n`,
        );
      },
    });
    await waitFor(() => !alive(stalePid), 6_000);
  });
});
