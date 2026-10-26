import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  type GitFallbackReason,
  gitCredentialEnv,
  GIT_NET_RETRY_DELAYS_MS,
  gitPrim,
  isGitAuthFailure,
  isGitTransientNetFailure,
  machineGitEnv,
  runGit,
  runGitOk,
  withGitCredentialFallback,
  withGitNetRetries,
} from '../src/git.js';
import { stubOutInheritedGitConfig } from './git-config-env.js';

const CRED_HOST = 'http://127.0.0.1:1';
const CRED = { username: 'git', password: 'cairn_fresh_token_123', url: `${CRED_HOST}/repo.git` };

const MEA_AUTH_FAILURE =
  'remote: Invalid username or token. Password authentication is not supported.\n' +
  "fatal: Authentication failed for 'https://github.com/xiechimon/cairn.git/'";

describe('gitCredentialEnv — per-step credential env injection (02 §8, nothing on disk)', () => {
  test('precondition: an empty credential.helper value resets the system/global helper list', () => {
    const env = gitCredentialEnv(CRED, {});
    expect(env.GIT_CONFIG_COUNT).toBe('2');
    expect(env.GIT_CONFIG_KEY_0).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_0).toBe('');
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_1).toContain('CAIRN_GIT_CRED_PASSWORD');
    expect(env.CAIRN_GIT_CRED_USERNAME).toBe(CRED.username);
    expect(env.CAIRN_GIT_CRED_PASSWORD).toBe(CRED.password);
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  test('the empty-value reset makes the inline credential beat global helpers (real git credential fill)', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-git-cred-'));
    const staleHelper = join(home, 'stale-helper.sh');
    writeFileSync(staleHelper, '#!/bin/sh\necho username=git\necho password=STALE_REVOKED\n');
    chmodSync(staleHelper, 0o755);
    writeFileSync(join(home, '.gitconfig'), `[credential]\n\thelper = ${staleHelper}\n`);

    const res = spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=http\nhost=127.0.0.1:1\n\n',
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        GIT_CONFIG_NOSYSTEM: '1',
        ...gitCredentialEnv(CRED),
      },
    });
    const out = res.stdout ?? '';
    expect(out).toContain(`password=${CRED.password}`);
    expect(out).not.toContain('STALE_REVOKED');
  });
});

const envWithoutGitConfig = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_CONFIG_')));

describe("gitCredentialEnv — appended after the parent environment's GIT_CONFIG_* (#1460)", () => {
  const PARENT: NodeJS.ProcessEnv = {
    GIT_CONFIG_COUNT: '3',
    GIT_CONFIG_KEY_0: 'http.proxy',
    GIT_CONFIG_VALUE_0: 'http://127.0.0.1:3128',
    GIT_CONFIG_KEY_1: 'http.sslCAInfo',
    GIT_CONFIG_VALUE_1: '/etc/ssl/proxy-ca.crt',
    GIT_CONFIG_KEY_2: 'credential.helper',
    GIT_CONFIG_VALUE_2: 'store',
  };

  test("failure mode 1: parent's 3 entries kept verbatim, reset and helper land at 3 and 4, COUNT=5", () => {
    const env = { ...PARENT, ...gitCredentialEnv(CRED, PARENT) };
    expect(env.GIT_CONFIG_COUNT).toBe('5');
    for (const i of [0, 1, 2]) {
      expect(env[`GIT_CONFIG_KEY_${i}`]).toBe(PARENT[`GIT_CONFIG_KEY_${i}`]);
      expect(env[`GIT_CONFIG_VALUE_${i}`]).toBe(PARENT[`GIT_CONFIG_VALUE_${i}`]);
    }
    expect(env.GIT_CONFIG_KEY_3).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_3).toBe('');
    expect(env.GIT_CONFIG_KEY_4).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_4).toContain('CAIRN_GIT_CRED_PASSWORD');
    expect(env.CAIRN_GIT_CRED_PASSWORD).toBe(CRED.password);
  });

  test.each([' 2', '+2'])('失败方式 1：git 也认的 COUNT 写法 %j → 同样接在后面', (count) => {
    const parent: NodeJS.ProcessEnv = {
      GIT_CONFIG_COUNT: count,
      GIT_CONFIG_KEY_0: 'http.proxy',
      GIT_CONFIG_VALUE_0: 'http://127.0.0.1:3128',
      GIT_CONFIG_KEY_1: 'http.sslCAInfo',
      GIT_CONFIG_VALUE_1: '/etc/ssl/proxy-ca.crt',
    };
    const env = { ...parent, ...gitCredentialEnv(CRED, parent) };
    expect(env.GIT_CONFIG_COUNT).toBe('4');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.proxy');
    expect(env.GIT_CONFIG_KEY_1).toBe('http.sslCAInfo');
    expect(env.GIT_CONFIG_VALUE_2).toBe('');
    expect(env.GIT_CONFIG_VALUE_3).toContain('CAIRN_GIT_CRED_PASSWORD');
    expect(env.CAIRN_GIT_CRED_PASSWORD).toBe(CRED.password);
  });

  test('failure mode 2: parent has no GIT_CONFIG_* → COUNT=2, reset at 0, helper at 1', () => {
    const env = gitCredentialEnv(CRED, { PATH: '/usr/bin', HOME: '/home/x' });
    expect(env.GIT_CONFIG_COUNT).toBe('2');
    expect(env.GIT_CONFIG_VALUE_0).toBe('');
    expect(env.GIT_CONFIG_VALUE_1).toContain('CAIRN_GIT_CRED_PASSWORD');
    expect(env.CAIRN_GIT_CRED_PASSWORD).toBe(CRED.password);
    expect(Object.keys(env).filter((k) => k.startsWith('GIT_CONFIG_'))).toHaveLength(5);
  });

  test.each<[string, NodeJS.ProcessEnv]>([
    ['非数字', { GIT_CONFIG_COUNT: 'abc' }],
    ['负数', { GIT_CONFIG_COUNT: '-1' }],
    ['尾随字符', { GIT_CONFIG_COUNT: '1x', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' }],
    ['缺 KEY', { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' }],
    ['缺 VALUE', { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b' }],
  ])('失败方式 3：父环境 COUNT %s → 退回从 0 写（COUNT=2）', (_label, parent) => {
    const env = { ...parent, ...gitCredentialEnv(CRED, parent) };
    expect(env.GIT_CONFIG_COUNT).toBe('2');
    expect(env.GIT_CONFIG_KEY_0).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_0).toBe('');
    expect(env.GIT_CONFIG_VALUE_1).toContain('CAIRN_GIT_CRED_PASSWORD');
    expect(env.CAIRN_GIT_CRED_PASSWORD).toBe(CRED.password);
  });

  test("failure modes 1/4: real git — parent's keys still apply, parent's credential.helper is reset", () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-git-cred-parent-'));
    const staleHelper = join(home, 'stale-helper.sh');
    writeFileSync(staleHelper, '#!/bin/sh\necho username=git\necho password=STALE_REVOKED\n');
    chmodSync(staleHelper, 0o755);
    const parent: NodeJS.ProcessEnv = {
      ...envWithoutGitConfig(),
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'cairn.probe',
      GIT_CONFIG_VALUE_0: 'kept',
      GIT_CONFIG_KEY_1: 'credential.helper',
      GIT_CONFIG_VALUE_1: staleHelper,
    };
    const env = { ...parent, ...gitCredentialEnv(CRED, parent) };

    const probe = spawnSync('git', ['config', '--get', 'cairn.probe'], { encoding: 'utf8', env });
    expect(probe.stdout.trim()).toBe('kept');

    const fill = spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=http\nhost=127.0.0.1:1\n\n',
      encoding: 'utf8',
      env,
    });
    expect(fill.stdout).toContain(`password=${CRED.password}`);
    expect(fill.stdout).not.toContain('STALE_REVOKED');
  });

  test("failure mode 5: runGit composition — default parent env = process.env, the process's own keys still apply", async () => {
    stubOutInheritedGitConfig();
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'cairn.probe');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'kept');
    try {
      const env = gitCredentialEnv(CRED);
      expect(env.GIT_CONFIG_COUNT).toBe('3');
      const out = await runGitOk(['config', '--get', 'cairn.probe'], { env });
      expect(out).toBe('kept');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

async function basicAuthRemote(): Promise<{ base: string; seen: string[]; close: () => void }> {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const auth = req.headers.authorization;
    if (auth === undefined) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="probe"' });
    } else {
      seen.push(Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString('utf8'));
      res.writeHead(403);
    }
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, seen, close: () => server.close() };
}

function seededWorktree(originUrl: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-git-scope-'));
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'seed');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'tag', '-a', 'v1', '-m', 'v1');
  git('remote', 'add', 'origin', originUrl);
  return dir;
}

describe('gitCredentialEnv — the helper answers only for the host the credential was issued to (#1484)', () => {
  test.each([
    ['https://github.com/o/r.git', 'https', 'github.com'],
    ['https://github.com:443/o/r', 'https', 'github.com:443'],
    ['http://127.0.0.1:8787/git/team/r', 'http', '127.0.0.1:8787'],
    ['https://x-access-token@GitHub.com/o/r.git', 'https', 'GitHub.com'],
    ['http://cairn_server:8787/git/t/r.git', 'http', 'cairn_server:8787'],
    ['http://[::1]:8787/git/t/r', 'http', '[::1]:8787'],
  ])('失败方式 1：绑定 %s → protocol %s、host %s，前面仍是空值重置', (url, protocol, host) => {
    const env = gitCredentialEnv({ ...CRED, url }, {});
    expect(env.GIT_CONFIG_COUNT).toBe('2');
    expect(env.GIT_CONFIG_KEY_0).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_0).toBe('');
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.helper');
    expect(env.CAIRN_GIT_CRED_PROTOCOL).toBe(protocol);
    expect(env.CAIRN_GIT_CRED_HOST).toBe(host);
  });

  test.each([
    '',
    '/srv/repos/r.git',
    'git@github.com:o/r.git',
    'file:///srv/r.git',
    'ssh://git@github.com/o/r',
  ])('失败方式 2：绑定 %j（不是 http(s)）→ 只有重置，没有 helper', (url) => {
    const env = gitCredentialEnv({ ...CRED, url }, {});
    expect(env.GIT_CONFIG_COUNT).toBe('1');
    expect(env.GIT_CONFIG_KEY_0).toBe('credential.helper');
    expect(env.GIT_CONFIG_VALUE_0).toBe('');
    expect(Object.keys(env).filter((k) => k.startsWith('CAIRN_GIT_CRED_'))).toEqual([]);
    expect(JSON.stringify(env)).not.toContain(CRED.password);
  });

  test('failure modes 3/4: real git — bound host gets the token, other hosts do not, global helper for the same host is reset', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-git-scope-home-'));
    const staleHelper = join(home, 'stale-helper.sh');
    writeFileSync(staleHelper, '#!/bin/sh\necho username=git\necho password=STALE_REVOKED\n');
    chmodSync(staleHelper, 0o755);
    writeFileSync(
      join(home, '.gitconfig'),
      `[credential "${CRED_HOST}"]\n\thelper = ${staleHelper}\n`,
    );
    const base: NodeJS.ProcessEnv = {
      ...envWithoutGitConfig(),
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
    };
    const env = { ...base, ...gitCredentialEnv(CRED, base) };
    const fill = (protocol: string, host: string) =>
      spawnSync('git', ['credential', 'fill'], {
        input: `protocol=${protocol}\nhost=${host}\n\n`,
        encoding: 'utf8',
        env,
      }).stdout;

    const bound = fill('http', '127.0.0.1:1');
    expect(bound).toContain(`password=${CRED.password}`);
    expect(bound).not.toContain('STALE_REVOKED');
    for (const [protocol, host] of [
      ['http', '127.0.0.1:2'],
      ['http', '127.0.0.1'],
      ['http', 'example.invalid'],
    ] as const) {
      expect(fill(protocol, host)).not.toContain(CRED.password);
    }
  });

  test('failure modes 1/3: real git — hostnames with _, original letter case, and ports match as usual, git itself takes the host from the URL', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-git-scope-url-'));
    const base: NodeJS.ProcessEnv = {
      ...envWithoutGitConfig(),
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
    };
    const fillUrl = (bound: string, requested: string) =>
      spawnSync('git', ['credential', 'fill'], {
        input: `url=${requested}\n\n`,
        encoding: 'utf8',
        env: { ...base, ...gitCredentialEnv({ ...CRED, url: bound }, base) },
      }).stdout;
    for (const url of [
      'http://cairn_server:8787/git/t/r.git',
      'https://GitHub.com/o/r.git',
      'https://github.com:8443/o/r.git',
    ]) {
      expect(fillUrl(url, url)).toContain(`password=${CRED.password}`);
    }
    expect(
      fillUrl('http://cairn_server:8787/git/t/r.git', 'http://other_server:8787/git/t/r.git'),
    ).not.toContain(CRED.password);
    expect(fillUrl('https://github.com:8443/o/r.git', 'https://github.com/o/r.git')).not.toContain(
      CRED.password,
    );
  });

  test("failure mode 7: http binding redirected to the same host's https still answered; https does not downgrade to http", () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-git-scope-upgrade-'));
    const base: NodeJS.ProcessEnv = {
      ...envWithoutGitConfig(),
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
    };
    const fill = (bound: string, protocol: string) =>
      spawnSync('git', ['credential', 'fill'], {
        input: `protocol=${protocol}\nhost=cairn.internal\n\n`,
        encoding: 'utf8',
        env: { ...base, ...gitCredentialEnv({ ...CRED, url: bound }, base) },
      }).stdout;
    expect(fill('http://cairn.internal/git/t/r.git', 'https')).toContain(
      `password=${CRED.password}`,
    );
    expect(fill('https://cairn.internal/git/t/r.git', 'http')).not.toContain(CRED.password);
  });

  test.each([
    ['密码带换行', { password: 'a\nb' }],
    ['密码带回车', { password: 'a\rb' }],
    ['用户名带换行', { username: 'u\nhost=evil.example' }],
  ])('失败方式 8：%s（git 的凭证协议装不下）→ 明确报错，不交给 git', (_label, patch) => {
    expect(() => gitCredentialEnv({ ...CRED, ...patch }, {})).toThrow(/line break/);
  });

  test("failure mode 6: credential values never enter the helper's sh -c command line (run_command recorded by GIT_TRACE)", () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-git-argv-'));
    const trace = join(home, 'trace.log');
    const base: NodeJS.ProcessEnv = {
      ...envWithoutGitConfig(),
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TRACE: trace,
    };
    const out = spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=http\nhost=127.0.0.1:1\n\n',
      encoding: 'utf8',
      env: { ...base, ...gitCredentialEnv(CRED, base) },
    }).stdout;
    expect(out).toContain(`password=${CRED.password}`);
    const log = readFileSync(trace, 'utf8');
    expect(log).toContain('run_command');
    expect(log).not.toContain(CRED.password);
  });

  test('failure mode 5: origin repointed to another host via set-url → push / tagPush / fetch send no credential; the bound host still authenticates', async () => {
    const bound = await basicAuthRemote();
    const other = await basicAuthRemote();
    stubOutInheritedGitConfig();
    try {
      const cred = { ...CRED, url: `${bound.base}/real.git` };
      const dir = seededWorktree(cred.url);
      await expect(gitPrim.push(dir, 'main', cred)).rejects.toThrow();
      expect(bound.seen).toEqual([`${cred.username}:${cred.password}`]);
      spawnSync('git', ['remote', 'set-url', 'origin', `${other.base}/elsewhere.git`], {
        cwd: dir,
      });
      await expect(gitPrim.push(dir, 'main', cred)).rejects.toThrow();
      await expect(gitPrim.tagPush(dir, 'v1', cred)).rejects.toThrow();
      await expect(gitPrim.fetch(dir, cred)).rejects.toThrow();
      expect(other.seen).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      bound.close();
      other.close();
    }
  }, 30_000);

  test('failure mode 5: insteadOf rewrites the bound host to another host → no credential sent', async () => {
    const bound = await basicAuthRemote();
    const other = await basicAuthRemote();
    stubOutInheritedGitConfig();
    try {
      const cred = { ...CRED, url: `${bound.base}/real.git` };
      const dir = seededWorktree(cred.url);
      spawnSync('git', ['config', `url.${other.base}/.insteadOf`, `${bound.base}/`], { cwd: dir });
      await expect(gitPrim.push(dir, 'main', cred)).rejects.toThrow();
      await expect(gitPrim.tagPush(dir, 'v1', cred)).rejects.toThrow();
      expect(other.seen).toEqual([]);
      expect(bound.seen).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      bound.close();
      other.close();
    }
  }, 30_000);
});

describe('gitCredentialEnv — username and password in the helper are handed to git verbatim (#1485)', () => {
  const fillPassword = (cred: typeof CRED): { username?: string; password?: string } => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-git-quote-'));
    const base: NodeJS.ProcessEnv = {
      ...envWithoutGitConfig(),
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
    };
    const out = spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=http\nhost=127.0.0.1:1\n\n',
      encoding: 'utf8',
      env: { ...base, ...gitCredentialEnv(cred, base) },
    }).stdout;
    const field = (name: string) =>
      out
        .split('\n')
        .find((line) => line.startsWith(`${name}=`))
        ?.slice(name.length + 1);
    return { username: field('username'), password: field('password') };
  };

  test.each([
    'abc$(echo INJECTED)',
    'a`echo INJECTED`b',
    '$HOME',
    'a;echo INJECTED',
    "it's",
    'two  words',
    'back\\slash',
    '*',
    'a\\nb',
    'x\\cy',
    '\\0101',
  ])('密码 %j 原样返回', (password) => {
    expect(fillPassword({ ...CRED, password }).password).toBe(password);
  });

  test('username likewise returned verbatim', () => {
    expect(fillPassword({ ...CRED, username: "o'$(echo X)" }).username).toBe("o'$(echo X)");
  });

  test('$(touch …) inside the password is not executed', () => {
    const marker = join(mkdtempSync(join(tmpdir(), 'cairn-git-quote-marker-')), 'ran');
    fillPassword({ ...CRED, password: `x$(touch ${marker})` });
    expect(existsSync(marker)).toBe(false);
  });
});

describe("machineGitEnv — execution machine's local credential env (#1225 fallback path)", () => {
  test('only the TTY guard is set: no credential.helper reset, proxy variables untouched (ticket failure modes 3/4)', () => {
    const env = machineGitEnv();
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(Object.keys(env).some((k) => k.startsWith('GIT_CONFIG_'))).toBe(false);
    const proxyKeys = Object.keys(env).filter((k) => /_proxy$/i.test(k) || /^no_proxy$/i.test(k));
    expect(proxyKeys).toEqual([]);
    const integrationKeys = Object.keys(gitCredentialEnv(CRED)).filter(
      (k) => /_proxy$/i.test(k) || /^no_proxy$/i.test(k),
    );
    expect(integrationKeys).toEqual([]);
  });

  test('on the machine path global helpers answer normally (real git credential fill, mirror image of the reset tests)', () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-git-machine-'));
    const machineHelper = join(home, 'machine-helper.sh');
    writeFileSync(machineHelper, '#!/bin/sh\necho username=git\necho password=MACHINE_OWN_TOKEN\n');
    chmodSync(machineHelper, 0o755);
    writeFileSync(join(home, '.gitconfig'), `[credential]\n\thelper = ${machineHelper}\n`);

    const res = spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=http\nhost=127.0.0.1:1\n\n',
      encoding: 'utf8',
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(key),
          ),
        ),
        HOME: home,
        GIT_CONFIG_NOSYSTEM: '1',
        ...machineGitEnv(),
      },
    });
    expect(res.stdout ?? '').toContain('password=MACHINE_OWN_TOKEN');
  });
});

describe('isGitAuthFailure — auth-failure detection (fallback trigger)', () => {
  test('auth-failure original text → true (mea-observed original text / no credentials / 401 family)', () => {
    expect(isGitAuthFailure(MEA_AUTH_FAILURE)).toBe(true);
    expect(
      isGitAuthFailure(
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      ),
    ).toBe(true);
    expect(
      isGitAuthFailure('error: RPC failed; HTTP 401 curl 22 The requested URL returned error: 401'),
    ).toBe(true);
    expect(
      isGitAuthFailure('remote: HTTP Basic: Access denied\nfatal: Authentication failed'),
    ).toBe(true);
  });

  test('non-auth failure → false (no fallback: network/5xx/404/403/conflict/timeout)', () => {
    expect(
      isGitAuthFailure(
        'fatal: unable to access: Failed to connect to github.com port 443: Connection refused',
      ),
    ).toBe(false);
    expect(
      isGitAuthFailure('error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502'),
    ).toBe(false);
    expect(isGitAuthFailure('remote: Permission to o/r.git denied to user')).toBe(false);
    expect(isGitAuthFailure('fatal: repository not found')).toBe(false);
    expect(isGitAuthFailure('merge conflict against origin/main (aborted)')).toBe(false);
    expect(isGitAuthFailure('git fetch timed out after 480000ms')).toBe(false);
  });
});

describe('isGitTransientNetFailure — retry only connection loss and timeouts (#1786)', () => {
  test('transient git network errors', () => {
    expect(isGitTransientNetFailure('Recv failure: Connection reset by peer')).toBe(true);
    expect(
      isGitTransientNetFailure(
        'fatal: unable to access: Failed to connect to github.com port 443: Connection refused',
      ),
    ).toBe(true);
    expect(isGitTransientNetFailure('git fetch timed out after 480000ms')).toBe(true);
  });

  test('non-transient git errors', () => {
    expect(isGitTransientNetFailure('push failed (128): bad object')).toBe(false);
    expect(isGitTransientNetFailure('merge conflict against origin/main (aborted)')).toBe(false);
  });
});

describe('withGitNetRetries — deterministic auth-failure short circuit (#1225: 401 retries never flip red)', () => {
  test('auth failures do not burn the retry budget (throw on first occurrence)', async () => {
    const op = vi.fn(async () => {
      throw new Error(MEA_AUTH_FAILURE);
    });
    await expect(withGitNetRetries(op)).rejects.toThrow('Invalid username or token');
    expect(op).toHaveBeenCalledTimes(1);
  });

  test('network failures still retry (existing semantics unchanged)', {
    timeout: 15_000,
  }, async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('Connection refused');
    });
    await expect(withGitNetRetries(op)).resolves.toBeUndefined();
    expect(op).toHaveBeenCalledTimes(3);
  });

  test('a push that fails twice with connection reset and then succeeds does not throw', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const pending = withGitNetRetries(async () => {
        calls += 1;
        if (calls < 3) throw new Error('Recv failure: Connection reset by peer');
      });
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeUndefined();
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a connection reset retries through 2s, 4s, 8s and 16s, and the fifth attempt can succeed', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const pending = withGitNetRetries(async () => {
        calls += 1;
        if (calls < 5) throw new Error('Recv failure: Connection reset by peer');
      });
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeUndefined();
      expect(calls).toBe(5);
      expect([...GIT_NET_RETRY_DELAYS_MS]).toEqual([2_000, 4_000, 8_000, 16_000]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a non-transient git error is not retried', async () => {
    const op = vi.fn(async () => {
      throw new Error('push failed (128): bad object');
    });
    await expect(withGitNetRetries(op)).rejects.toThrow('bad object');
    expect(op).toHaveBeenCalledTimes(1);
  });
});

describe('withGitCredentialFallback — credential order: integration first, machine fallback (#1225)', () => {
  function opStub(script: (cred: typeof CRED | null, call: number) => Promise<void> | void): {
    op: (cred: typeof CRED | null) => Promise<void>;
    calls: (typeof CRED | null)[];
  } {
    const calls: (typeof CRED | null)[] = [];
    return {
      op: async (cred) => {
        calls.push(cred);
        await script(cred, calls.length);
      },
      calls,
    };
  }

  test('integration succeeds → single call, provenance integration (behavior unchanged while integration works)', async () => {
    const { op, calls } = opStub(() => {});
    const source = await withGitCredentialFallback(op, CRED, {
      what: 'push',
      allowMachineFallback: true,
    });
    expect(source).toBe('integration');
    expect(calls).toEqual([CRED]);
  });

  test('integration auth failure → machine fallback succeeds, provenance machine, onFallback receives the git original text', async () => {
    const { op, calls } = opStub((cred) => {
      if (cred !== null) throw new Error(MEA_AUTH_FAILURE);
    });
    const reasons: GitFallbackReason[] = [];
    const source = await withGitCredentialFallback(op, CRED, {
      what: 'push',
      allowMachineFallback: true,
      onFallback: (r) => reasons.push(r),
    });
    expect(source).toBe('machine');
    expect(calls).toEqual([CRED, null]);
    expect(reasons).toEqual([MEA_AUTH_FAILURE]);
    expect(String(reasons[0])).not.toContain(CRED.password);
  });

  test('auth failure on both paths → combined error naming both paths (ticket failure mode 1: no silence)', async () => {
    const { op, calls } = opStub((cred) => {
      if (cred !== null) throw new Error(MEA_AUTH_FAILURE);
      throw new Error("fatal: could not read Username for 'https://github.com'");
    });
    const err = await withGitCredentialFallback(op, CRED, {
      what: 'push',
      allowMachineFallback: true,
    }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toContain('push');
    expect(String(err)).toContain('per-step token');
    expect(String(err)).toContain('Invalid username or token');
    expect(String(err)).toContain('machine credentials');
    expect(String(err)).toContain('could not read Username');
    expect(calls).toEqual([CRED, null]);
  });

  test('non-auth failure → original error rethrown, no fallback (network blips do not consume the credential order)', async () => {
    const { op, calls } = opStub(() => {
      throw new Error('Connection refused');
    });
    await expect(
      withGitCredentialFallback(op, CRED, { what: 'push', allowMachineFallback: true }),
    ).rejects.toThrow('Connection refused');
    expect(calls).toEqual([CRED]);
  });

  test('allowMachineFallback=false (hosted) → no fallback even on auth failure, single call (ticket failure mode 3)', async () => {
    const { op, calls } = opStub((cred) => {
      if (cred !== null) throw new Error(MEA_AUTH_FAILURE);
    });
    await expect(
      withGitCredentialFallback(op, CRED, { what: 'push', allowMachineFallback: false }),
    ).rejects.toThrow('Invalid username or token');
    expect(calls).toEqual([CRED]);
  });

  test('cred null (no per-step token) → straight to the machine path, single call', async () => {
    const { op, calls } = opStub(() => {});
    const source = await withGitCredentialFallback(op, null, {
      what: 'push',
      allowMachineFallback: true,
    });
    expect(source).toBe('machine');
    expect(calls).toEqual([null]);
  });
});

describe('runGit — signal termination is not success (#1329)', () => {
  const STDIN_BLOCKED = { timeoutMs: 200 };

  test('runGit keeps the null exit code (signal termination), does not map it to 0', async () => {
    const r = await runGit(['hash-object', '--stdin'], STDIN_BLOCKED);
    expect(r.code).toBeNull();
  });

  test('runGitOk throws on signal termination, the error wording names the signal', async () => {
    await expect(runGitOk(['hash-object', '--stdin'], STDIN_BLOCKED)).rejects.toThrow(
      'failed (signal SIGTERM)',
    );
  });
});

function gitOk(dir: string, args: string[]): string {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || `git ${args[0]} failed`);
  }
  return (res.stdout ?? '').trim();
}

function dirtyRepo(objectFormat?: 'sha256'): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-reset-hard-'));
  const init = ['init', '-b', 'main'];
  if (objectFormat) init.push('--object-format=sha256');
  gitOk(dir, init);
  gitOk(dir, ['config', 'user.email', 't@example.com']);
  gitOk(dir, ['config', 'user.name', 't']);
  writeFileSync(join(dir, 'README.md'), 'seed\n');
  gitOk(dir, ['add', 'README.md']);
  gitOk(dir, ['commit', '-m', 'seed']);
  const sha = gitOk(dir, ['rev-parse', 'HEAD']);
  writeFileSync(join(dir, 'README.md'), 'corrupted\n');
  return { dir, sha };
}

describe('resetHard — git 2.43 rejects reset --end-of-options (#1316)', () => {
  test('tracked files restored to the target commit', async () => {
    const { dir, sha } = dirtyRepo();
    await gitPrim.resetHard(dir, sha);
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('seed\n');
    expect(gitOk(dir, ['rev-parse', 'HEAD'])).toBe(sha);
  });

  test('sha256 object ids also restored', async () => {
    const { dir, sha } = dirtyRepo('sha256');
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    await gitPrim.resetHard(dir, sha);
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('seed\n');
    expect(gitOk(dir, ['rev-parse', 'HEAD'])).toBe(sha);
  });

  test('an option-shaped revision does not change the worktree', async () => {
    const { dir } = dirtyRepo();
    await expect(gitPrim.resetHard(dir, '--soft')).rejects.toThrow();
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('corrupted\n');
  });

  test('a nonexistent revision does not change the worktree', async () => {
    const { dir } = dirtyRepo();
    await expect(gitPrim.resetHard(dir, 'does-not-exist')).rejects.toThrow();
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('corrupted\n');
  });
});
