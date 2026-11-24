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
import { assembleStepEnv, type StepEnvInput } from '../src/step-env.js';
import { runWorkspaceHook } from '../src/workspace-hooks.js';
import { testTempDir } from './test-temp-dir.js';

const CAIRN_INTERNAL_ENV = {
  CAIRN_TOKEN: 'daemon-token',
  CAIRN_API_KEY: 'daemon-api-key',
  CAIRN_MACHINE_TOKEN: 'host-machine-token',
  CAIRN_GIT_CRED_PASSWORD: 'host-git-password',
  CAIRN_OTEL_ENDPOINT: 'http://collector',
  OTEL_EXPORTER_OTLP_HEADERS: 'auth=x',
};

const HOST_USER_ENV = {
  GH_TOKEN: 'host-gh-token',
  GITHUB_TOKEN: 'host-github-token',
  GH_CONFIG_DIR: '/Users/dev/.config/gh',
  ANTHROPIC_API_KEY: 'host-anthropic-key',
  AWS_SECRET_ACCESS_KEY: 'host-aws-secret',
  OPENAI_API_KEY: 'host-openai-key',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'credential.helper',
  GIT_CONFIG_VALUE_0: 'osxkeychain',
};

const PARENT = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/daemon',
  USER: 'daemon',
  LANG: 'en_US.UTF-8',
  TMPDIR: '/tmp/daemon',
  LC_ALL: 'en_US.UTF-8',
  SSH_AUTH_SOCK: '/tmp/ssh.sock',
  SSH_AGENT_PID: '1234',
  HTTP_PROXY: 'http://proxy:3128',
  ...CAIRN_INTERNAL_ENV,
  ...HOST_USER_ENV,
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
  test('inherits host env including git/gh credentials while stripping Cairn internal keys', () => {
    const env = childEnv({ STEP_VALUE: 'step', PATH: '/step/bin' }, PARENT);
    for (const key of Object.keys(CAIRN_INTERNAL_ENV)) expect(env[key]).toBeUndefined();
    for (const [key, value] of Object.entries(HOST_USER_ENV)) expect(env[key]).toBe(value);
    expect(env.STEP_VALUE).toBe('step');
    expect(env.PATH).toBe('/step/bin');
    expect(env.HOME).toBe('/home/daemon');
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.LC_ALL).toBe('en_US.UTF-8');
    expect(env.SSH_AUTH_SOCK).toBe('/tmp/ssh.sock');
    expect(env.SSH_AGENT_PID).toBe('1234');
    expect(env.HTTP_PROXY).toBe('http://proxy:3128');
  });

  test('an undefined extra removes an inherited key', () => {
    expect(childEnv({ HOME: undefined }, PARENT).HOME).toBeUndefined();
  });

  test('preserves login-shell toolchain variables without leaking daemon credentials', () => {
    const toolchainParent = {
      ...PARENT,
      FNM_DIR: '/home/daemon/.local/share/fnm',
      FNM_MULTISHELL_PATH: '/home/daemon/.local/state/fnm_multishells/1',
      NVM_DIR: '/home/daemon/.nvm',
      VOLTA_HOME: '/home/daemon/.volta',
      PNPM_HOME: '/home/daemon/.local/share/pnpm',
      HOMEBREW_PREFIX: '/opt/homebrew',
      MISE_DATA_DIR: '/home/daemon/.local/share/mise',
      GOPATH: '/home/daemon/go',
      CARGO_HOME: '/home/daemon/.cargo',
      PYENV_ROOT: '/home/daemon/.pyenv',
    };
    const env = childEnv({}, toolchainParent);
    expect(env.FNM_DIR).toBe('/home/daemon/.local/share/fnm');
    expect(env.FNM_MULTISHELL_PATH).toBe('/home/daemon/.local/state/fnm_multishells/1');
    expect(env.NVM_DIR).toBe('/home/daemon/.nvm');
    expect(env.VOLTA_HOME).toBe('/home/daemon/.volta');
    expect(env.PNPM_HOME).toBe('/home/daemon/.local/share/pnpm');
    expect(env.HOMEBREW_PREFIX).toBe('/opt/homebrew');
    expect(env.MISE_DATA_DIR).toBe('/home/daemon/.local/share/mise');
    expect(env.GOPATH).toBe('/home/daemon/go');
    expect(env.CARGO_HOME).toBe('/home/daemon/.cargo');
    expect(env.PYENV_ROOT).toBe('/home/daemon/.pyenv');
    for (const key of Object.keys(DAEMON_CREDENTIALS)) expect(env[key]).toBeUndefined();
  });

});

describe('runtimeChildEnv', () => {
  test('task children inherit host git/gh/ssh env while Cairn internal and OTel keys stay stripped', () => {
    const env = runtimeChildEnv(
      { TMPDIR: '/step/tmp', FOO: 'step', CLAUDE_CONFIG_DIR: '/cairn/home' },
      PARENT,
    );
    for (const key of Object.keys(CAIRN_INTERNAL_ENV)) expect(env[key]).toBeUndefined();
    expect(env).toMatchObject({
      PATH: PARENT.PATH,
      HOME: PARENT.HOME,
      GH_TOKEN: PARENT.GH_TOKEN,
      GITHUB_TOKEN: PARENT.GITHUB_TOKEN,
      GH_CONFIG_DIR: PARENT.GH_CONFIG_DIR,
      SSH_AUTH_SOCK: PARENT.SSH_AUTH_SOCK,
      SSH_AGENT_PID: PARENT.SSH_AGENT_PID,
      TMPDIR: '/step/tmp',
      FOO: 'step',
      CLAUDE_CONFIG_DIR: '/cairn/home',
      OTEL_SDK_DISABLED: 'true',
    });
  });

  test('an env spawned through runtimeChildEnv preserves host GH_TOKEN and drops Cairn internal tokens', () => {
    const seen = envOutput(
      runtimeChildEnv({ TMPDIR: '/step/tmp' }, { ...PARENT, GH_TOKEN: 'host-gh-token' }),
    );
    for (const key of Object.keys(CAIRN_INTERNAL_ENV)) expect(seen[key]).toBeUndefined();
    expect(seen.GH_TOKEN).toBe('host-gh-token');
    expect(seen.SSH_AUTH_SOCK).toBe(PARENT.SSH_AUTH_SOCK);
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
});

describe('pi task shell', () => {
  test('bash children keep session metadata and host git/gh env while dropping Cairn internal keys', () => {
    const env = piBashEnv(
      { ...PARENT, PI_SESSION_ID: 'sess-1', PI_MODEL: 'synthetic', PI_TELEMETRY: '0' },
      { TMPDIR: '/step/tmp', CLAUDE_CONFIG_DIR: '/cairn/home' },
      '/cairn/agent',
    );
    for (const key of Object.keys(CAIRN_INTERNAL_ENV)) expect(env[key]).toBeUndefined();
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
    url: 'http://127.0.0.1:3000/git/acme/widgets.git',
  };
  const base: StepEnvInput = {
    inherited: { KEEP: '1' },
    temporary: { TMPDIR: '/step/tmp' },
    git,
    readonlyGit: false,
    runtimeId: null,
    agentConfig: { cairnHome: '/cairn-home' },
    claudeSubscriptionToken: undefined,
  };

  test('a hosted repo build step injects git credentials without overriding GH_TOKEN', () => {
    const { env } = assembleStepEnv({ ...base, readonlyGit: false });
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.CAIRN_GIT_CRED_PASSWORD).toBe('step-password');
    expect(Number(env.GIT_CONFIG_COUNT)).toBeGreaterThan(0);
  });

  test('an external repo build step injects no git or gh credential override', () => {
    const { env } = assembleStepEnv({ ...base, git: null, readonlyGit: false });
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.CAIRN_GIT_CRED_PASSWORD).toBeUndefined();
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
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
});

describe('MCP subprocesses', () => {
  test('a stdio MCP server inherits host env minus Cairn internal keys', () => {
    vi.stubEnv('GH_TOKEN', 'host-gh-token');
    vi.stubEnv('CAIRN_TOKEN', 'daemon-secret');
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
    expect(transport.options.env?.GH_TOKEN).toBe('host-gh-token');
    expect(transport.options.env?.CAIRN_TOKEN).toBeUndefined();
    expect(transport.options.env?.PATH).toBe(process.env.PATH);
    expect(transport.options.env?.HOME).toBe(process.env.HOME);
  });
});

describe('spawn sites', () => {
  test('a workspace hook inherits host git/gh credentials and explicit hosted credentials', async () => {
    vi.stubEnv('GH_TOKEN', 'host-gh-token');
    vi.stubEnv('CAIRN_TOKEN', 'daemon-secret');
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
        url: 'http://127.0.0.1:3000/git/acme/widgets.git',
      },
      timeoutMs: 15_000,
      log: () => {},
    });
    const seen = envOutputFromText(note?.output ?? '');
    expect(seen.GH_TOKEN).toBe('host-gh-token');
    expect(seen.CAIRN_TOKEN).toBeUndefined();
    expect(seen.CAIRN_GIT_CRED_PASSWORD).toBe('step-password');
    expect(seen.GIT_CONFIG_COUNT).toBe('2');
    expect(seen.PATH).toBe(process.env.PATH);
    expect(seen.HOME).toBe(process.env.HOME);
  });

  test('an ACP child inherits host git/gh env while dropping Cairn internal tokens', async () => {
    vi.stubEnv('GH_TOKEN', 'host-gh-token');
    vi.stubEnv('CAIRN_TOKEN', 'daemon-secret');
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
    expect(captured?.GH_TOKEN).toBe('host-gh-token');
    expect(captured?.CAIRN_TOKEN).toBeUndefined();
    expect(captured?.GEMINI_API_KEY).toBe('step-key');
    expect(captured?.OTEL_SDK_DISABLED).toBe('true');
    expect(captured?.PATH).toBe(process.env.PATH);
  });

  test('the Claude SDK env inherits host git/gh env while dropping Cairn internal tokens', () => {
    vi.stubEnv('GH_TOKEN', 'host-gh-token');
    vi.stubEnv('CAIRN_TOKEN', 'daemon-secret');
    const options = buildClaudeSdkOptions({
      cwd: '/tmp/ws',
      modelId: 'sonnet',
      resumeId: null,
      sessionId: 'env-test',
      disallowedTools: [],
      mcpServers: {},
      lockedDown: false,
      abortController: new AbortController(),
      env: { CLAUDE_CONFIG_DIR: '/cairn/home', FOO: 'step' },
    });
    expect(options.env?.GH_TOKEN).toBe('host-gh-token');
    expect(options.env?.CAIRN_TOKEN).toBeUndefined();
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
