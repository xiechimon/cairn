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
import { dirname, join } from 'node:path';
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

  test('a hosted git credential reaches git without overriding GH_TOKEN and is dropped on cleanup', () => {
    const step = assembleStepEnv(input({ inherited: { KEEP: '1' }, git }));
    expect(step.env.GH_TOKEN).toBeUndefined();
    expect(step.env.GITHUB_TOKEN).toBeUndefined();
    expect(step.env.CAIRN_GIT_CRED_PASSWORD).toBe('step-password');
    expect(Number(step.env.GIT_CONFIG_COUNT)).toBeGreaterThan(0);
    step.dropGitCredentials();
    expect(step.env).toEqual({ KEEP: '1' });
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

  test('the step subscription token replaces it without setting subprocess env scrub', () => {
    const { env } = assembleStepEnv(
      input({ inherited: { CLAUDE_CODE_OAUTH_TOKEN: 'host' }, claudeSubscriptionToken: 'step' }),
    );
    expect(env).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'step',
    });
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
          inherited: {
            HOME: realHome,
            GEMINI_HOME: '/host/.gemini',
            GEMINI_CLI_HOME: '/host/cli',
          },
          runtimeId: 'antigravity',
          agentConfig: { cairnHome: join(root, 'cairn'), realHome },
        }),
      ).env;

    expect(step().CAIRN_ANTIGRAVITY_AUTH_MODE).toBe('host');
    expect(step().GEMINI_HOME).toBeUndefined();
    expect(step().GEMINI_CLI_HOME).toBeUndefined();
    expect(step().AGY_ACP_FORCE_FILE_STORAGE).toBe('1');
    expect(step().AGY_CLI_FORCE_FILE_TOKEN_STORAGE).toBe('1');
    const home = step().HOME ?? '';
    expect(home.startsWith(join(root, 'cairn'))).toBe(true);
    expect(existsSync(join(home, 'Library', 'Keychains'))).toBe(false);
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

  test('a host Antigravity step materializes antigravity-cli/antigravity-oauth-token from acp_token.json when the cli token file is absent', () => {
    const root = realpathSync(testTempDir('agent-home-acp-'));
    const realHome = join(root, 'real');
    mkdirSync(join(realHome, '.gemini', 'antigravity-acp'), { recursive: true });
    writeFileSync(
      join(realHome, '.gemini', 'antigravity-acp', 'acp_token.json'),
      JSON.stringify({
        access_token: 'ya29.host-acp-access',
        refresh_token: '1//0g-host-acp-refresh',
        expiry: '2099-01-01T00:00:00Z',
      }),
    );
    const { env } = assembleStepEnv(
      input({
        inherited: { HOME: realHome },
        runtimeId: 'antigravity',
        agentConfig: { cairnHome: join(root, 'cairn'), realHome },
      }),
    );
    const home = env.HOME ?? '';
    for (const dir of ['antigravity-cli', 'antigravity-acp']) {
      const tokenPath = join(home, '.gemini', dir, 'antigravity-oauth-token');
      expect(existsSync(tokenPath)).toBe(true);
      expect(lstatSync(tokenPath).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(tokenPath, 'utf8'))).toEqual({
        token: {
          access_token: 'ya29.host-acp-access',
          token_type: 'Bearer',
          refresh_token: '1//0g-host-acp-refresh',
          expiry: '2099-01-01T00:00:00Z',
        },
        auth_method: 'consumer',
      });
    }
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
    expect(env.CAIRN_ANTIGRAVITY_AUTH_MODE).toBe('gemini-api-key');
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

  test('Antigravity OAuth steps keep the bound account outside ordinary task scratch and clean it up', async () => {
    const root = realpathSync(testTempDir('antigravity-oauth-'));
    const appData = join(root, 'daemon');
    const cleanups: (() => void | Promise<void>)[] = [];
    const token = 'ya29.fake-bound-account-token';
    const expiresAt = Date.now() + 60_000;
    const step = prepareStepEnv(
      input({
        runtimeId: 'antigravity',
        agentConfig: { cairnHome: appData },
        antigravityToken: JSON.stringify({ kind: 'oauth-personal', token, expiresAt }),
        inherited: {
          HOME: '/host',
          CAIRN_ANTIGRAVITY_AUTH_MODE: 'host',
          GEMINI_HOME: '/host/.gemini',
          GEMINI_CLI_HOME: '/host/cli-config',
          XDG_DATA_HOME: '/host/share',
          CAIRN_TEST_TEMP_ROOT: join(root, 'scratch'),
          GEMINI_API_KEY: 'host-key',
          GOOGLE_API_KEY: 'host-google-key',
          GOOGLE_APPLICATION_CREDENTIALS: '/host/ambient.json',
        },
      }),
      cleanups,
    );
    if ('error' in step) throw new Error(step.error);
    const home = step.env.HOME!;
    const geminiHome = join(home, '.gemini');
    expect(dirname(dirname(home))).toBe(join(appData, 'credential-profiles'));
    expect(lstatSync(home).mode & 0o777).toBe(0o700);
    expect(step.env).toMatchObject({
      GEMINI_HOME: geminiHome,
      GEMINI_CLI_HOME: home,
      XDG_DATA_HOME: join(home, '.local', 'share'),
      AGY_ACP_FORCE_FILE_STORAGE: '1',
      CAIRN_ANTIGRAVITY_AUTH_MODE: 'oauth-personal',
    });
    expect(step.env.GEMINI_API_KEY).toBeUndefined();
    expect(step.env.GOOGLE_API_KEY).toBeUndefined();
    expect(step.env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(Object.values(step.env)).not.toContain(token);
    const file = join(geminiHome, 'antigravity-acp', 'antigravity-oauth-token');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      token: { access_token: token, expiry: new Date(expiresAt).toISOString() },
    });
    expect(lstatSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(join(home, 'Library', 'Keychains'))).toBe(false);
    for (const cleanup of cleanups.reverse()) await cleanup();
    expect(existsSync(home)).toBe(false);
  });

  test('expired Antigravity OAuth never falls back to the host login', () => {
    const token = 'ya29.fake-expired-account-token';
    const opts = input({
      runtimeId: 'antigravity',
      antigravityToken: JSON.stringify({
        kind: 'oauth-personal',
        token,
        expiresAt: Date.now() - 1,
      }),
      temporary: { TMPDIR: testTempDir('antigravity-oauth-expired-') },
    });
    expect(() => assembleStepEnv(opts)).toThrow('Antigravity OAuth access token expired');
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
  test('creates a step temp directory, passes hosted git through and registers both cleanups', async () => {
    const cleanups: (() => void | Promise<void>)[] = [];
    const { temporary: _, ...rest } = input({ inherited: { KEEP: '1' }, git });
    const prepared = prepareStepEnv(rest, cleanups);
    if ('error' in prepared) throw new Error(prepared.error);
    expect(prepared.env.KEEP).toBe('1');
    expect(prepared.env.CAIRN_GIT_CRED_PASSWORD).toBe('step-password');
    expect(prepared.env.TMPDIR).toBeTruthy();
    expect(cleanups).toHaveLength(2);
    for (const cleanup of [...cleanups].reverse()) await cleanup();
    expect(prepared.env.CAIRN_GIT_CRED_PASSWORD).toBeUndefined();
  });

  test('reuses a deterministic refcounted credential profile path per Antigravity OAuth refreshToken and deletes it once all holders clean up', async () => {
    const root = realpathSync(testTempDir('agy-stable-oauth-'));
    const appData = join(root, 'daemon');
    const makeOpts = (refreshToken: string) =>
      input({
        runtimeId: 'antigravity',
        agentConfig: { cairnHome: appData },
        antigravityToken: JSON.stringify({
          kind: 'oauth-personal',
          refreshToken,
          authMethod: 'consumer',
        }),
      });

    const cleanups1: (() => void | Promise<void>)[] = [];
    const first = prepareStepEnv(makeOpts(`1//0gAccountAlpha_${'a'.repeat(20)}`), cleanups1);
    if ('error' in first) throw new Error(first.error);

    const cleanups2: (() => void | Promise<void>)[] = [];
    const second = prepareStepEnv(makeOpts(`1//0gAccountAlpha_${'a'.repeat(20)}`), cleanups2);
    if ('error' in second) throw new Error(second.error);

    const cleanupsOther: (() => void | Promise<void>)[] = [];
    const other = prepareStepEnv(makeOpts(`1//0gAccountBeta_${'b'.repeat(20)}`), cleanupsOther);
    if ('error' in other) throw new Error(other.error);

    const home1 = first.env.HOME!;
    expect(second.env.HOME).toBe(home1);
    expect(other.env.HOME).not.toBe(home1);
    expect(dirname(dirname(home1))).toBe(join(appData, 'credential-profiles'));

    for (const fn of [...cleanups1].reverse()) await fn();
    expect(existsSync(home1)).toBe(true);

    for (const fn of [...cleanups2].reverse()) await fn();
    expect(existsSync(home1)).toBe(false);

    for (const fn of [...cleanupsOther].reverse()) await fn();
    expect(existsSync(other.env.HOME!)).toBe(false);
  });
});
