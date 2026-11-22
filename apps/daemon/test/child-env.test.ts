import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { BoundGitCredentials } from '@cairn/shared';
import { StdioTransport } from '@earendil-works/pi-mcp';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createGeminiBackend } from '../src/backend/acp.js';
import { buildClaudeSdkOptions } from '../src/backend/claude-code.js';
import { redactingMcpTransports } from '../src/backend/mcp-log-redaction.js';
import { runtimeChildEnv } from '../src/backend/otel.js';
import { piBashEnv } from '../src/backend/pi.js';
import { childEnv } from '../src/child-env.js';
import { HostOrbProvider } from '../src/orb/provider.js';
import { assembleStepEnv, type StepEnvInput } from '../src/step-env.js';
import { runWorkspaceHook } from '../src/workspace-hooks.js';
import { testTempDir } from './test-temp-dir.js';

const DAEMON_CREDENTIALS = {
  GH_TOKEN: 'host-gh-token',
  GITHUB_TOKEN: 'host-github-token',
  ANTHROPIC_API_KEY: 'host-anthropic-key',
  ANTHROPIC_AUTH_TOKEN: 'host-anthropic-bearer',
  CAIRN_GIT_CRED_PASSWORD: 'host-git-password',
  AWS_SECRET_ACCESS_KEY: 'host-aws-secret',
  OPENAI_API_KEY: 'host-openai-key',
  CAIRN_MACHINE_TOKEN: 'host-machine-token',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: 'host-helper',
  NODE_OPTIONS: '--require /host/inject.js',
};

const PARENT = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/daemon',
  USER: 'daemon',
  LANG: 'en_US.UTF-8',
  TMPDIR: '/tmp/daemon',
  LC_ALL: 'en_US.UTF-8',
  SSH_AUTH_SOCK: '/tmp/ssh.sock',
  HTTP_PROXY: 'http://proxy:3128',
  ...DAEMON_CREDENTIALS,
};

afterEach(() => vi.unstubAllEnvs());

function envOutput(env: Record<string, string>): Record<string, string> {
  const spawned = spawnSync('env', [], { env, encoding: 'utf8' });
  expect(spawned.error).toBeUndefined();
  return Object.fromEntries(
    spawned.stdout
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)] as const;
      }),
  );
}

describe('childEnv', () => {
  test('keeps only allowlisted parent keys plus explicit extras', () => {
    const env = childEnv({ STEP_VALUE: 'step', PATH: '/step/bin' }, PARENT);
    for (const key of Object.keys(DAEMON_CREDENTIALS)) expect(env[key]).toBeUndefined();
    expect(env.STEP_VALUE).toBe('step');
    expect(env.PATH).toBe('/step/bin');
    expect(env.HOME).toBe('/home/daemon');
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.LC_ALL).toBe('en_US.UTF-8');
    expect(env.SSH_AUTH_SOCK).toBe('/tmp/ssh.sock');
    expect(env.HTTP_PROXY).toBe('http://proxy:3128');
  });

  test('an undefined extra removes an allowlisted key', () => {
    expect(childEnv({ HOME: undefined }, PARENT).HOME).toBeUndefined();
  });
});

describe('runtimeChildEnv', () => {
  test('task children see no daemon credentials but the session env and runtime basics', () => {
    const env = runtimeChildEnv(
      { TMPDIR: '/step/tmp', FOO: 'step', CLAUDE_CONFIG_DIR: '/cairn/home' },
      PARENT,
    );
    for (const key of Object.keys(DAEMON_CREDENTIALS)) expect(env[key]).toBeUndefined();
    expect(env).toMatchObject({
      PATH: PARENT.PATH,
      HOME: PARENT.HOME,
      TMPDIR: '/step/tmp',
      FOO: 'step',
      CLAUDE_CONFIG_DIR: '/cairn/home',
      OTEL_SDK_DISABLED: 'true',
    });
  });

  test('an env spawned through runtimeChildEnv contains no daemon credential', () => {
    const seen = envOutput(
      runtimeChildEnv({ TMPDIR: '/step/tmp' }, { ...PARENT, GH_TOKEN: 'daemon-token' }),
    );
    for (const key of Object.keys(DAEMON_CREDENTIALS)) expect(seen[key]).toBeUndefined();
    expect(seen.PATH).toBe(PARENT.PATH);
    expect(seen.HOME).toBe(PARENT.HOME);
  });

  test('exporter variables in the session env still cannot reach children', () => {
    const env = runtimeChildEnv(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://endpoint', CAIRN_OTEL_ENDPOINT: 'http://x' },
      PARENT,
    );
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(env.CAIRN_OTEL_ENDPOINT).toBeUndefined();
    expect(env.OTEL_SDK_DISABLED).toBe('true');
  });

  test('session children never inherit the owner SSH agent pointer', () => {
    const env = runtimeChildEnv({ TMPDIR: '/step/tmp' }, PARENT);
    expect(env.SSH_AUTH_SOCK).toBe('');
    expect(env.SSH_AGENT_PID).toBe('');
  });

  test('an App credential file still hides token variables inside the session env', () => {
    const env = runtimeChildEnv(
      { CAIRN_GIT_CRED_FILE: '/private/token', GH_TOKEN: 'inherited', GITHUB_TOKEN: 'x' },
      PARENT,
    );
    expect(env.CAIRN_GIT_CRED_FILE).toBe('/private/token');
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });
});

describe('pi task shell', () => {
  test('bash children keep session metadata and the step env but no daemon credentials', () => {
    const env = piBashEnv(
      { ...PARENT, PI_SESSION_ID: 'sess-1', PI_MODEL: 'synthetic', PI_TELEMETRY: '0' },
      { TMPDIR: '/step/tmp', CLAUDE_CONFIG_DIR: '/cairn/home' },
      '/cairn/agent',
    );
    for (const key of Object.keys(DAEMON_CREDENTIALS)) expect(env[key]).toBeUndefined();
    expect(env.PI_SESSION_ID).toBe('sess-1');
    expect(env.PI_MODEL).toBe('synthetic');
    expect(env.PI_TELEMETRY).toBeUndefined();
    expect(env.PATH?.startsWith(`${join('/cairn/agent', 'bin')}${delimiter}`)).toBe(true);
    expect(env.TMPDIR).toBe('/step/tmp');
    expect(env.OTEL_SDK_DISABLED).toBe('true');
  });
});

describe('step env per step kind', () => {
  const git: BoundGitCredentials = {
    username: 'x-access-token',
    password: 'step-password',
    url: 'https://github.com/acme/widgets.git',
  };
  const base: StepEnvInput = {
    inherited: { KEEP: '1' },
    temporary: { TMPDIR: '/step/tmp' },
    git,
    appCredential: null,
    readonlyGit: false,
    runtimeId: null,
    agentConfig: { cairnHome: '/cairn-home' },
    claudeSubscriptionToken: undefined,
  };

  test('a build step keeps the push credential it needs', () => {
    const { env } = assembleStepEnv({ ...base, readonlyGit: false });
    expect(env.GH_TOKEN).toBe('step-password');
    expect(env.GITHUB_TOKEN).toBe('step-password');
    expect(env.CAIRN_GIT_CRED_PASSWORD).toBe('step-password');
    expect(Number(env.GIT_CONFIG_COUNT)).toBeGreaterThan(0);
  });

  test('a verify step gets no push credential, only the push denial', () => {
    const { env } = assembleStepEnv({ ...base, readonlyGit: true });
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.CAIRN_GIT_CRED_PASSWORD).toBeUndefined();
    expect(env.CAIRN_GIT_CRED_FILE).toBeUndefined();
    expect(env.GH_CONFIG_DIR).toBeUndefined();
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('url.cairn-readonly-workspace-denied://.pushInsteadOf');
    expect(env.GIT_CONFIG_VALUE_0).toBe('');
  });

  test('an App credential verify step gets no credential helper either', () => {
    const { env } = assembleStepEnv({
      ...base,
      readonlyGit: true,
      appCredential: {
        env: () => ({ GH_CONFIG_DIR: '/step/gh', CAIRN_GIT_CRED_FILE: '/step/token' }),
      },
    });
    expect(env.GH_CONFIG_DIR).toBeUndefined();
    expect(env.CAIRN_GIT_CRED_FILE).toBeUndefined();
    expect(env.GH_TOKEN).toBeUndefined();
  });
});

describe('MCP subprocesses', () => {
  test('a stdio MCP server gets the allowlist env and cannot inherit daemon credentials', () => {
    vi.stubEnv('GH_TOKEN', 'daemon-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'daemon-key');
    const transport = redactingMcpTransports((value) => value)(
      {
        name: 'probe',
        source: 'extension',
        config: {
          type: 'stdio',
          command: 'server',
          args: ['--flag'],
          env: { MCP_SERVER_KEY: 'declared' },
        },
      },
      '/work',
      undefined,
    );
    if (!(transport instanceof StdioTransport)) throw new Error('expected a stdio transport');
    expect(transport.options.inheritEnv).toBe(false);
    expect(transport.options.env?.MCP_SERVER_KEY).toBe('declared');
    expect(transport.options.env?.GH_TOKEN).toBeUndefined();
    expect(transport.options.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(transport.options.env?.PATH).toBe(process.env.PATH);
    expect(transport.options.env?.HOME).toBe(process.env.HOME);
  });
});

describe('spawn sites', () => {
  test('a workspace hook receives the allowlist env plus explicit git credentials', async () => {
    vi.stubEnv('GH_TOKEN', 'daemon-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'daemon-key');
    const root = testTempDir('cairn-hook-env-');
    const script = join(root, '.agents');
    mkdirSync(script, { recursive: true });
    writeFileSync(join(script, 'setup'), '#!/bin/sh\nenv\n');
    chmodSync(join(script, 'setup'), 0o755);
    const note = await runWorkspaceHook({
      cwd: root,
      name: 'setup',
      credentials: {
        username: 'x-access-token',
        password: 'step-password',
        url: 'https://github.com/acme/widgets.git',
      },
      timeoutMs: 15_000,
      log: () => {},
    });
    const seen = envOutputFromText(note?.output ?? '');
    expect(seen.GH_TOKEN).toBeUndefined();
    expect(seen.ANTHROPIC_API_KEY).toBeUndefined();
    expect(seen.CAIRN_GIT_CRED_PASSWORD).toBe('step-password');
    expect(seen.GIT_CONFIG_COUNT).toBe('2');
    expect(seen.PATH).toBe(process.env.PATH);
    expect(seen.HOME).toBe(process.env.HOME);
  });

  test('a host orb exec child receives the allowlist env and explicit options only', async () => {
    vi.stubEnv('GH_TOKEN', 'daemon-token');
    const captured: NodeJS.ProcessEnv[] = [];
    const host = new HostOrbProvider(async (_argv, options) => {
      captured.push(options?.env ?? {});
      return { code: 0, stdout: '', stderr: '' };
    });
    const handle = await host.ensure({ conversationId: 'C', projectId: 'P' });
    await host.exec(handle, ['env'], { env: { STEP_ONLY: '1' } });
    expect(captured[0]?.GH_TOKEN).toBeUndefined();
    expect(captured[0]?.STEP_ONLY).toBe('1');
    expect(captured[0]?.PATH).toBe(process.env.PATH);
  });

  test('an ACP child receives the session env and allowlist basics, not daemon credentials', async () => {
    vi.stubEnv('GH_TOKEN', 'daemon-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'daemon-key');
    let captured: NodeJS.ProcessEnv | undefined;
    const agent = createGeminiBackend({
      executablePath: 'gemini',
      spawnProcess: (_command, _args, options) => {
        captured = options.env;
        throw new Error('captured environment');
      },
    });
    await expect(
      agent.createSession({
        cwd: '/tmp/ws',
        provider: { kind: 'api_key', providerId: 'gemini' },
        modelId: 'flash',
        prompt: 'turn',
        env: { GEMINI_API_KEY: 'step-key' },
      }),
    ).rejects.toThrow('captured environment');
    expect(captured?.GH_TOKEN).toBeUndefined();
    expect(captured?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(captured?.GEMINI_API_KEY).toBe('step-key');
    expect(captured?.OTEL_SDK_DISABLED).toBe('true');
    expect(captured?.PATH).toBe(process.env.PATH);
  });

  test('the Claude SDK env carries the session env and allowlist basics, not daemon credentials', () => {
    vi.stubEnv('GH_TOKEN', 'daemon-token');
    vi.stubEnv('ANTHROPIC_API_KEY', 'daemon-key');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'daemon-bearer');
    const options = buildClaudeSdkOptions({
      cwd: '/tmp/ws',
      modelId: 'sonnet',
      resumeId: null,
      sessionId: 'env-test',
      disallowedTools: [],
      mcpServers: {},
      inOrb: false,
      lockedDown: false,
      abortController: new AbortController(),
      env: { CLAUDE_CONFIG_DIR: '/cairn/home', FOO: 'step' },
    });
    expect(options.env?.GH_TOKEN).toBeUndefined();
    expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(options.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(options.env?.FOO).toBe('step');
    expect(options.env?.CLAUDE_CONFIG_DIR).toBe('/cairn/home');
    expect(options.env?.PATH).toBe(process.env.PATH);
  });
});

function envOutputFromText(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)] as const;
      }),
  );
}
