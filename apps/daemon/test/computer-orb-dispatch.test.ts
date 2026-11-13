import type {
  ComputerCall,
  ComputerFrame,
  ComputerTool,
  MachineComputerFramesBody,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  createComputerDispatcher,
  NO_COMPUTER_PROVIDER_MESSAGE,
  NO_COMPUTER_SCOPE_MESSAGE,
} from '../src/computer/dispatch.js';
import {
  orbComputerProtectionRefusal,
  protectedComputerLifecycleRefusal,
} from '../src/computer/guard.js';
import type { ComputerProvider, ScopedComputerProviders } from '../src/computer/provider.js';

const FAST = { flushMs: 20, heartbeatMs: 5_000, retryBaseMs: 5, retryMaxMs: 20 };

function fakeClient() {
  const frames: ComputerFrame[] = [];
  return {
    frames,
    client: {
      async computerFrames(_callId: string, body: MachineComputerFramesBody) {
        frames.push(...body.frames);
        return { ok: true as const, cancelled: false };
      },
    },
  };
}

const timeouts: number[] = [];

function fakeProvider(log: string[], label: string, hold?: Promise<void>): ComputerProvider {
  return {
    async execute(request) {
      log.push(`${label}:execute:${request.argv.at(-1)}`);
      await hold;
      return (async function* () {
        yield { kind: 'exit' as const, code: 0 };
      })();
    },
    async listFiles(path) {
      log.push(`${label}:list:${path}`);
      return [{ path: 'a', kind: 'file' as const, size: 1 }];
    },
    async readFile(path, options) {
      log.push(`${label}:read:${path}`);
      if (options?.timeoutMs !== undefined) timeouts.push(options.timeoutMs);
      await hold;
      return 'content';
    },
    async writeFile(path) {
      log.push(`${label}:write:${path}`);
    },
    async killAll() {},
  };
}

function fakeOrb(log: string[], hold?: Promise<void>): ScopedComputerProviders {
  return {
    forScope: (scopeKey) => fakeProvider(log, `orb[${scopeKey}]`, hold),
    async killAll() {
      log.push('orb:killAll');
    },
  };
}

let counter = 0;
function call(
  tool: ComputerTool,
  params: Record<string, unknown>,
  extra: Partial<ComputerCall> = {},
) {
  counter += 1;
  return {
    callId: counter.toString(16).padStart(64, '0'),
    stepId: 'step-1',
    tool,
    params,
    deadlineAt: Date.now() + 60_000,
    ...extra,
  } satisfies ComputerCall;
}

function errorOf(frames: ComputerFrame[]) {
  return frames.find((frame) => frame.kind === 'error');
}

describe('orb routing', () => {
  test.each([
    ['shell', { command: 'ls' }],
    ['list_files', {}],
    ['read_file', { path: 'a' }],
    ['write_file', { path: 'a', content: 'b' }],
  ] as const)(
    '%s with a scope on a daemon without an Orb provider says there is no computer provider',
    async (tool, params) => {
      const fake = fakeClient();
      const dispatcher = createComputerDispatcher({ client: fake.client, ...FAST });
      await dispatcher.dispatch(call(tool, params, { scopeKey: 'chief:c1' }));
      expect(errorOf(fake.frames)).toMatchObject({
        message: NO_COMPUTER_PROVIDER_MESSAGE,
        delivery: 'not_delivered',
      });
    },
  );

  test('an Orb tool without a scope is refused and never reaches a provider', async () => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: fakeOrb(log),
      host: fakeProvider(log, 'host'),
      ...FAST,
    });
    await dispatcher.dispatch(call('shell', { command: 'ls' }));
    expect(errorOf(fake.frames)).toMatchObject({
      message: NO_COMPUTER_SCOPE_MESSAGE,
      delivery: 'not_delivered',
    });
    expect(log).toEqual([]);
  });

  test('scoped tools go to their scope and user_computer_shell stays on the host', async () => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: fakeOrb(log),
      host: fakeProvider(log, 'host'),
      ...FAST,
    });
    await dispatcher.dispatch(call('shell', { command: 'ls' }, { scopeKey: 'chief:c1' }));
    await dispatcher.dispatch(call('read_file', { path: 'a' }, { scopeKey: 'chief:c2' }));
    await dispatcher.dispatch(
      call('user_computer_shell', { command: 'pwd' }, { scopeKey: 'chief:c1' }),
    );
    expect(log).toEqual(['orb[chief:c1]:execute:ls', 'orb[chief:c2]:read:a', 'host:execute:pwd']);
  });

  test('screen tools are still refused even with an Orb provider', async () => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: fakeOrb(log),
      ...FAST,
    });
    await dispatcher.dispatch(call('computer_act', {}, { scopeKey: 'chief:c1' }));
    expect(errorOf(fake.frames)).toMatchObject({ message: NO_COMPUTER_PROVIDER_MESSAGE });
    expect(log).toEqual([]);
  });

  test('browser_navigate runs agent-browser open on the Orb provider', async () => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: fakeOrb(log),
      ...FAST,
    });
    await dispatcher.dispatch(
      call('browser_navigate', { url: 'https://example.com' }, { scopeKey: 'chief:c1' }),
    );
    expect(errorOf(fake.frames)).toBeUndefined();
    expect(log.some((line) => line.includes('orb[chief:c1]:execute:https://example.com'))).toBe(
      true,
    );
    expect(fake.frames.some((frame) => frame.kind === 'done')).toBe(true);
  });

  test('browser_snapshot truncates oversized done text', async () => {
    const fake = fakeClient();
    const huge = 'x'.repeat(70_000);
    const provider: ComputerProvider = {
      async execute(request) {
        expect(request.env).toBeUndefined();
        return (async function* () {
          yield { kind: 'stdout' as const, text: huge };
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
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: { forScope: () => provider, async killAll() {} },
      ...FAST,
    });
    await dispatcher.dispatch(call('browser_snapshot', {}, { scopeKey: 'chief:c1' }));
    const done = fake.frames.find((frame) => frame.kind === 'done');
    expect(done?.kind).toBe('done');
    if (done?.kind === 'done') {
      expect(done.text.length).toBeLessThanOrEqual(64 * 1024);
      expect(done.text.endsWith('[browser output truncated]')).toBe(true);
    }
  });

  test('a login form keeps its marker line and frame field even when the snapshot is truncated', async () => {
    const fake = fakeClient();
    const provider: ComputerProvider = {
      async execute(request) {
        return (async function* () {
          yield {
            kind: 'stdout' as const,
            text: request.argv.includes('eval')
              ? JSON.stringify({ success: true, data: { result: ['password'] } })
              : 'x'.repeat(70_000),
          };
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
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: { forScope: () => provider, async killAll() {} },
      ...FAST,
    });
    await dispatcher.dispatch(call('browser_snapshot', {}, { scopeKey: 'chief:c1' }));
    const done = fake.frames.find((frame) => frame.kind === 'done');
    expect(done).toMatchObject({ kind: 'done', loginForm: { signals: ['password'] } });
    if (done?.kind === 'done') expect(done.text.startsWith('[login form: password]\n')).toBe(true);
  });

  test('browser refusal messages are bounded to the error frame limit', async () => {
    const fake = fakeClient();
    const huge = `boom ${'y'.repeat(5_000)}`;
    const provider: ComputerProvider = {
      async execute() {
        return (async function* () {
          yield { kind: 'stderr' as const, text: huge };
          yield { kind: 'exit' as const, code: 1 };
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
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: { forScope: () => provider, async killAll() {} },
      ...FAST,
    });
    await dispatcher.dispatch(call('browser_snapshot', {}, { scopeKey: 'chief:c1' }));
    const err = fake.frames.find((frame) => frame.kind === 'error');
    expect(err?.kind).toBe('error');
    if (err?.kind === 'error') {
      expect(err.message.length).toBeLessThanOrEqual(4096);
      expect(err.message.endsWith('[browser output truncated]')).toBe(true);
    }
  });

  test('the Orb shell keeps the desktop-protection guard but not the cairn host rules', async () => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: fakeOrb(log),
      host: fakeProvider(log, 'host'),
      ...FAST,
    });
    const scoped = { scopeKey: 'chief:c1' };
    await dispatcher.dispatch(call('shell', { command: 'pkill Xvfb' }, scoped));
    await dispatcher.dispatch(
      call('shell', { command: 'systemctl stop cairn-computer-desktop' }, scoped),
    );
    await dispatcher.dispatch(
      call('shell', { command: 'systemctl status cairn-computer-desktop' }, scoped),
    );
    await dispatcher.dispatch(
      call('shell', { command: 'machinectl poweroff cairn-orb-x' }, scoped),
    );
    await dispatcher.dispatch(
      call('user_computer_shell', { command: 'machinectl poweroff cairn-orb-x' }),
    );
    const errors = fake.frames.filter((frame) => frame.kind === 'error');
    expect(errors).toHaveLength(3);
    for (const error of errors) {
      expect(error).toMatchObject({ delivery: 'not_delivered' });
      expect((error as { message: string }).message).toContain('desktop-protection guard');
    }
    expect(log).toEqual([
      'orb[chief:c1]:execute:systemctl status cairn-computer-desktop',
      'orb[chief:c1]:execute:machinectl poweroff cairn-orb-x',
    ]);
  });

  test('the two guard entry points differ only by the cairn host rules', () => {
    for (const command of [
      'machinectl poweroff cairn-orb-x',
      'shutdown now',
      'nft flush ruleset',
    ]) {
      expect(protectedComputerLifecycleRefusal(command)).toBeTypeOf('string');
      expect(orbComputerProtectionRefusal(command)).toBeUndefined();
    }
    for (const command of [
      'pkill Xvfb',
      'killall fluxbox',
      'systemctl restart x11vnc',
      'rm -f /tmp/.X1-lock',
    ]) {
      expect(orbComputerProtectionRefusal(command)).toBeTypeOf('string');
      expect(orbComputerProtectionRefusal(command)).toBe(
        protectedComputerLifecycleRefusal(command),
      );
    }
    expect(
      orbComputerProtectionRefusal('bash -c "machinectl poweroff cairn-orb-x"'),
    ).toBeUndefined();
    expect(orbComputerProtectionRefusal('bash -c "pkill Xvfb"')).toBe('protected command pkill');
    expect(orbComputerProtectionRefusal('systemctl status cairn-computer-desktop')).toBeUndefined();
  });
});

describe('file call deadline', () => {
  test('file tools are bounded by the time left before the call deadline', async () => {
    timeouts.length = 0;
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({ client: fake.client, orb: fakeOrb([]), ...FAST });
    await dispatcher.dispatch(
      call('read_file', { path: 'a' }, { scopeKey: 'chief:c1', deadlineAt: Date.now() + 20_000 }),
    );
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThan(13_000);
    expect(timeouts[0]).toBeLessThanOrEqual(15_000);
  });
});

describe('call id replay', () => {
  test('a finished safe call with the same id runs again, a finished unsafe call is ignored', async () => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: fakeOrb(log),
      ...FAST,
    });
    const read = call('read_file', { path: 'a' }, { scopeKey: 'chief:c1' });
    await dispatcher.dispatch(read);
    await dispatcher.dispatch(read);
    const write = call('write_file', { path: 'a', content: 'b' }, { scopeKey: 'chief:c1' });
    await dispatcher.dispatch(write);
    await dispatcher.dispatch(write);
    const shell = call('shell', { command: 'ls' }, { scopeKey: 'chief:c1' });
    await dispatcher.dispatch(shell);
    await dispatcher.dispatch(shell);
    expect(log).toEqual([
      'orb[chief:c1]:read:a',
      'orb[chief:c1]:read:a',
      'orb[chief:c1]:write:a',
      'orb[chief:c1]:execute:ls',
    ]);
  });

  test('a duplicate of a call that is still running is ignored whatever the tool', async () => {
    const log: string[] = [];
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: fakeOrb(log, hold),
      ...FAST,
    });
    const read = call('read_file', { path: 'a' }, { scopeKey: 'chief:c1' });
    const first = dispatcher.dispatch(read);
    await dispatcher.dispatch(read);
    release();
    await first;
    expect(log).toEqual(['orb[chief:c1]:read:a']);
    expect(fake.frames.filter((frame) => frame.kind === 'done')).toHaveLength(1);
  });

  test('closing the dispatcher kills commands on the Orb provider too', async () => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: fakeOrb(log),
      ...FAST,
    });
    await dispatcher.close();
    expect(log).toContain('orb:killAll');
  });
});
