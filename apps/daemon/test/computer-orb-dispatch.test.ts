import {
  type ComputerCall,
  type ComputerFrame,
  type ComputerTool,
  isComputerBrowserTool,
  type MachineComputerFramesBody,
  PACKAGES_INSTALLED_PREFIX,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { AUTO_STEALTH_NOTE } from '../src/computer/browser.js';
import {
  createComputerDispatcher,
  NO_COMPUTER_GRANT_MESSAGE,
  NO_COMPUTER_PROVIDER_MESSAGE,
  NO_COMPUTER_SCOPE_MESSAGE,
  NO_VM_COMPUTER_MESSAGE,
} from '../src/computer/dispatch.js';
import {
  type ComputerProvider,
  ComputerRefusal,
  type ScopedComputerProviders,
} from '../src/computer/provider.js';
import { NO_CLOAK_LICENSE } from '../src/computer/vm-desktop.js';

const FAST = { flushMs: 20, heartbeatMs: 5_000, retryBaseMs: 5, retryMaxMs: 20, cairnOrigins: [] };

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
    ...(tool.startsWith('user_computer_')
      ? {}
      : {
          computerGrant: isComputerBrowserTool(tool) ? ('browser' as const) : ('desktop' as const),
        }),
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

  test.each([
    ['shell', { command: 'ls' }, 'desktop'],
    ['read_file', { path: 'a' }, 'desktop'],
    ['desktop_snapshot', {}, 'desktop'],
    ['browser_navigate', { url: 'https://example.com' }, 'browser'],
    ['browser_snapshot', {}, 'browser'],
    ['install_packages', { packages: ['ffmpeg'] }, 'desktop'],
  ] as const)(
    'an unstamped %s call is refused and never reaches a provider',
    async (tool, params, grant) => {
      const log: string[] = [];
      const fake = fakeClient();
      const dispatcher = createComputerDispatcher({
        client: fake.client,
        orb: {
          ...fakeOrb(log),
          async installPackages() {
            log.push('install:ran');
            return 0;
          },
        },
        ...FAST,
      });
      await dispatcher.dispatch(
        call(tool, params, { scopeKey: 'chief:c1', computerGrant: undefined }),
      );
      expect(errorOf(fake.frames)).toMatchObject({
        message: NO_COMPUTER_GRANT_MESSAGE,
        delivery: 'not_delivered',
      });
      expect(log).toEqual([]);
      fake.frames.length = 0;
      const wrong = grant === 'browser' ? ('desktop' as const) : ('browser' as const);
      await dispatcher.dispatch(call(tool, params, { scopeKey: 'chief:c1', computerGrant: wrong }));
      expect(errorOf(fake.frames)).toMatchObject({
        message: NO_COMPUTER_GRANT_MESSAGE,
        delivery: 'not_delivered',
      });
      expect(log).toEqual([]);
    },
  );

  test('computer_manage and browser_close_tab run without a grant stamp', async () => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: {
        ...fakeOrb(log),
        async manage(scopeKey, action) {
          log.push(`manage[${scopeKey}]:${action}`);
          return 'stopped' as const;
        },
      },
      ...FAST,
    });
    await dispatcher.dispatch(
      call('computer_manage', { action: 'stop' }, { scopeKey: 'chief:c1' }),
    );
    expect(log).toEqual(['manage[chief:c1]:stop']);
  });

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

  test('desktop screen tools go to the scope provider', async () => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: fakeOrb(log),
      ...FAST,
    });
    await dispatcher.dispatch(
      call('computer_act', { actions: [{ kind: 'key', key: 'Return' }] }, { scopeKey: 'chief:c1' }),
    );
    expect(errorOf(fake.frames)?.message).not.toBe(NO_COMPUTER_PROVIDER_MESSAGE);
    expect(log[0]).toBe('orb[chief:c1]:execute:Return');
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

  test.each([
    ['a license reopens the address in the stealth browser and says so', true],
    ['no license returns the no-license refusal', false],
  ])('a blank anti-automation page after browser_navigate: %s', async (_name, licensed) => {
    const fake = fakeClient();
    const ran: string[][] = [];
    const provider: ComputerProvider = {
      async execute(request) {
        const stealth = request.argv.includes('chief_c1-stealth');
        if (stealth && !licensed) throw new ComputerRefusal(NO_CLOAK_LICENSE);
        ran.push([...request.argv]);
        const blank = !stealth && request.argv.includes('snapshot');
        return (async function* () {
          if (blank) yield { kind: 'stdout' as const, text: '(no interactive elements)' };
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
    await dispatcher.dispatch(
      call('browser_navigate', { url: 'https://www.zhipin.com/' }, { scopeKey: 'chief:c1' }),
    );
    if (licensed) {
      const done = fake.frames.find((frame) => frame.kind === 'done');
      expect(done?.kind === 'done' && done.text.startsWith(AUTO_STEALTH_NOTE)).toBe(true);
      expect(
        ran.some(
          (argv) => argv.includes('chief_c1-stealth') && argv.at(-1) === 'https://www.zhipin.com/',
        ),
      ).toBe(true);
    } else {
      expect(errorOf(fake.frames)?.message).toBe(NO_CLOAK_LICENSE);
    }
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
      async execute(request) {
        return (async function* () {
          if (request.argv.at(-1) === 'url') {
            yield { kind: 'stdout' as const, text: 'https://example.com/\n' };
            yield { kind: 'exit' as const, code: 0 };
            return;
          }
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

  test('install_packages runs on the VM computer, streams apt output and names what it installed', async () => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: {
        ...fakeOrb(log),
        async installPackages(scopeKey, packages, options) {
          log.push(`install[${scopeKey}]:${packages.join(',')}`);
          options.output('stdout', 'Setting up ffmpeg (7:5.1.9) ...\n');
          return 0;
        },
      },
      ...FAST,
    });
    await dispatcher.dispatch(
      call('install_packages', { packages: ['ffmpeg'] }, { scopeKey: 'chief:c1' }),
    );
    expect(log).toEqual(['install[chief:c1]:ffmpeg']);
    expect(fake.frames.some((frame) => frame.kind === 'output')).toBe(true);
    const done = fake.frames.find((frame) => frame.kind === 'done');
    expect(done).toMatchObject({ exitCode: 0 });
    expect(done && 'text' in done && done.text).toContain(`${PACKAGES_INSTALLED_PREFIX} ffmpeg`);
    expect(done && 'text' in done && done.text).toContain('Setting up ffmpeg');
  });

  test('a failed apt run comes back as an error with its last lines', async () => {
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: {
        ...fakeOrb([]),
        async installPackages(_scopeKey, _packages, options) {
          options.output('stderr', 'E: Unable to locate package nosuch\n');
          return 100;
        },
      },
      ...FAST,
    });
    await dispatcher.dispatch(
      call('install_packages', { packages: ['nosuch'] }, { scopeKey: 'chief:c1' }),
    );
    expect(errorOf(fake.frames)?.message).toContain('apt-get exited with 100');
    expect(errorOf(fake.frames)?.message).toContain('Unable to locate package nosuch');
  });

  test.each([
    ['a path', { packages: ['/tmp/x.deb'] }],
    ['an option', { packages: ['--allow-unauthenticated'] }],
    ['no package', { packages: [] }],
    ['an extra parameter', { packages: ['ffmpeg'], flags: '-y' }],
  ])('install_packages with %s is refused and never reaches the computer', async (_l, params) => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: {
        ...fakeOrb(log),
        async installPackages() {
          log.push('install');
          return 0;
        },
      },
      ...FAST,
    });
    await dispatcher.dispatch(call('install_packages', params, { scopeKey: 'chief:c1' }));
    expect(errorOf(fake.frames)?.delivery).toBe('not_delivered');
    expect(log).toEqual([]);
  });

  test('a computer that cannot install or manage refuses both', async () => {
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: fakeOrb([]),
      ...FAST,
    });
    await dispatcher.dispatch(
      call('install_packages', { packages: ['ffmpeg'] }, { scopeKey: 'chief:c1' }),
    );
    await dispatcher.dispatch(
      call('computer_manage', { action: 'stop' }, { scopeKey: 'chief:c1' }),
    );
    const errors = fake.frames.filter((frame) => frame.kind === 'error');
    expect(errors).toHaveLength(2);
    expect(errors.map((frame) => 'message' in frame && frame.message)).toEqual([
      NO_VM_COMPUTER_MESSAGE,
      NO_VM_COMPUTER_MESSAGE,
    ]);
  });

  test('computer_manage runs the owner action and returns its outcome', async () => {
    const log: string[] = [];
    const fake = fakeClient();
    const dispatcher = createComputerDispatcher({
      client: fake.client,
      orb: {
        ...fakeOrb(log),
        async manage(scopeKey, action) {
          log.push(`manage[${scopeKey}]:${action}`);
          return 'current';
        },
      },
      ...FAST,
    });
    await dispatcher.dispatch(
      call('computer_manage', { action: 'update' }, { scopeKey: 'chief:c1' }),
    );
    await dispatcher.dispatch(
      call('computer_manage', { action: 'wipe' }, { scopeKey: 'chief:c1' }),
    );
    expect(log).toEqual(['manage[chief:c1]:update']);
    expect(fake.frames.find((frame) => frame.kind === 'done')).toMatchObject({ text: 'current' });
    expect(errorOf(fake.frames)?.delivery).toBe('not_delivered');
  });
});
