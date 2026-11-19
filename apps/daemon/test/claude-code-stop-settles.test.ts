import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AgentSessionHandle, StepEvent } from '@cairn/shared';
import { afterEach, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { type ClaudeCodeBackendOpts, createClaudeCodeBackend } from '../src/backend/claude-code.js';

const FAKE = resolve(__dirname, 'fixtures/fake-claude-stop.mjs');

const dirs: string[] = [];
const spawned: number[] = [];

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
  delete process.env.FAKE_STOP_MODE;
  delete process.env.FAKE_STOP_PIDS;
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface Pids {
  cli: number;
  background: number;
}

interface Session {
  handle: AgentSessionHandle;
  events: StepEvent[];
  pids: Pids;
  drained: Promise<{ cliAlive: boolean; backgroundAlive: boolean }>;
}

async function startSession(
  mode: 'work' | 'stubborn' | 'finish',
  opts: Partial<ClaudeCodeBackendOpts> = {},
): Promise<Session> {
  const dir = makeTestTempDir('claude-stop-');
  dirs.push(dir);
  const pidFile = join(dir, 'pids.json');
  process.env.FAKE_STOP_MODE = mode;
  process.env.FAKE_STOP_PIDS = pidFile;
  const handle = await createClaudeCodeBackend({ executablePath: FAKE, ...opts }).createSession({
    provider: { kind: 'http', providerId: 'claude-code' },
    modelId: 'claude-sonnet-5-5',
    cwd: dir,
    prompt: 'start the dev server in the background',
  });
  const events: StepEvent[] = [];
  let pids: Pids | null = null;
  const drained = (async () => {
    for await (const event of handle.events) events.push(event);
    const seen = pids as Pids | null;
    return {
      cliAlive: seen !== null && alive(seen.cli),
      backgroundAlive: seen !== null && alive(seen.background),
    };
  })();
  const deadline = Date.now() + 15_000;
  while (!events.some((event) => event.type === 'bg_task') || !existsSync(pidFile)) {
    if (Date.now() > deadline) throw new Error('fake claude never started its background command');
    await new Promise((r) => setTimeout(r, 20));
  }
  pids = JSON.parse(readFileSync(pidFile, 'utf8')) as Pids;
  spawned.push(pids.background, pids.cli);
  return { handle, events, pids, drained };
}

test('stop returns only after the Claude Code process exited and its background command was killed', async () => {
  const session = await startSession('work');
  expect(alive(session.pids.background)).toBe(true);

  await session.handle.stop();

  expect(alive(session.pids.cli)).toBe(false);
  expect(alive(session.pids.background)).toBe(false);
  expect(await session.drained).toEqual({ cliAlive: false, backgroundAlive: false });
  expect(
    session.events.flatMap((event) => (event.type === 'bg_task' ? [event.task.status] : [])),
  ).toEqual(['running', 'stopped']);
}, 30_000);

test('a Claude Code process that ignores end of input and SIGTERM is killed, and stop still settles', async () => {
  const session = await startSession('stubborn', {
    settleTimeouts: { interruptMs: 200, exitGraceMs: 300, killGraceMs: 300 },
  });

  const started = Date.now();
  await session.handle.stop();

  expect(Date.now() - started).toBeLessThan(10_000);
  expect(alive(session.pids.cli)).toBe(false);
  expect(alive(session.pids.background)).toBe(false);
  expect(await session.drained).toEqual({ cliAlive: false, backgroundAlive: false });
}, 30_000);

test('a session that ends on its own reaps the background command Claude Code left behind before its events end', async () => {
  const session = await startSession('finish');

  expect(await session.drained).toEqual({ cliAlive: false, backgroundAlive: false });
  expect(session.events.some((event) => event.type === 'done')).toBe(true);
}, 30_000);
