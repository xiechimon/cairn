import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import type { AgentBackend } from '@cairn/shared';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import type { MachineApi } from '../src/machine-client.js';
import { orbDistRelease } from '../src/orb/dist.js';
import {
  type E2bClient,
  type E2bCommand,
  type E2bCommandExit,
  E2bOrbProvider,
  type E2bSandbox,
} from '../src/orb/e2b-provider.js';
import { ORB_RELAY_TOKEN_ENV } from '../src/orb/protocol.js';
import {
  HostOrbProvider,
  NspawnOrbProvider,
  type OrbHandle,
  type OrbProvider,
} from '../src/orb/provider.js';
import { OrbStaleReleaseError, RelayMachineApi, RelayMachineServer } from '../src/orb/relay.js';
import {
  createOrbProvider,
  E2B_API_KEY_ENV,
  E2B_TEMPLATE_ENV,
  E2B_TIMEOUT_ENV,
  e2bProviderOptions,
  resolveOrbRuntime,
} from '../src/orb/select.js';
import { runOrbWorker, stdioDuplex } from '../src/orb/worker.js';
import { boot, CLAIMED, FakeMachineApi, fakeBackend, waitFor } from './machine-loop-harness.js';
import { createOrbCheckout } from './orb-dist-fixture.js';

const API_KEY = 'e2b_test_key_must_never_leave_the_host';
const TEMPLATE = 'cairn-test-template';

interface WorkerContext {
  token: string;
  input: PassThrough;
  emit: (text: string) => void;
}

interface FakeSandboxOptions {
  installed?: boolean;
  startError?: Error;
  killGate?: Promise<void>;
  worker: (context: WorkerContext) => Promise<E2bCommandExit | undefined>;
}

class FakeSandbox implements E2bSandbox {
  readonly id = `sandbox-${Math.random().toString(16).slice(2)}`;
  readonly execs: string[] = [];
  readonly started: { command: string; envs: Record<string, string> }[] = [];
  killed = 0;
  commandKilled = 0;
  constructor(private readonly options: FakeSandboxOptions) {}

  async exec(command: string) {
    this.execs.push(command);
    const missing = this.options.installed === false && command.startsWith('test -f');
    return { exitCode: missing ? 1 : 0, stdout: '', stderr: '' };
  }

  async start(
    command: string,
    options: {
      envs: Record<string, string>;
      onStdout: (chunk: string) => void;
      onStderr: (chunk: string) => void;
    },
  ): Promise<E2bCommand> {
    if (this.options.startError) throw this.options.startError;
    this.started.push({ command, envs: options.envs });
    const input = new PassThrough();
    const exited = this.options.worker({
      token: options.envs[ORB_RELAY_TOKEN_ENV] ?? '',
      input,
      emit: options.onStdout,
    });
    let finish: (exit: E2bCommandExit) => void = () => {};
    const killed = new Promise<E2bCommandExit>((resolve) => {
      finish = resolve;
    });
    return {
      sendStdin: async (data) => {
        input.write(data);
      },
      closeStdin: async () => {
        input.end();
      },
      kill: async () => {
        this.commandKilled += 1;
        input.destroy();
        finish({ exitCode: 137, timedOut: false });
      },
      exited: Promise.race([
        exited.then((exit) => exit ?? { exitCode: 0, timedOut: false }),
        killed,
      ]).catch((error: unknown) => ({
        exitCode: 1,
        timedOut: false,
        error: String(error),
      })),
    };
  }

  async kill(): Promise<void> {
    this.killed += 1;
    await this.options.killGate;
  }
}

class FakeE2b implements E2bClient {
  readonly sandboxes: FakeSandbox[] = [];
  readonly createCalls: Parameters<E2bClient['create']>[0][] = [];
  createError: Error | undefined;
  createDelay: Promise<void> | undefined;
  constructor(private readonly options: FakeSandboxOptions) {}

  async create(options: Parameters<E2bClient['create']>[0]): Promise<E2bSandbox> {
    this.createCalls.push(options);
    await this.createDelay;
    if (this.createError) throw this.createError;
    const sandbox = new FakeSandbox(this.options);
    this.sandboxes.push(sandbox);
    return sandbox;
  }
}

function checkout() {
  const root = makeTestTempDir('orb-e2b-');
  return createOrbCheckout(root);
}

function provider(client: E2bClient, overrides: { sessionTimeoutMs?: number } = {}) {
  const { distSource, runner } = checkout();
  return new E2bOrbProvider({
    client,
    template: TEMPLATE,
    distSource,
    runner,
    ...overrides,
  });
}

async function started(subject: E2bOrbProvider, signal?: AbortSignal): Promise<OrbHandle> {
  const handle = await subject.ensure({ conversationId: 'conv-1', projectId: 'p1' });
  await subject.prepare(handle);
  await subject.start(handle, signal ? { signal } : {});
  return handle;
}

function upstream(forwarded: (method: string, args: unknown[]) => unknown): MachineApi {
  return new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        async (...args: unknown[]) =>
          forwarded(method, args),
    },
  ) as MachineApi;
}

function remoteWorker(
  release: (handle: OrbHandle) => string,
  handle: () => OrbHandle,
  use: (client: RelayMachineApi, context: WorkerContext) => Promise<void>,
  options: { token?: (token: string) => string; chunk?: number } = {},
) {
  return async (context: WorkerContext): Promise<E2bCommandExit> => {
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        const text = chunk.toString();
        const size = options.chunk ?? text.length;
        for (let offset = 0; offset < text.length; offset += size)
          context.emit(text.slice(offset, offset + size));
        callback();
      },
    });
    context.emit('npm warn noise before the first frame\n');
    const client = await RelayMachineApi.connectStream(
      stdioDuplex(context.input, output),
      options.token?.(context.token) ?? context.token,
      release(handle()),
    );
    try {
      context.emit('stray stdout line that is not a frame\n');
      await use(client, context);
    } finally {
      client.close();
    }
    return { exitCode: 0, timedOut: false };
  };
}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function relayed(subject: E2bOrbProvider, handle: OrbHandle, forwarded = vi.fn()) {
  const failures: Error[] = [];
  const controller = new AbortController();
  const server = new RelayMachineServer({
    socketPath: '/unused/relay.sock',
    release: handle.expectedReleaseKey ?? '',
    stepId: 'step',
    upstream: upstream(forwarded),
    onAuthenticated: (release) => subject.authenticateRelease(handle, release),
  });
  const stream = await subject.openRelayStream(handle, {
    token: server.authToken,
    signal: controller.signal,
    onFailure: (error) => failures.push(error),
  });
  server.attach(stream);
  cleanup.push(async () => {
    controller.abort();
    await server.close();
  });
  return { server, stream, failures, controller, forwarded };
}

describe('frames over the sandbox command stdout and stdin', () => {
  test('a call round-trips with noise lines ignored, split chunks and a payload larger than one stdin piece', async () => {
    const forwarded = vi.fn(async (method: string, args: unknown[]) => ({ method, args }));
    let handle: OrbHandle | undefined;
    const big = 'é'.repeat(200_000);
    let reply: unknown;
    const client = new FakeE2b({
      worker: remoteWorker(
        (orb) => orb.expectedReleaseKey ?? '',
        () => handle as OrbHandle,
        async (api) => {
          reply = await api.call('heartbeat', ['step', { text: big, n: 1 }]);
        },
        { chunk: 7 },
      ),
    });
    const subject = provider(client);
    handle = await started(subject);
    const { stream } = await relayed(subject, handle, forwarded);
    await new Promise<void>((resolve) => stream.once('close', () => resolve()));
    expect(forwarded).toHaveBeenCalledWith('heartbeat', ['step', { text: big, n: 1 }]);
    expect(reply).toEqual({ method: 'heartbeat', args: ['step', { text: big, n: 1 }] });
    expect(handle.releaseKey).toBe(handle.expectedReleaseKey);
  });

  test('the command receives the relay token and the cairn marker, and never the E2B key', async () => {
    let handle: OrbHandle | undefined;
    const client = new FakeE2b({
      worker: remoteWorker(
        (orb) => orb.expectedReleaseKey ?? '',
        () => handle as OrbHandle,
        async () => {},
      ),
    });
    const subject = provider(client);
    handle = await started(subject);
    const { server, stream } = await relayed(subject, handle);
    await new Promise<void>((resolve) => stream.once('close', () => resolve()));
    const [sandbox] = client.sandboxes;
    expect(sandbox?.started).toHaveLength(1);
    expect(sandbox?.started[0]?.envs).toEqual({
      CAIRN_ORB: '1',
      [ORB_RELAY_TOKEN_ENV]: server.authToken,
    });
    expect(sandbox?.started[0]?.command).toContain('orb-step --stdio');
    expect(JSON.stringify([client.createCalls, sandbox?.started])).not.toContain(API_KEY);
  });

  test('a wrong token is dropped before any call reaches upstream', async () => {
    const forwarded = vi.fn();
    let handle: OrbHandle | undefined;
    let outcome: unknown;
    const client = new FakeE2b({
      worker: async (context) => {
        const output = new Writable({
          write(chunk: Buffer, _encoding, callback) {
            context.emit(chunk.toString());
            callback();
          },
        });
        outcome = await RelayMachineApi.connectStream(
          stdioDuplex(context.input, output),
          'f'.repeat(64),
          handle?.expectedReleaseKey ?? '',
        ).catch((error: unknown) => error);
        return { exitCode: 1, timedOut: false };
      },
    });
    const subject = provider(client);
    handle = await started(subject);
    const { stream } = await relayed(subject, handle, forwarded);
    await new Promise<void>((resolve) => stream.once('close', () => resolve()));
    await vi.waitFor(() => expect(outcome).toBeInstanceOf(Error));
    expect(forwarded).not.toHaveBeenCalled();
    expect(handle.releaseKey).toBeUndefined();
  });

  test('a stale release key is refused and reported to the host', async () => {
    let handle: OrbHandle | undefined;
    let outcome: unknown;
    const stale = '0.0.1-abcd-dist-0000000000000000';
    const client = new FakeE2b({
      worker: async (context) => {
        const output = new Writable({
          write(chunk: Buffer, _encoding, callback) {
            context.emit(chunk.toString());
            callback();
          },
        });
        outcome = await RelayMachineApi.connectStream(
          stdioDuplex(context.input, output),
          context.token,
          stale,
        ).catch((error: unknown) => error);
        return { exitCode: 75, timedOut: false };
      },
    });
    const subject = provider(client);
    handle = await started(subject);
    const loaded: string[] = [];
    const server = new RelayMachineServer({
      socketPath: '/unused/relay.sock',
      release: handle.expectedReleaseKey ?? '',
      stepId: 'step',
      upstream: upstream(vi.fn()),
      onStaleRelease: (release) => loaded.push(release),
      onAuthenticated: (release) => subject.authenticateRelease(handle as OrbHandle, release),
    });
    const failures: Error[] = [];
    const stream = await subject.openRelayStream(handle, {
      token: server.authToken,
      signal: new AbortController().signal,
      onFailure: (error) => failures.push(error),
    });
    server.attach(stream);
    cleanup.push(() => server.close());
    await new Promise<void>((resolve) => stream.once('close', () => resolve()));
    expect(outcome).toBeInstanceOf(OrbStaleReleaseError);
    expect(loaded).toEqual([stale]);
    expect(handle.releaseKey).toBeUndefined();
    expect(failures[0]?.message).toContain('stale-release');
  });

  test('the provider refuses to authenticate a release it did not publish', async () => {
    const subject = provider(new FakeE2b({ worker: async () => undefined }));
    const handle = await started(subject);
    expect(() => subject.authenticateRelease(handle, '0.0.1-abcd-dist-0000000000000000')).toThrow(
      'does not match published release',
    );
    expect(() => subject.authenticateRelease(handle, 'not-a-release')).toThrow();
    subject.authenticateRelease(handle, handle.expectedReleaseKey ?? '');
    expect(handle.releaseKey).toBe(handle.expectedReleaseKey);
  });
});

describe('sandbox lifecycle', () => {
  test('a creation failure surfaces the cause and leaves nothing running', async () => {
    const client = new FakeE2b({ worker: async () => undefined });
    client.createError = new Error('429 sandbox quota exceeded');
    const subject = provider(client);
    const handle = await subject.ensure({ conversationId: 'conv-1', projectId: 'p1' });
    await subject.prepare(handle);
    await expect(subject.start(handle)).rejects.toThrow(
      'E2B sandbox creation failed: 429 sandbox quota exceeded',
    );
    expect(handle.running).toBe(false);
    await expect(
      subject.openRelayStream(handle, {
        token: 'a'.repeat(64),
        signal: new AbortController().signal,
        onFailure: () => {},
      }),
    ).rejects.toThrow('E2B sandbox is not running');
  });

  test('the sandbox is created with the configured template and the session limit', async () => {
    const client = new FakeE2b({ worker: async () => undefined });
    const subject = provider(client, { sessionTimeoutMs: 1_800_000 });
    await started(subject);
    expect(client.createCalls).toHaveLength(1);
    expect(client.createCalls[0]).toMatchObject({ template: TEMPLATE, timeoutMs: 1_800_000 });
  });

  test('a template without the published release is rejected and its sandbox killed', async () => {
    const client = new FakeE2b({ installed: false, worker: async () => undefined });
    const subject = provider(client);
    const handle = await subject.ensure({ conversationId: 'conv-1', projectId: 'p1' });
    await subject.prepare(handle);
    await expect(subject.start(handle)).rejects.toThrow(
      `E2B template "${TEMPLATE}" has no cairn release ${handle.expectedReleaseKey}`,
    );
    expect(client.sandboxes[0]?.killed).toBe(1);
    expect(handle.running).toBe(false);
  });

  test('an abort during creation kills the sandbox that arrives late', async () => {
    const client = new FakeE2b({ worker: async () => undefined });
    let open: () => void = () => {};
    client.createDelay = new Promise<void>((resolve) => {
      open = resolve;
    });
    const subject = provider(client);
    const handle = await subject.ensure({ conversationId: 'conv-1', projectId: 'p1' });
    await subject.prepare(handle);
    const controller = new AbortController();
    const starting = subject.start(handle, { signal: controller.signal });
    controller.abort(new Error('step aborted'));
    open();
    await expect(starting).rejects.toThrow('step aborted');
    expect(client.sandboxes[0]?.killed).toBe(1);
    expect(handle.running).toBe(false);
  });

  test('an abort while the worker runs kills the command, then stop kills the sandbox', async () => {
    const client = new FakeE2b({ worker: () => new Promise(() => {}) });
    const subject = provider(client);
    const handle = await started(subject);
    const { controller, stream } = await relayed(subject, handle);
    controller.abort();
    await new Promise<void>((resolve) => stream.once('close', () => resolve()));
    const [sandbox] = client.sandboxes;
    expect(sandbox?.commandKilled).toBe(1);
    await vi.waitFor(() => expect(sandbox?.killed).toBe(1));
    expect(handle.running).toBe(false);
  });

  test('a finished worker destroys its sandbox at step end', async () => {
    let handle: OrbHandle | undefined;
    const client = new FakeE2b({
      worker: remoteWorker(
        (orb) => orb.expectedReleaseKey ?? '',
        () => handle as OrbHandle,
        async () => {},
      ),
    });
    const subject = provider(client);
    handle = await started(subject);
    const { stream, failures } = await relayed(subject, handle);
    await new Promise<void>((resolve) => stream.once('close', () => resolve()));
    await vi.waitFor(() => expect(client.sandboxes[0]?.killed).toBe(1));
    expect(failures).toEqual([]);
    expect(handle.running).toBe(false);
  });

  test('hitting the session limit surfaces a clear failure and kills the sandbox', async () => {
    const client = new FakeE2b({ worker: async () => ({ exitCode: -1, timedOut: true }) });
    const subject = provider(client, { sessionTimeoutMs: 3_600_000 });
    const handle = await started(subject);
    const { stream, failures } = await relayed(subject, handle);
    await new Promise<void>((resolve) => stream.once('close', () => resolve()));
    expect(failures[0]?.message).toContain('session limit of 60 minutes');
    expect(failures[0]?.message).not.toContain(API_KEY);
    await vi.waitFor(() => expect(client.sandboxes[0]?.killed).toBe(1));
  });

  test('a worker that crashes reports its exit code and stderr tail', async () => {
    const client = new FakeE2b({ worker: async () => ({ exitCode: 127, timedOut: false }) });
    const subject = provider(client);
    const handle = await started(subject);
    const { stream, failures } = await relayed(subject, handle);
    await new Promise<void>((resolve) => stream.once('close', () => resolve()));
    expect(failures[0]?.message).toBe('E2B worker exited with code 127');
  });

  test('a step started while the previous sandbox is still being killed gets a new sandbox', async () => {
    let finishKill: () => void = () => {};
    const killGate = new Promise<void>((resolve) => {
      finishKill = resolve;
    });
    const client = new FakeE2b({ worker: async () => undefined, killGate });
    const subject = provider(client);
    const handle = await started(subject);
    const stopping = subject.stop(handle);
    await subject.start(handle);
    expect(client.sandboxes).toHaveLength(2);
    expect(handle.running).toBe(true);
    await relayed(subject, handle);
    expect(client.sandboxes[0]?.started).toHaveLength(0);
    expect(client.sandboxes[1]?.started).toHaveLength(1);
    finishKill();
    await stopping;
  });

  test('a worker start failure kills the sandbox and the next step creates a new one', async () => {
    const client = new FakeE2b({
      worker: async () => undefined,
      startError: new Error('envd down'),
    });
    const subject = provider(client);
    const handle = await started(subject);
    await expect(
      subject.openRelayStream(handle, {
        token: 'a'.repeat(64),
        signal: new AbortController().signal,
        onFailure: () => {},
      }),
    ).rejects.toThrow('envd down');
    expect(client.sandboxes[0]?.killed).toBe(1);
    expect(handle.running).toBe(false);
    await subject.start(handle);
    expect(client.sandboxes).toHaveLength(2);
  });

  test('destroy kills the sandbox and forgets the thread', async () => {
    const client = new FakeE2b({ worker: async () => undefined });
    const subject = provider(client);
    const handle = await started(subject);
    await subject.destroy(handle);
    expect(client.sandboxes[0]?.killed).toBe(1);
    expect(await subject.list()).toEqual([]);
  });

  test('a failed kill keeps the sandbox tracked so destroy can retry', async () => {
    const client = new FakeE2b({ worker: async () => undefined });
    const subject = provider(client);
    const handle = await started(subject);
    const sandbox = client.sandboxes[0] as FakeSandbox;
    vi.spyOn(sandbox, 'kill').mockRejectedValueOnce(new Error('E2B API unavailable'));
    await expect(subject.stop(handle)).rejects.toThrow('E2B API unavailable');
    expect(handle.running).toBe(true);
    await subject.stop(handle);
    expect(handle.running).toBe(false);
    expect(sandbox.kill).toHaveBeenCalledTimes(2);
  });

  test.each([30_000, 90_000_000, 1.5])('rejects the session limit %s', (sessionTimeoutMs) => {
    expect(() =>
      provider(new FakeE2b({ worker: async () => undefined }), { sessionTimeoutMs }),
    ).toThrow('E2B session timeout must be an integer');
  });
});

describe('selection', () => {
  const env = {
    CAIRN_EXECUTOR: 'orb',
    CAIRN_ORB_RUNTIME: 'e2b',
    [E2B_API_KEY_ENV]: API_KEY,
    [E2B_TEMPLATE_ENV]: TEMPLATE,
  };

  test('e2b is a named runtime', () => {
    expect(resolveOrbRuntime({ CAIRN_ORB_RUNTIME: 'e2b' })).toBe('e2b');
  });

  test('explicit configuration selects the E2B provider', () => {
    expect(createOrbProvider(env, '/nonexistent/home')).toBeInstanceOf(E2bOrbProvider);
  });

  test('a missing key fails instead of falling back to the host or nspawn', () => {
    expect(() =>
      createOrbProvider({ ...env, [E2B_API_KEY_ENV]: undefined }, '/nonexistent/home'),
    ).toThrow('E2B_API_KEY must be set in the daemon environment');
    expect(() => createOrbProvider({ ...env, [E2B_API_KEY_ENV]: '' }, '/nonexistent/home')).toThrow(
      'E2B_API_KEY must be set',
    );
  });

  test('a missing template fails instead of guessing one', () => {
    expect(() =>
      createOrbProvider({ ...env, [E2B_TEMPLATE_ENV]: undefined }, '/nonexistent/home'),
    ).toThrow('CAIRN_E2B_TEMPLATE must name the E2B template');
  });

  test.each([
    ['100', false],
    ['3600000', true],
    ['86400001', false],
    ['soon', false],
  ])('session limit %s', (value, valid) => {
    const call = () => e2bProviderOptions({ ...env, [E2B_TIMEOUT_ENV]: value });
    if (valid) expect(call().sessionTimeoutMs).toBe(3_600_000);
    else expect(call).toThrow('CAIRN_E2B_TIMEOUT_MS must be an integer between');
  });

  test('the session limit defaults to one hour', () => {
    expect(e2bProviderOptions(env).sessionTimeoutMs).toBe(3_600_000);
  });

  test('the default path is unchanged by E2B variables', () => {
    const ambient = { [E2B_API_KEY_ENV]: API_KEY, [E2B_TEMPLATE_ENV]: TEMPLATE };
    expect(createOrbProvider({ ...ambient }, '/nonexistent/home')).toBeInstanceOf(HostOrbProvider);
    expect(
      createOrbProvider({ ...ambient, CAIRN_EXECUTOR: 'host' }, '/nonexistent/home'),
    ).toBeInstanceOf(HostOrbProvider);
    expect(
      createOrbProvider({ ...ambient, CAIRN_EXECUTOR: 'orb' }, '/nonexistent/home'),
    ).toBeInstanceOf(NspawnOrbProvider);
    expect(resolveOrbRuntime({})).toBe('nspawn');
  });

  test('only the E2B provider offers a relay stream', () => {
    expect((new HostOrbProvider() as OrbProvider).openRelayStream).toBeUndefined();
    expect((new NspawnOrbProvider() as OrbProvider).openRelayStream).toBeUndefined();
    expect(provider(new FakeE2b({ worker: async () => undefined })).openRelayStream).toBeDefined();
  });
});

describe('a whole step in a fake sandbox', () => {
  function releaseEntryFor(root: string, release: string): string {
    const entry = join(root, 'releases', release, 'dist', 'cli.mjs');
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, '');
    return entry;
  }

  async function stepProvider(options: {
    backend?: AgentBackend;
    worker?: FakeSandboxOptions['worker'];
    sessionTimeoutMs?: number;
  }) {
    const { distSource, runner } = checkout();
    const { key } = await orbDistRelease(distSource, runner);
    const root = makeTestTempDir('orb-e2b-step-');
    const entryPath = releaseEntryFor(root, key);
    const backend = options.backend ?? fakeBackend([{ type: 'done', usage: [] }]).backend;
    const worker: FakeSandboxOptions['worker'] =
      options.worker ??
      (async (context) => {
        const output = new Writable({
          write(chunk: Buffer, _encoding, callback) {
            context.emit(chunk.toString());
            callback();
          },
        });
        await runOrbWorker({
          stdio: { input: context.input, output, token: context.token },
          entryPath,
          backendFor: () => backend,
          home: join(root, 'agent'),
          workspacesRoot: join(root, 'agent', 'work'),
        });
        return undefined;
      });
    const client = new FakeE2b({ worker });
    return {
      client,
      subject: new E2bOrbProvider({
        client,
        template: TEMPLATE,
        distSource,
        runner,
        ...(options.sessionTimeoutMs ? { sessionTimeoutMs: options.sessionTimeoutMs } : {}),
      }),
    };
  }

  async function runClaimed(
    subject: E2bOrbProvider,
    claimed = CLAIMED,
    capEnv: NodeJS.ProcessEnv = {},
  ) {
    const api = new FakeMachineApi();
    api.claimQueue.push(claimed);
    const { handle, lines } = await boot({
      api,
      orbProvider: subject,
      capEnv: { CAIRN_EXECUTOR: 'orb', ...capEnv },
    });
    cleanup.push(async () => {
      await handle.stop();
      await handle.done;
    });
    return { api, lines };
  }

  test('the daemon claims, relays and completes a step through the sandbox command', async () => {
    const { subject, client } = await stepProvider({});
    const { api } = await runClaimed(subject);
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('success');
    expect(client.sandboxes).toHaveLength(1);
    await vi.waitFor(() => expect(client.sandboxes[0]?.killed).toBe(1));
    expect(client.sandboxes[0]?.started[0]?.envs.CAIRN_ORB).toBe('1');
  });

  test('a sandbox that cannot be created fails the step with the cause', async () => {
    const { subject, client } = await stepProvider({});
    client.createError = new Error('invalid API key');
    const { api } = await runClaimed(subject);
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body).toMatchObject({
      status: 'failed',
      errorMessage: 'E2B sandbox creation failed: invalid API key',
    });
  });

  test('the session limit fails the step with a clear message', async () => {
    const { subject, client } = await stepProvider({
      worker: async () => ({ exitCode: -1, timedOut: true }),
    });
    const { api } = await runClaimed(subject);
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body.status).toBe('failed');
    expect(api.doneBodies[0]?.body.errorMessage).toContain('session limit of 60 minutes');
    await vi.waitFor(() => expect(client.sandboxes[0]?.killed).toBe(1));
  });

  test('a worker killed by the sandbox before it authenticates fails fast with its exit code', async () => {
    const { subject } = await stepProvider({
      worker: async () => ({ exitCode: 127, timedOut: false }),
    });
    const { api } = await runClaimed(subject);
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body).toMatchObject({
      status: 'failed',
      errorMessage: 'E2B worker exited with code 127',
    });
  });

  test('a local repository cannot run in a remote sandbox and starts no command', async () => {
    const { subject, client } = await stepProvider({});
    const claimed = {
      ...CLAIMED,
      project: { id: 'p1', name: 'demo', repo: { kind: 'local' as const, cloneUrl: '/tmp/repo' } },
    };
    const { api } = await runClaimed(subject, claimed as typeof CLAIMED);
    await waitFor(() => api.doneBodies.length === 1);
    expect(api.doneBodies[0]?.body).toMatchObject({
      status: 'failed',
      errorMessage: 'Local repositories cannot run in a remote sandbox orb',
    });
    expect(client.sandboxes).toHaveLength(0);
  });

  test('the host proxy address is not injected into a remote sandbox', async () => {
    const { backend, created } = fakeBackend([{ type: 'done', usage: [] }]);
    const { subject } = await stepProvider({ backend });
    const { api } = await runClaimed(subject, CLAIMED, {
      CAIRN_ORB_PROXY_URL: 'http://127.0.0.1:7890',
    });
    await waitFor(() => api.doneBodies.length === 1);
    const env = (created[0]?.opts as { env?: Record<string, string> } | undefined)?.env ?? {};
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
  });
});
