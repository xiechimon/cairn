import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { prepareStepEnv, type StepEnvInput } from '../src/step-env.js';
import { testTempDir } from './test-temp-dir.js';

type Env = Record<string, string>;
type Host = { root: string; home: string };

function fakeHost(secret = 'host-secret'): Host {
  const root = realpathSync(testTempDir('host-access-'));
  const home = join(root, 'real');
  mkdirSync(join(home, '.config', 'gh'), { recursive: true });
  writeFileSync(
    join(home, '.gitconfig'),
    `[credential]\n\thelper = "!f() { echo username=host-user; echo password=${secret}; }; f"\n`,
  );
  writeFileSync(
    join(home, '.config', 'gh', 'hosts.yml'),
    'github.com:\n    oauth_token: fake-host-token\n    user: host-user\n    git_protocol: https\n',
  );
  return { root, home };
}

const OAUTH = JSON.stringify({
  kind: 'oauth-personal',
  refreshToken: `1//0gHostAccess_${'c'.repeat(20)}`,
  authMethod: 'consumer',
});

const ISOLATED: [string, Partial<StepEnvInput>][] = [
  ['Antigravity host sign-in', { runtimeId: 'antigravity' }],
  ['Antigravity API key', { runtimeId: 'antigravity', antigravityToken: 'api-key' }],
  ['Antigravity subscription', { runtimeId: 'antigravity', antigravityToken: OAUTH }],
  ['Devin', { runtimeId: 'devin' }],
];

async function withStep(
  host: Host,
  patch: Partial<StepEnvInput>,
  run: (env: Env) => void | Promise<void>,
  extraHostEnv: Env = {},
) {
  const cleanups: (() => void | Promise<void>)[] = [];
  mkdirSync(join(host.root, 'devin-home'), { recursive: true });
  const hostEnv = { PATH: process.env.PATH, HOME: host.home, ...extraHostEnv };
  const step = prepareStepEnv(
    {
      inherited: extraHostEnv,
      git: null,
      readonlyGit: false,
      runtimeId: null,
      claudeSubscriptionToken: undefined,
      agentConfig: { cairnHome: join(host.root, 'cairn'), realHome: host.home, hostEnv },
      ...(patch.runtimeId === 'devin' ? { devinHome: join(host.root, 'devin-home') } : {}),
      ...patch,
    },
    cleanups,
  );
  if ('error' in step) throw new Error(step.error);
  try {
    await run({ PATH: process.env.PATH ?? '', ...extraHostEnv, ...step.env });
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
}

function tool(env: Env, command: string, args: string[], input?: string): string {
  try {
    return execFileSync(command, args, {
      env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      ...(input === undefined ? {} : { input }),
    }).trim();
  } catch {
    return '';
  }
}

const QUERY = 'protocol=https\nhost=github.com\n\n';
const gitPassword = (env: Env) => tool(env, 'git', ['credential', 'fill'], QUERY);
const ghToken = (env: Env) => tool(env, 'gh', ['auth', 'token', '--hostname', 'github.com']);

const LOGIN_SHELLS = [
  '/bin/sh',
  '/bin/bash',
  '/bin/zsh',
  '/opt/homebrew/bin/fish',
  '/usr/local/bin/fish',
  '/usr/bin/fish',
].filter((shell) => existsSync(shell));
const loginShellPassword = (env: Env, shell: string) =>
  tool(env, shell, ['-lc', 'git credential fill'], QUERY);

function repository(host: Host, parts: string[]): string {
  const repo = join(host.root, ...parts);
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  return repo;
}

function layeredGitSetup(home: string) {
  writeFileSync(join(home, '.gitconfig-base'), '[user]\n\temail = base@example.test\n');
  writeFileSync(join(home, '.gitconfig-work'), '[cairntest]\n\twork = found\n');
  writeFileSync(
    join(home, '.gitconfig'),
    '[include]\n\tpath = .gitconfig-base\n[includeIf "gitdir:~/work/"]\n\tpath = ~/.gitconfig-work\n' +
      '[user]\n\tname = Host User\n\temail = chosen@example.test\n[core]\n\thooksPath = ~/.githooks\n',
  );
  mkdirSync(join(home, '.githooks'));
  writeFileSync(join(home, '.githooks', 'commit-msg'), '#!/bin/sh\necho "Global-Hook" >> "$1"\n');
  chmodSync(join(home, '.githooks', 'commit-msg'), 0o755);
}

describe.skipIf(process.platform === 'win32')('developer access under an isolated HOME', () => {
  test.each(ISOLATED)('%s: tools and login shells use the host sign-in', async (_n, patch) => {
    const host = fakeHost();
    await withStep(host, patch, (env) => {
      expect(env.HOME).not.toBe(host.home);
      expect(gitPassword(env)).toContain('password=host-secret');
      expect(ghToken(env)).toBe('fake-host-token');
      for (const shell of LOGIN_SHELLS) {
        expect(loginShellPassword(env, shell), shell).toContain('password=host-secret');
      }
      for (const path of ['.gitconfig', '.netrc', '.git-credentials', '.config/git', 'Library']) {
        expect(() => lstatSync(join(env.HOME ?? '', path))).toThrow();
      }
      expect(JSON.stringify(env)).not.toMatch(/fake-host-token|host-secret|GH_TOKEN/);
      expect(env.COREPACK_ENABLE_DOWNLOAD_PROMPT).toBe('0');
      expect(env.COREPACK_HOME).toBe(join(host.home, '.cache', 'node', 'corepack'));
    });
  });

  test.each(ISOLATED)('%s: git behaves as in a host run', async (_name, patch) => {
    const host = fakeHost();
    layeredGitSetup(host.home);
    const xdg = join(host.root, 'xdg');
    mkdirSync(join(xdg, 'git'), { recursive: true });
    writeFileSync(join(xdg, 'git', 'config'), '[cairntest]\n\txdg = found\n');
    const own = repository(host, ['real', 'work', 'project']);
    const other = repository(host, ['elsewhere']);
    execFileSync('git', ['-C', own, 'config', 'user.email', 'repo@example.test']);
    mkdirSync(join(own, '.husky'));
    execFileSync('git', ['-C', own, 'config', 'core.hooksPath', '.husky']);
    const hostRun = { PATH: process.env.PATH ?? '', HOME: host.home, XDG_CONFIG_HOME: xdg };
    await withStep(
      host,
      patch,
      (env) => {
        for (const repo of [own, other]) {
          const list = ['-C', repo, 'config', '--list', '--show-origin', '--includes'];
          expect(tool(env, 'git', list)).toBe(tool(hostRun, 'git', list));
          tool(env, 'git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'step']);
        }
        const last = ['log', '-1', '--format=%ae|%B'];
        expect(tool(env, 'git', ['-C', own, ...last])).toBe('repo@example.test|step');
        expect(tool(env, 'git', ['-C', other, ...last])).toBe(
          'chosen@example.test|step\nGlobal-Hook',
        );
      },
      { XDG_CONFIG_HOME: xdg },
    );
  });

  test.each(ISOLATED)('%s: a HOME or XDG the caller sets is kept', async (_name, patch) => {
    const host = fakeHost();
    const sandbox = fakeHost('sandbox-secret');
    await withStep(host, patch, async (env) => {
      const real = readFileSync(join(host.home, '.gitconfig'), 'utf8');
      const sandboxed = { ...env, HOME: sandbox.home };
      expect(gitPassword(sandboxed)).toContain('password=sandbox-secret');
      tool(sandboxed, 'git', ['config', '--global', 'cairntest.written', 'sandbox']);
      expect(readFileSync(join(sandbox.home, '.gitconfig'), 'utf8')).toContain('written');
      expect(readFileSync(join(host.home, '.gitconfig'), 'utf8')).toBe(real);
      const xdg = { ...env, XDG_CONFIG_HOME: join(sandbox.home, '.config') };
      mkdirSync(join(sandbox.home, '.config', 'git'));
      writeFileSync(join(sandbox.home, '.config', 'git', 'config'), '[cairntest]\n\tx = mine\n');
      expect(tool(xdg, 'git', ['config', 'cairntest.x'])).toBe('mine');
      await withStep(
        sandbox,
        patch,
        (nested) => {
          expect(gitPassword(nested)).toContain('password=sandbox-secret');
        },
        { PATH: env.PATH ?? '' },
      );
    });
  });

  test.each(ISOLATED)(
    '%s: a read-only step gets no host sign-in, even while a normal step runs',
    async (_name, patch) => {
      const host = fakeHost();
      await withStep(host, patch, async () => {
        await withStep(host, { ...patch, readonlyGit: true }, (env) => {
          expect(gitPassword(env)).not.toContain('host-secret');
          expect(ghToken(env)).not.toBe('fake-host-token');
          for (const shell of LOGIN_SHELLS) {
            expect(loginShellPassword(env, shell), shell).not.toContain('host-secret');
          }
          expect(env.COREPACK_ENABLE_DOWNLOAD_PROMPT).toBe('0');
        });
      });
    },
  );

  test.each(ISOLATED)(
    '%s: login shells find the host sign-in when the host sets XDG_CONFIG_HOME and ZDOTDIR',
    async (_name, patch) => {
      const host = fakeHost();
      const zdotdir = join(host.home, '.config', 'zsh');
      mkdirSync(zdotdir);
      writeFileSync(join(zdotdir, '.zprofile'), '');
      await withStep(
        host,
        patch,
        (env) => {
          expect(ghToken(env)).toBe('fake-host-token');
          for (const shell of LOGIN_SHELLS) {
            expect(loginShellPassword(env, shell), shell).toContain('password=host-secret');
          }
        },
        { XDG_CONFIG_HOME: join(host.home, '.config'), ZDOTDIR: zdotdir },
      );
    },
  );

  test('zsh run by git still reads the startup files in the host ZDOTDIR', async () => {
    const host = fakeHost();
    const zdotdir = join(host.home, '.config', 'zsh');
    mkdirSync(zdotdir);
    writeFileSync(join(zdotdir, '.zshenv'), 'export CAIRN_FROM_ZSHENV=host-zshenv\n');
    await withStep(
      host,
      { runtimeId: 'antigravity' },
      (env) => {
        writeFileSync(join(env.HOME as string, '.zshenv'), 'export CAIRN_FROM_ZSHENV=step\n');
        const alias = "alias.zshenv=!/bin/zsh -c 'echo $CAIRN_FROM_ZSHENV'";
        expect(tool(env, 'git', ['-c', alias, 'zshenv'])).toBe('host-zshenv');
      },
      { ZDOTDIR: zdotdir },
    );
  });

  test('bash profiles an earlier step left behind do not hide the host sign-in', async () => {
    const host = fakeHost();
    const isolated = join(host.root, 'cairn', 'homes', 'antigravity');
    mkdirSync(isolated, { recursive: true });
    const kept = join(host.home, '.bash_profile');
    writeFileSync(kept, 'export CAIRN_HOST_PROFILE=1\n');
    symlinkSync(kept, join(isolated, '.bash_profile'));
    writeFileSync(join(isolated, '.bash_login'), 'export CAIRN_LEFTOVER=1\n');
    await withStep(host, { runtimeId: 'antigravity' }, (env) => {
      expect(loginShellPassword(env, '/bin/bash')).toContain('password=host-secret');
      expect(readFileSync(kept, 'utf8')).toBe('export CAIRN_HOST_PROFILE=1\n');
    });
  });

  test.each([
    ['antigravity', '.gemini/antigravity-cli/antigravity-oauth-token'],
    ['gemini', '.gemini/oauth_creds.json'],
    ['devin', '.credentials'],
  ])(
    'a %s home linked to the user home is refused and nothing is overwritten',
    async (name, file) => {
      const host = fakeHost();
      const homes = join(host.root, 'cairn', 'homes');
      mkdirSync(homes, { recursive: true });
      symlinkSync(host.home, join(homes, name));
      mkdirSync(dirname(join(host.home, file)), { recursive: true });
      writeFileSync(join(host.home, file), '{"mine":true}');
      writeFileSync(join(host.home, '.profile'), 'export MINE=1\n');
      const patch = {
        runtimeId: name,
        ...(name === 'devin' ? { devinHome: join(homes, name) } : {}),
      } as Partial<StepEnvInput>;
      await expect(withStep(host, patch, () => {})).rejects.toThrow(/is a link/);
      expect(readFileSync(join(host.home, file), 'utf8')).toBe('{"mine":true}');
      expect(readFileSync(join(host.home, '.profile'), 'utf8')).toBe('export MINE=1\n');
    },
  );

  test('a shared subscription home swapped for a link mid-step is refused', async () => {
    const host = fakeHost();
    const token = join(host.home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
    mkdirSync(dirname(token), { recursive: true });
    writeFileSync(token, '{"mine":true}');
    writeFileSync(join(host.home, '.profile'), 'export MINE=1\n');
    writeFileSync(join(host.home, '.bash_profile'), 'export MINE=2\n');
    const patch = { runtimeId: 'antigravity', antigravityToken: OAUTH };
    await withStep(host, patch, async (env) => {
      const isolated = env.HOME as string;
      renameSync(isolated, `${isolated}-moved`);
      symlinkSync(host.home, isolated);
      await expect(withStep(host, patch, () => {})).rejects.toThrow(/is a link/);
    });
    expect(readFileSync(token, 'utf8')).toBe('{"mine":true}');
    expect(readFileSync(join(host.home, '.profile'), 'utf8')).toBe('export MINE=1\n');
    expect(readFileSync(join(host.home, '.bash_profile'), 'utf8')).toBe('export MINE=2\n');
  });

  test.runIf(process.env.CI === 'true')('CI has fish, so the fish login path is covered', () => {
    expect(LOGIN_SHELLS.some((shell) => shell.endsWith('/fish'))).toBe(true);
  });

  test('what an earlier step left in the home cannot block or redirect the next one', async () => {
    const host = fakeHost();
    const isolated = join(host.root, 'cairn', 'homes', 'antigravity');
    mkdirSync(join(isolated, '.profile'), { recursive: true });
    symlinkSync(join(host.home, '.config'), join(isolated, '.config'));
    await withStep(host, { runtimeId: 'antigravity' }, (env) => {
      expect(loginShellPassword(env, '/bin/sh')).toContain('password=host-secret');
      expect(existsSync(join(host.home, '.config', 'fish'))).toBe(false);
    });
  });

  test('a hosted repository credential still wins over the host sign-in', async () => {
    const host = fakeHost();
    const url = 'https://github.com/acme/widgets.git';
    const git = { username: 'x-access-token', password: 'step-password', url };
    await withStep(host, { runtimeId: 'antigravity', git }, (env) => {
      const query = 'protocol=https\nhost=github.com\npath=acme/widgets.git\n\n';
      expect(tool(env, 'git', ['credential', 'fill'], query)).toContain('password=step-password');
    });
  });
});
