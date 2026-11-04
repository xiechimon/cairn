import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  COMPUTER_FRAME_TEXT_MAX_CHARS,
  COMPUTER_FRAMES_PER_POST_MAX,
  type ComputerCall,
  type ComputerFrame,
  type MachineComputerFramesBody,
  type MachineComputerFramesResponse,
} from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  COMPUTER_COMMAND_TIMEOUT_MS,
  createComputerDispatcher,
  NO_COMPUTER_PROVIDER_MESSAGE,
} from '../src/computer/dispatch.js';
import { OUTPUT_TRUNCATED_MARKER } from '../src/computer/frame-poster.js';
import { HostComputerProvider } from '../src/computer/host.js';
import type { ComputerProvider } from '../src/computer/provider.js';
import { MachineApiError } from '../src/machine-client.js';

type Post = { callId: string; frames: ComputerFrame[] };
type Handler = (
  post: Post,
  attempt: number,
) => MachineComputerFramesResponse | Promise<MachineComputerFramesResponse>;

let root: string;
let home: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'cairn-dispatch-')));
  home = path.join(root, 'home');
  mkdirSync(home);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fakeClient(handler?: Handler) {
  const posts: Post[] = [];
  let attempts = 0;
  return {
    posts,
    get attempts() {
      return attempts;
    },
    client: {
      async computerFrames(callId: string, body: MachineComputerFramesBody) {
        attempts += 1;
        const post = { callId, frames: body.frames };
        const response = await (handler?.(post, attempts) ?? {
          ok: true as const,
          cancelled: false,
        });
        posts.push(post);
        return response;
      },
    },
    get frames() {
      return posts.flatMap((post) => post.frames);
    },
  };
}

function call(
  overrides: Partial<ComputerCall> & { command?: string; cwd?: string } = {},
): ComputerCall {
  const { command, cwd, ...rest } = overrides;
  return {
    callId: 'a'.repeat(64),
    stepId: 'step-1',
    tool: 'user_computer_shell',
    params: { command: command ?? 'echo hi', ...(cwd !== undefined ? { cwd } : {}) },
    deadlineAt: Date.now() + 60_000,
    ...rest,
  };
}

function host() {
  return new HostComputerProvider({
    home,
    env: { PATH: process.env.PATH, HOME: home },
    killGraceMs: 200,
  });
}

function countingProvider(): ComputerProvider & { executed: Array<{ timeoutMs: number }> } {
  const executed: Array<{ timeoutMs: number }> = [];
  return {
    executed,
    async execute(request) {
      executed.push({ timeoutMs: request.timeoutMs });
      return (async function* () {
        yield { kind: 'stdout' as const, text: 'ok\n' };
        yield { kind: 'exit' as const, code: 0 };
      })();
    },
    async listFiles() {
      return [];
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async killAll() {},
  };
}

const FAST = { flushMs: 20, heartbeatMs: 5_000, retryBaseMs: 5, retryMaxMs: 20 };

function expectContiguous(frames: ComputerFrame[]) {
  expect(frames.map((f) => f.seq)).toEqual(frames.map((_, i) => i + 1));
}

function textOf(frames: ComputerFrame[], stream?: 'stdout' | 'stderr'): string {
  return frames
    .flatMap((f) => (f.kind === 'output' && (!stream || f.stream === stream) ? [f.text] : []))
    .join('');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)])
      .toString()
      .startsWith('Z');
  } catch {
    return false;
  }
}

async function expectGone(pids: number[]) {
  const deadline = Date.now() + 1_000;
  while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  expect(pids.filter(alive)).toEqual([]);
}

function script(name: string, body: string): string {
  writeFileSync(path.join(home, name), body);
  return `bash ${name}`;
}

const pidsIn = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(Number);

describe('computer dispatcher: refusals post one not-delivered error and run nothing', () => {
  test('a machine that did not opt in has no provider', async () => {
    const api = fakeClient();
    await createComputerDispatcher({ client: api.client, ...FAST }).dispatch(call());
    expect(api.frames).toEqual([
      { kind: 'error', seq: 1, message: NO_COMPUTER_PROVIDER_MESSAGE, delivery: 'not_delivered' },
    ]);
  });

  test.each([
    'list_files',
    'read_file',
    'write_file',
    'shell',
    'computer_act',
    'user_computer_act',
  ] as const)('the host does not serve %s', async (tool) => {
    const api = fakeClient();
    const provider = countingProvider();
    await createComputerDispatcher({ client: api.client, host: provider, ...FAST }).dispatch(
      call({ tool }),
    );
    expect(provider.executed).toEqual([]);
    expect(api.frames).toEqual([
      { kind: 'error', seq: 1, message: NO_COMPUTER_PROVIDER_MESSAGE, delivery: 'not_delivered' },
    ]);
  });

  test('a deadline that already passed is refused', async () => {
    const api = fakeClient();
    const provider = countingProvider();
    await createComputerDispatcher({ client: api.client, host: provider, ...FAST }).dispatch(
      call({ deadlineAt: Date.now() - 1 }),
    );
    expect(provider.executed).toEqual([]);
    expect(api.frames).toHaveLength(1);
    expect(api.frames[0]).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
  });

  test('a call with less time left than the minimum command timeout is refused', async () => {
    const api = fakeClient();
    const provider = countingProvider();
    await createComputerDispatcher({ client: api.client, host: provider, ...FAST }).dispatch(
      call({ deadlineAt: Date.now() + 3_000 }),
    );
    expect(provider.executed).toEqual([]);
    expect(api.frames).toHaveLength(1);
    expect(api.frames[0]).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
  });

  test('a frame post that never settles is abandoned at the call deadline', async () => {
    const stalled = {
      computerFrames: () => new Promise<never>(() => {}),
    };
    const started = Date.now();
    await createComputerDispatcher({
      client: stalled,
      host: countingProvider(),
      ...FAST,
    }).dispatch(call({ deadlineAt: Date.now() + 1_500 }));
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  test('invalid params are refused', async () => {
    const api = fakeClient();
    const provider = countingProvider();
    await createComputerDispatcher({ client: api.client, host: provider, ...FAST }).dispatch(
      call({ params: { command: '' } }),
    );
    expect(provider.executed).toEqual([]);
    expect(api.frames[0]).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
  });

  test.each([
    'systemctl --user stop cairn-daemon',
    'pkill -f cairn',
    'machinectl poweroff cairn-orb-x',
  ])('the guard refuses %j and says why', async (command) => {
    const api = fakeClient();
    const provider = countingProvider();
    await createComputerDispatcher({ client: api.client, host: provider, ...FAST }).dispatch(
      call({ command }),
    );
    expect(provider.executed).toEqual([]);
    expect(api.frames).toHaveLength(1);
    expect(api.frames[0]).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    expect((api.frames[0] as { message: string }).message).toContain('This command was not run');
  });

  test('a cwd outside home is refused before anything runs', async () => {
    const api = fakeClient();
    await createComputerDispatcher({ client: api.client, host: host(), ...FAST }).dispatch(
      call({ command: `touch ${path.join(root, 'escaped')}`, cwd: '..' }),
    );
    expect(api.frames).toHaveLength(1);
    expect(api.frames[0]).toMatchObject({ kind: 'error', delivery: 'not_delivered' });
    expect((api.frames[0] as { message: string }).message).toContain('inside the home folder');
    expect(() => readFileSync(path.join(root, 'escaped'))).toThrow();
  });
});

describe('computer dispatcher: running a command', () => {
  test('streams output and ends with done carrying the exit code', async () => {
    const api = fakeClient();
    await createComputerDispatcher({ client: api.client, host: host(), ...FAST }).dispatch(
      call({ command: 'echo out; echo err >&2; exit 3' }),
    );
    expectContiguous(api.frames);
    expect(textOf(api.frames, 'stdout')).toBe('out\n');
    expect(textOf(api.frames, 'stderr')).toBe('err\n');
    expect(api.frames.at(-1)).toMatchObject({ kind: 'done', text: 'exit code: 3', exitCode: 3 });
  });

  test('the command timeout is the default, capped by the remaining deadline', async () => {
    const api = fakeClient();
    const provider = countingProvider();
    const dispatcher = createComputerDispatcher({ client: api.client, host: provider, ...FAST });
    await dispatcher.dispatch(call({ callId: '1'.repeat(64), deadlineAt: Date.now() + 3_600_000 }));
    await dispatcher.dispatch(call({ callId: '2'.repeat(64), deadlineAt: Date.now() + 20_000 }));
    expect(provider.executed[0]?.timeoutMs).toBe(COMPUTER_COMMAND_TIMEOUT_MS);
    const capped = provider.executed[1]?.timeoutMs ?? 0;
    expect(capped).toBeLessThanOrEqual(20_000);
    expect(capped).toBeGreaterThan(10_000);
  });

  test('secret-looking output is forwarded as is and never logged by the daemon', async () => {
    const api = fakeClient();
    const lines: string[] = [];
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    await createComputerDispatcher({
      client: api.client,
      host: host(),
      logger: { machine: (line: string) => void lines.push(line) },
      ...FAST,
    }).dispatch(call({ command: `echo ${secret}` }));
    expect(textOf(api.frames)).toBe(`${secret}\n`);
    expect(lines.join('\n')).not.toContain(secret);
    expect(lines.join('\n')).not.toContain('echo');
  });

  test('a duplicate event for a call in flight, or already finished, runs once', async () => {
    const api = fakeClient();
    const provider = countingProvider();
    const dispatcher = createComputerDispatcher({ client: api.client, host: provider, ...FAST });
    const same = call();
    await Promise.all([
      dispatcher.dispatch(same),
      dispatcher.dispatch(same),
      dispatcher.dispatch(same),
    ]);
    await dispatcher.dispatch(same);
    expect(provider.executed).toHaveLength(1);
    expect(api.frames.filter((f) => f.kind === 'done')).toHaveLength(1);
    expectContiguous(api.frames);
  });

  test('sends heartbeat frames while the command is silent', async () => {
    const api = fakeClient();
    await createComputerDispatcher({
      client: api.client,
      host: host(),
      ...FAST,
      heartbeatMs: 150,
    }).dispatch(call({ command: 'sleep 1' }));
    expectContiguous(api.frames);
    expect(api.frames.filter((f) => f.kind === 'heartbeat').length).toBeGreaterThanOrEqual(2);
    expect(api.frames.at(-1)?.kind).toBe('done');
  });
});

describe('computer dispatcher: runaway commands', () => {
  test('runaway output is bounded, truncated once, and the process killed at the timeout', async () => {
    const api = fakeClient();
    const cap = 300_000;
    const started = Date.now();
    await createComputerDispatcher({
      client: api.client,
      host: host(),
      ...FAST,
      outputCapChars: cap,
      commandTimeoutMs: 1_500,
    }).dispatch(call({ command: 'yes' }));
    expect(Date.now() - started).toBeLessThan(6_000);
    expectContiguous(api.frames);
    for (const post of api.posts)
      expect(post.frames.length).toBeLessThanOrEqual(COMPUTER_FRAMES_PER_POST_MAX);
    for (const frame of api.frames) {
      if (frame.kind === 'output')
        expect(frame.text.length).toBeLessThanOrEqual(COMPUTER_FRAME_TEXT_MAX_CHARS);
    }
    const all = textOf(api.frames);
    expect(all.length).toBeLessThanOrEqual(cap + OUTPUT_TRUNCATED_MARKER.length);
    expect(all.split(OUTPUT_TRUNCATED_MARKER)).toHaveLength(2);
    const last = api.frames.at(-1);
    expect(last).toMatchObject({ kind: 'error', delivery: 'unknown' });
    expect((last as { message: string }).message).toContain('timed out');
  });

  test('sleeping past the timeout kills the whole tree and reports the timeout', async () => {
    const api = fakeClient();
    const pidFile = path.join(home, 'pids');
    await createComputerDispatcher({
      client: api.client,
      host: host(),
      ...FAST,
      commandTimeoutMs: 600,
    }).dispatch(
      call({
        command: script(
          'tree.sh',
          `sleep 60 & echo $! >> ${pidFile}\n(sleep 60 & echo $! >> ${pidFile})\nsleep 60\n`,
        ),
      }),
    );
    expect(api.frames.at(-1)).toMatchObject({ kind: 'error', delivery: 'unknown' });
    expect((api.frames.at(-1) as { message: string }).message).toContain('timed out after 600 ms');
    await expectGone(pidsIn(pidFile));
  });

  test('a nested tree of 20 sleepers dies with its call', async () => {
    const api = fakeClient();
    const pidFile = path.join(home, 'pids');
    const nested = [
      `spawn() { if [ "$1" -gt 0 ]; then ( sleep 60 & echo $! >> ${pidFile}; spawn $(($1 - 1)) ) & fi; }`,
      'spawn 20',
      'sleep 60',
    ].join('\n');
    await createComputerDispatcher({
      client: api.client,
      host: host(),
      ...FAST,
      commandTimeoutMs: 800,
    }).dispatch(call({ command: script('nested.sh', nested) }));
    const pids = pidsIn(pidFile);
    expect(pids).toHaveLength(20);
    await expectGone(pids);
  });
});

describe('computer dispatcher: cancel, retry and shutdown', () => {
  test('a cancelled response kills the process and posts one final frame, then nothing more', async () => {
    const pidFile = path.join(home, 'pids');
    const api = fakeClient((post) => ({
      ok: true,
      cancelled: post.frames.some((f) => f.kind === 'output'),
    }));
    const started = Date.now();
    await createComputerDispatcher({ client: api.client, host: host(), ...FAST }).dispatch(
      call({
        command: script('started.sh', `sleep 60 & echo $! >> ${pidFile}\necho started\nsleep 60\n`),
      }),
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expectContiguous(api.frames);
    expect(api.frames.at(-1)).toMatchObject({ kind: 'error', delivery: 'unknown' });
    expect((api.frames.at(-1) as { message: string }).message).toContain('cancelled');
    const postsAtEnd = api.posts.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(api.posts.length).toBe(postsAtEnd);
    await expectGone(pidsIn(pidFile));
  });

  test('a failed POST is retried with the same sequence numbers and leaves no gap', async () => {
    const attemptedSeqs: number[][] = [];
    const api = fakeClient((post, attempt) => {
      attemptedSeqs.push(post.frames.map((f) => f.seq));
      if (attempt <= 3) throw new Error('network down');
      return { ok: true, cancelled: false };
    });
    await createComputerDispatcher({ client: api.client, host: host(), ...FAST }).dispatch(
      call({ command: 'echo one; sleep 0.3; echo two' }),
    );
    expect(attemptedSeqs.slice(0, 4).every((seqs) => seqs[0] === 1)).toBe(true);
    expectContiguous(api.frames);
    expect(textOf(api.frames)).toBe('one\ntwo\n');
    expect(api.frames.at(-1)?.kind).toBe('done');
  });

  test('a terminal rejection stops the call and kills the process', async () => {
    const pidFile = path.join(home, 'pids');
    const api = fakeClient(() => {
      throw new MachineApiError(409, 'computer call already error');
    });
    await createComputerDispatcher({ client: api.client, host: host(), ...FAST }).dispatch(
      call({
        command: script('started.sh', `sleep 60 & echo $! >> ${pidFile}\necho started\nsleep 60\n`),
      }),
    );
    expect(api.attempts).toBeLessThan(10);
    await expectGone(pidsIn(pidFile));
  });

  test('retries stop at the call deadline', async () => {
    const api = fakeClient(() => {
      throw new Error('network down');
    });
    const started = Date.now();
    await createComputerDispatcher({
      client: api.client,
      host: countingProvider(),
      ...FAST,
    }).dispatch(call({ deadlineAt: Date.now() + 400 }));
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  test('close kills in-flight commands and reports the shutdown', async () => {
    const api = fakeClient();
    const pidFile = path.join(home, 'pids');
    const dispatcher = createComputerDispatcher({ client: api.client, host: host(), ...FAST });
    const running = dispatcher.dispatch(
      call({ command: script('hang.sh', `sleep 60 & echo $! >> ${pidFile}\nsleep 60\n`) }),
    );
    await new Promise((r) => setTimeout(r, 500));
    await dispatcher.close();
    await running;
    expect(api.frames.at(-1)).toMatchObject({ kind: 'error', delivery: 'unknown' });
    expect((api.frames.at(-1) as { message: string }).message).toContain('shut down');
    await expectGone(pidsIn(pidFile));
  });
});
