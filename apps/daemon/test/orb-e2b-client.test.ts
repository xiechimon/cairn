import { beforeEach, describe, expect, test, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  class CommandExitError extends Error {
    constructor(
      readonly exitCode: number,
      readonly error: string,
    ) {
      super(error);
    }
    stdout = '';
    stderr = 'boom';
  }
  class TimeoutError extends Error {}
  class SandboxNotRunningError extends TimeoutError {}
  const state = {
    create: vi.fn(),
    run: vi.fn(),
    kill: vi.fn(),
    wait: vi.fn(),
    sendStdin: vi.fn(),
  };
  return { CommandExitError, TimeoutError, SandboxNotRunningError, state };
});

vi.mock('e2b', () => ({
  CommandExitError: sdk.CommandExitError,
  TimeoutError: sdk.TimeoutError,
  SandboxNotRunningError: sdk.SandboxNotRunningError,
  Sandbox: { create: sdk.state.create },
}));

import { createE2bClient } from '../src/orb/e2b-client.js';

const KEY = 'e2b_secret_key_value';

function sandbox() {
  return {
    sandboxId: 'sb-1',
    commands: { run: sdk.state.run },
    kill: sdk.state.kill,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  sdk.state.create.mockResolvedValue(sandbox());
});

describe('E2B bridge', () => {
  test('passes the key, template, limit and metadata to the SDK and nowhere else', async () => {
    const client = createE2bClient(KEY);
    await client.create({ template: 't', timeoutMs: 123_000, metadata: { cairnOrb: 'o' } });
    expect(sdk.state.create).toHaveBeenCalledWith('t', {
      apiKey: KEY,
      timeoutMs: 123_000,
      metadata: { cairnOrb: 'o' },
    });
  });

  test('redacts the key from SDK errors', async () => {
    sdk.state.create.mockRejectedValue(new Error(`401 invalid key ${KEY}`));
    const failure = await createE2bClient(KEY)
      .create({ template: 't', timeoutMs: 60_000, metadata: {} })
      .catch((error: unknown) => error);
    expect((failure as Error).message).toBe('401 invalid key [redacted]');
  });

  test('starts the worker with open stdin and no command timeout', async () => {
    const handle = {
      sendStdin: sdk.state.sendStdin.mockResolvedValue(undefined),
      closeStdin: vi.fn(),
      kill: vi.fn(),
      wait: sdk.state.wait.mockResolvedValue({ exitCode: 0 }),
    };
    sdk.state.run.mockResolvedValue(handle);
    const created = await createE2bClient(KEY).create({
      template: 't',
      timeoutMs: 60_000,
      metadata: {},
    });
    const onStdout = vi.fn();
    const command = await created.start('node x', {
      envs: { A: 'b' },
      onStdout,
      onStderr: vi.fn(),
    });
    expect(sdk.state.run).toHaveBeenCalledWith(
      'node x',
      expect.objectContaining({ background: true, stdin: true, timeoutMs: 0, envs: { A: 'b' } }),
    );
    await command.sendStdin(new Uint8Array([1]));
    expect(sdk.state.sendStdin).toHaveBeenCalledWith(new Uint8Array([1]));
    expect(await command.exited).toEqual({ exitCode: 0, timedOut: false });
  });

  test.each([
    [new sdk.CommandExitError(75, 'exit 75'), { exitCode: 75, timedOut: false, error: 'exit 75' }],
    [new sdk.SandboxNotRunningError('gone'), { exitCode: -1, timedOut: true, error: 'gone' }],
    [new sdk.TimeoutError('deadline'), { exitCode: -1, timedOut: true, error: 'deadline' }],
    [new Error('socket hang up'), { exitCode: -1, timedOut: false, error: 'socket hang up' }],
  ])('maps command failure %#', async (failure, expected) => {
    sdk.state.run.mockResolvedValue({ wait: sdk.state.wait.mockRejectedValue(failure) });
    const created = await createE2bClient(KEY).create({
      template: 't',
      timeoutMs: 60_000,
      metadata: {},
    });
    const command = await created.start('node x', {
      envs: {},
      onStdout: vi.fn(),
      onStderr: vi.fn(),
    });
    expect(await command.exited).toEqual(expected);
  });

  test('a failing foreground check returns its exit code instead of throwing', async () => {
    sdk.state.run.mockRejectedValue(new sdk.CommandExitError(1, 'exit 1'));
    const created = await createE2bClient(KEY).create({
      template: 't',
      timeoutMs: 60_000,
      metadata: {},
    });
    expect((await created.exec('test -f x')).exitCode).toBe(1);
  });
});
