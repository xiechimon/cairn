import { PassThrough } from 'node:stream';
import type { AgentBackend, AgentSessionHandle, SessionOpts } from '@cairn/shared';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { createClaudePtyBackend } from '../src/engine/claude-tui.js';
import { openEnginePtyProcess } from '../src/engine/pty.js';
import { assembleStepEnv } from '../src/step-env.js';

vi.mock('../src/engine/pty.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/pty.js')>();
  return { ...actual, openEnginePtyProcess: vi.fn() };
});

const spawn = vi.mocked(openEnginePtyProcess);

const innerHandle: AgentSessionHandle = {
  sessionId: 'inner-session',
  events: (async function* () {})(),
  steer: () => Promise.resolve(),
  stop: () => Promise.resolve(),
  usage: () => [],
};

function pipeBackend() {
  const createSession = vi.fn((_opts: SessionOpts) => Promise.resolve(innerHandle));
  const continueSession = vi.fn((_id: string, _opts: SessionOpts) => Promise.resolve(innerHandle));
  const backend: AgentBackend = {
    capabilities: {
      name: 'claude-code',
      thinkingLevels: [],
      oauthProviders: [],
      compaction: false,
      sessionResume: true,
    },
    createSession,
    continueSession,
  };
  return { backend, createSession, continueSession };
}

function fakePtyProc() {
  const stream = new PassThrough();
  stream.on('data', () => {});
  return {
    stream,
    pid: Promise.resolve(4242),
    close: () => {
      stream.destroy();
    },
  };
}

let dir: string;
let scrubSaved: string | undefined;

beforeEach(() => {
  dir = makeTestTempDir('engine-pty-sub-');
  spawn.mockReset();
  spawn.mockImplementation(() => fakePtyProc());
  scrubSaved = process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB;
  delete process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB;
});

afterEach(() => {
  if (scrubSaved === undefined) delete process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB;
  else process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = scrubSaved;
  releaseTestTempDir(dir);
});

function session(env: Record<string, string>): SessionOpts {
  return {
    provider: { kind: 'oauth', providerId: 'anthropic' },
    modelId: 'sonnet',
    cwd: dir,
    prompt: 'do the thing',
    env,
  };
}

describe('engine pty backend on a claimed host step', () => {
  test('a scrubbed subscription-bound step env spawns the pty backend with the token on fd 3', async () => {
    const { env } = assembleStepEnv({
      inherited: { CAIRN_PORT_BASE: '31000' },
      temporary: {},
      git: null,
      appCredential: null,
      readonlyGit: false,
      runtimeId: 'claude-code',
      agentConfig: { cairnHome: dir },
      claudeSubscriptionToken: 'step-subscription-token',
    });
    expect(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('1');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('step-subscription-token');

    const inner = pipeBackend();
    const backend = createClaudePtyBackend(inner.backend, {
      executablePath: '/bin/true',
      runtimeDir: dir,
    });
    const handle = await backend.createSession(session(env));

    expect(inner.createSession).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);
    const opts = spawn.mock.calls[0]?.[1];
    expect(opts?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(opts?.env?.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBeUndefined();
    expect(opts?.env?.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR).toBe('3');
    expect(opts?.env?.ANTHROPIC_API_KEY).toBe('');
    expect(opts?.fdToken).toBe('step-subscription-token');
    await handle.stop();
  });

  test('a tokenless step env spawns the pty backend with no fd token', async () => {
    const { env } = assembleStepEnv({
      inherited: { CAIRN_PORT_BASE: '31000' },
      temporary: {},
      git: null,
      appCredential: null,
      readonlyGit: false,
      runtimeId: 'claude-code',
      agentConfig: { cairnHome: dir },
      claudeSubscriptionToken: undefined,
    });
    expect(env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBeUndefined();

    const inner = pipeBackend();
    const backend = createClaudePtyBackend(inner.backend, {
      executablePath: '/bin/true',
      runtimeDir: dir,
    });
    const handle = await backend.createSession(session(env));

    expect(inner.createSession).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);
    const opts = spawn.mock.calls[0]?.[1];
    expect(opts?.env?.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR).toBeUndefined();
    expect(opts?.fdToken).toBeUndefined();
    await handle.stop();
  });

  test('a daemon itself running under a scrubbed env still falls back to pipe', async () => {
    process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1';
    const inner = pipeBackend();
    const backend = createClaudePtyBackend(inner.backend, {
      executablePath: '/bin/true',
      runtimeDir: dir,
    });
    await backend.createSession(session({}));
    expect(inner.createSession).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
  });
});
