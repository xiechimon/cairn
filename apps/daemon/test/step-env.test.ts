import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { BoundGitCredentials } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { assembleStepEnv, prepareStepEnv, type StepEnvInput } from '../src/step-env.js';
import { testTempDir } from './test-temp-dir.js';

const git: BoundGitCredentials = {
  username: 'x-access-token',
  password: 'step-password',
  url: 'https://github.com/acme/widgets.git',
};

function input(patch: Partial<StepEnvInput> = {}): StepEnvInput {
  return {
    inherited: undefined,
    temporary: {},
    git: null,
    appCredential: null,
    readonlyGit: false,
    runtimeId: null,
    agentConfig: { cairnHome: '/cairn-home' },
    claudeSubscriptionToken: undefined,
    ...patch,
  };
}

describe('assembleStepEnv', () => {
  test('is empty when the step has nothing to pass', () => {
    expect(assembleStepEnv(input()).env).toEqual({});
  });

  test('temporary values win over inherited ones', () => {
    const { env } = assembleStepEnv(
      input({ inherited: { TMPDIR: '/host', KEEP: '1' }, temporary: { TMPDIR: '/step' } }),
    );
    expect(env).toEqual({ TMPDIR: '/step', KEEP: '1' });
  });

  test('a token credential reaches git and gh, and is dropped on cleanup', () => {
    const step = assembleStepEnv(input({ inherited: { KEEP: '1' }, git }));
    expect(step.env.GH_TOKEN).toBe('step-password');
    expect(step.env.GITHUB_TOKEN).toBe('step-password');
    expect(step.env.CAIRN_GIT_CRED_PASSWORD).toBe('step-password');
    expect(Number(step.env.GIT_CONFIG_COUNT)).toBeGreaterThan(0);
    step.dropGitCredentials();
    expect(step.env).toEqual({ KEEP: '1' });
  });

  test('an App credential supplies its own env and never exposes a token variable', () => {
    const step = assembleStepEnv(
      input({
        inherited: { GH_TOKEN: 'host', GITHUB_TOKEN: 'host', CAIRN_GIT_CRED_PASSWORD: 'host' },
        git,
        appCredential: {
          env: () => ({ GH_CONFIG_DIR: '/step/gh', CAIRN_GIT_CRED_PASSWORD: 'app' }),
        },
      }),
    );
    expect(step.env).toEqual({ GH_CONFIG_DIR: '/step/gh' });
    step.dropGitCredentials();
    expect(step.env).toEqual({});
  });

  test('a read-only workspace overrides the git config with the push denial', () => {
    const { env } = assembleStepEnv(input({ git, readonlyGit: true }));
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('url.cairn-readonly-workspace-denied://.pushInsteadOf');
    expect(env.GIT_CONFIG_VALUE_0).toBe('');
    expect(env.GIT_CONFIG_GLOBAL).toBe(process.platform === 'win32' ? 'NUL' : '/dev/null');
    expect(env.GIT_CONFIG_SYSTEM).toBe(process.platform === 'win32' ? 'NUL' : '/dev/null');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_ASKPASS).toBe('false');
    expect(env.SSH_ASKPASS).toBe('false');
    expect(env.GIT_SSH_COMMAND).toBe('false');
    expect(env.SSH_AUTH_SOCK).toBe('');
    expect(env.SSH_AGENT_PID).toBe('');
  });

  test('a read-only workspace cannot recover push credentials from injected git config', () => {
    const { env } = assembleStepEnv(input({ git, readonlyGit: true }));
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.CAIRN_GIT_CRED_PASSWORD).toBeUndefined();
  });

  test('an inherited subscription token is removed', () => {
    const { env } = assembleStepEnv(input({ inherited: { CLAUDE_CODE_OAUTH_TOKEN: 'host' } }));
    expect(env).toEqual({});
  });

  test('the step subscription token replaces it and scrubs subprocesses on the host', () => {
    const { env } = assembleStepEnv(
      input({ inherited: { CLAUDE_CODE_OAUTH_TOKEN: 'host' }, claudeSubscriptionToken: 'step' }),
    );
    expect(env).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'step',
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    });
  });

  test('inside an Orb guest the subprocess scrub stays off', () => {
    const { env } = assembleStepEnv(
      input({ inherited: { CAIRN_ORB: '1' }, claudeSubscriptionToken: 'step' }),
    );
    expect(env).toEqual({ CAIRN_ORB: '1', CLAUDE_CODE_OAUTH_TOKEN: 'step' });
  });

  test('only a Claude Code Coordinator step gets the idle-compaction threshold', () => {
    expect(assembleStepEnv(input({ claudeCodeCoordinator: true })).env).toEqual({
      CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '100000',
    });
    expect(assembleStepEnv(input({ claudeCodeCoordinator: false })).env).toEqual({});
    expect(assembleStepEnv(input()).env).toEqual({});
  });

  test('a managed devin step replaces HOME and the token', () => {
    const { env } = assembleStepEnv(
      input({
        inherited: { WINDSURF_API_KEY: 'host', HOME: '/Users/real' },
        runtimeId: 'devin',
        devinToken: 'step-token',
        devinHome: '/managed/devin/home',
      }),
    );
    expect(env.HOME).toBe('/managed/devin/home');
    expect(env.WINDSURF_API_KEY).toBe('step-token');
  });

  test('a managed devin step scrubs session vars a devin host shell leaks', () => {
    const { env } = assembleStepEnv(
      input({
        inherited: {
          CHISEL_SESSION_DB: '/Users/real/.local/share/devin/cli/sessions.db',
          DEVIN_TRACEPARENT: '00-trace',
          KEEP: '1',
        },
        runtimeId: 'devin',
        devinHome: '/managed/devin/home',
      }),
    );
    expect(env).toEqual({ HOME: '/managed/devin/home', KEEP: '1' });
  });
});

describe('agent config isolation', () => {
  test('Claude Code uses the Cairn config dir even when the user set CLAUDE_CONFIG_DIR', () => {
    const { env } = assembleStepEnv(
      input({
        inherited: { CLAUDE_CONFIG_DIR: '/Users/real/.claude-work' },
        runtimeId: 'claude-code',
      }),
    );
    expect(env.CLAUDE_CONFIG_DIR).toBe(join('/cairn-home', 'homes', 'claude'));
  });

  test('an Orb guest keeps the image config, whose Claude settings the sandbox needs', () => {
    const { env } = assembleStepEnv(
      input({ inherited: { CAIRN_ORB: '1' }, runtimeId: 'claude-code' }),
    );
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  test('Antigravity gets a Cairn HOME whose sign-in links follow the user file', () => {
    const root = realpathSync(testTempDir('agent-home-'));
    const realHome = join(root, 'real');
    const tokenFile = join(realHome, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
    mkdirSync(join(realHome, '.gemini', 'antigravity-cli', 'skills'), { recursive: true });
    mkdirSync(join(realHome, '.gemini', 'config'), { recursive: true });
    writeFileSync(join(realHome, '.gemini', 'config', 'hooks.json'), '{"hooks":[]}');
    writeFileSync(join(realHome, '.gemini', 'GEMINI.md'), 'user rules');
    writeFileSync(
      join(realHome, '.gemini', 'antigravity-cli', 'settings.json'),
      JSON.stringify({ gcp: { project: 'p1' }, agentMode: 'auto', modelProvider: 'gemini' }),
    );
    writeFileSync(tokenFile, 'token-v1');
    const step = () =>
      assembleStepEnv(
        input({
          inherited: { HOME: realHome },
          runtimeId: 'antigravity',
          agentConfig: { cairnHome: join(root, 'cairn'), realHome },
        }),
      ).env;

    const home = step().HOME ?? '';
    expect(home.startsWith(join(root, 'cairn'))).toBe(true);
    const linked = join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
    expect(readFileSync(linked, 'utf8')).toBe('token-v1');
    expect(existsSync(join(home, '.gemini', 'config', 'hooks.json'))).toBe(false);
    expect(existsSync(join(home, '.gemini', 'GEMINI.md'))).toBe(false);
    expect(existsSync(join(home, '.gemini', 'antigravity-cli', 'skills'))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(home, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8')),
    ).toEqual({ gcp: { project: 'p1' } });
    expect(
      JSON.parse(readFileSync(join(home, '.gemini', 'antigravity-acp', 'settings.json'), 'utf8')),
    ).toEqual({ auth: { type: 'oauth-personal' } });

    writeFileSync(`${tokenFile}.new`, 'token-v2');
    renameSync(`${tokenFile}.new`, tokenFile);
    expect(readFileSync(linked, 'utf8')).toBe('token-v2');

    rmSync(linked);
    writeFileSync(linked, 'stale copy written by a refresh');
    expect(step().HOME).toBe(home);
    expect(lstatSync(linked).isSymbolicLink()).toBe(true);
    expect(readFileSync(linked, 'utf8')).toBe('token-v2');

    rmSync(tokenFile);
    step();
    expect(existsSync(linked)).toBe(false);
    expect(lstatSync(join(home, '.gemini', 'antigravity-cli')).isDirectory()).toBe(true);
  });

  test('an Antigravity API key step gets its own HOME with the Gemini provider and no sign-in', () => {
    const root = realpathSync(testTempDir('agent-home-'));
    const realHome = join(root, 'real');
    mkdirSync(join(realHome, '.gemini', 'antigravity-cli'), { recursive: true });
    writeFileSync(join(realHome, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'), 't');
    const { env } = assembleStepEnv(
      input({
        runtimeId: 'antigravity',
        antigravityToken: 'AIza-step',
        agentConfig: { cairnHome: join(root, 'cairn'), realHome },
      }),
    );
    const home = env.HOME ?? '';
    expect(env.GEMINI_API_KEY).toBe('AIza-step');
    expect(env.GEMINI_HOME).toBeUndefined();
    expect(
      JSON.parse(readFileSync(join(home, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8')),
    ).toEqual({ modelProvider: 'gemini' });
    expect(
      JSON.parse(readFileSync(join(home, '.gemini', 'antigravity-acp', 'settings.json'), 'utf8')),
    ).toEqual({ auth: { type: 'gemini-api-key' } });
    expect(existsSync(join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'))).toBe(
      false,
    );
  });

  test('Gemini CLI gets a Cairn GEMINI_CLI_HOME with the sign-in and auth type only', () => {
    const root = realpathSync(testTempDir('agent-home-'));
    const realHome = join(root, 'real');
    mkdirSync(join(realHome, '.gemini'), { recursive: true });
    writeFileSync(join(realHome, '.gemini', 'oauth_creds.json'), '{"refresh_token":"r"}');
    writeFileSync(
      join(realHome, '.gemini', 'settings.json'),
      JSON.stringify({
        security: { auth: { selectedType: 'oauth-personal' } },
        mcpServers: { mine: { command: 'x' } },
        hooks: { BeforeTool: [] },
      }),
    );
    const { env } = assembleStepEnv(
      input({
        runtimeId: 'gemini',
        agentConfig: { cairnHome: join(root, 'cairn'), realHome },
      }),
    );
    const home = env.GEMINI_CLI_HOME ?? '';
    expect(readFileSync(join(home, '.gemini', 'oauth_creds.json'), 'utf8')).toContain('"r"');
    expect(JSON.parse(readFileSync(join(home, '.gemini', 'settings.json'), 'utf8'))).toEqual({
      security: { auth: { selectedType: 'oauth-personal' } },
    });
  });

  test('links an agent planted in its Cairn home never redirect the next setup outside it', () => {
    const root = realpathSync(testTempDir('agent-home-'));
    const realHome = join(root, 'real');
    const secret = join(root, 'secret.json');
    const realSettings = join(realHome, '.gemini', 'settings.json');
    const realCreds = join(realHome, '.gemini', 'oauth_creds.json');
    mkdirSync(join(realHome, '.gemini'), { recursive: true });
    writeFileSync(realCreds, '{"refresh_token":"r"}');
    writeFileSync(realSettings, '{"security":{"auth":{"selectedType":"oauth-personal"}}}');
    writeFileSync(secret, '{"auths":{"registry":"docker-secret"}}');
    const step = () =>
      assembleStepEnv(
        input({
          runtimeId: 'gemini',
          agentConfig: { cairnHome: join(root, 'cairn'), realHome },
        }),
      ).env.GEMINI_CLI_HOME ?? '';
    const home = step();

    rmSync(join(home, '.gemini', 'settings.json'));
    symlinkSync(secret, join(home, '.gemini', 'settings.json'));
    step();
    expect(readFileSync(join(home, '.gemini', 'settings.json'), 'utf8')).not.toContain(
      'docker-secret',
    );
    expect(readFileSync(secret, 'utf8')).toContain('docker-secret');

    rmSync(join(home, '.gemini'), { recursive: true });
    symlinkSync(join(realHome, '.gemini'), join(home, '.gemini'));
    step();
    expect(lstatSync(join(home, '.gemini')).isSymbolicLink()).toBe(false);
    expect(lstatSync(realCreds).isSymbolicLink()).toBe(false);
    expect(readFileSync(realCreds, 'utf8')).toContain('"r"');
    expect(readFileSync(realSettings, 'utf8')).toContain('oauth-personal');

    rmSync(join(home, '.gemini', 'oauth_creds.json'));
    mkdirSync(join(home, '.gemini', 'oauth_creds.json'));
    expect(step()).toBe(home);
    expect(readFileSync(join(home, '.gemini', 'oauth_creds.json'), 'utf8')).toContain('"r"');
  });
});

describe('prepareStepEnv', () => {
  test('creates a step temp directory, passes git through and registers both cleanups', async () => {
    const cleanups: (() => void | Promise<void>)[] = [];
    const { temporary: _, ...rest } = input({ inherited: { KEEP: '1' }, git });
    const prepared = prepareStepEnv(rest, cleanups);
    if ('error' in prepared) throw new Error(prepared.error);
    expect(prepared.env.KEEP).toBe('1');
    expect(prepared.env.GH_TOKEN).toBe('step-password');
    expect(prepared.env.TMPDIR).toBeTruthy();
    expect(cleanups).toHaveLength(2);
    for (const cleanup of [...cleanups].reverse()) await cleanup();
    expect(prepared.env.GH_TOKEN).toBeUndefined();
  });
});
