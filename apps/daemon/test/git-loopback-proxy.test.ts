import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { gitPrim, runGit } from '../src/git.js';
import { stubOutInheritedGitConfig } from './git-config-env.js';

const PROXY_ENV_NAMES = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
];

interface Listening {
  server: Server;
  port: number;
}

function listen(server: Server, host: string): Promise<Listening> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

function gitIn(cwd: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
}

function dumbGitServer(root: string): Server {
  return createServer((req, res) => {
    try {
      const rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
      const body = readFileSync(join(root, rel));
      res.writeHead(200).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
}

describe('git 子进程访问回环 server 绕过全局 http.proxy（#1635）', () => {
  let tmp: string;
  let proxyHits: string[];
  let proxy: Listening;
  let gitServer4: Listening;
  let gitServer6: Listening | null;

  beforeEach(async () => {
    stubOutInheritedGitConfig();
    for (const name of PROXY_ENV_NAMES) vi.stubEnv(name, undefined);
    tmp = mkdtempSync(join(tmpdir(), 'cairn-git-loopback-proxy-'));

    const work = join(tmp, 'work');
    mkdirSync(work);
    gitIn(work, 'init', '-q', '-b', 'main');
    writeFileSync(join(work, 'a.txt'), 'a');
    gitIn(work, 'add', 'a.txt');
    gitIn(work, 'commit', '-q', '-m', 'init');
    const served = join(tmp, 'served');
    mkdirSync(served);
    gitIn(tmp, 'clone', '-q', '--bare', work, join(served, 'repo.git'));
    gitIn(join(served, 'repo.git'), 'update-server-info');

    proxyHits = [];
    proxy = await listen(
      createServer((req, res) => {
        proxyHits.push(req.url ?? '');
        res.writeHead(502).end();
      }),
      '127.0.0.1',
    );
    gitServer4 = await listen(dumbGitServer(served), '127.0.0.1');
    try {
      gitServer6 = await listen(dumbGitServer(served), '::1');
    } catch {
      gitServer6 = null;
    }

    const home = join(tmp, 'home');
    mkdirSync(home);
    writeFileSync(join(home, '.gitconfig'), `[http]\n\tproxy = http://127.0.0.1:${proxy.port}\n`);
    vi.stubEnv('HOME', home);
    vi.stubEnv('XDG_CONFIG_HOME', join(home, '.config'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeServer(proxy.server);
    await closeServer(gitServer4.server);
    if (gitServer6) await closeServer(gitServer6.server);
    rmSync(tmp, { recursive: true, force: true });
  });

  test('前置：全局代理确实劫持了不带豁免的 git（排除假绿）', async () => {
    const r = await runGit(['ls-remote', 'http://example.invalid/repo.git']);
    expect(r.code).not.toBe(0);
    expect(proxyHits.length).toBeGreaterThan(0);
  });

  test('machine 路 clone 127.0.0.1 server 成功且不经代理', async () => {
    const dir = join(tmp, 'clone-machine');
    await gitPrim.clone(`http://127.0.0.1:${gitServer4.port}/repo.git`, dir, null);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('a');
    expect(proxyHits).toEqual([]);
  });

  test('integration 路（per-step 凭证）clone 127.0.0.1 server 成功且不经代理', async () => {
    const url = `http://127.0.0.1:${gitServer4.port}/repo.git`;
    const dir = join(tmp, 'clone-cred');
    await gitPrim.clone(url, dir, { username: 'git', password: 'tok', url });
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('a');
    expect(proxyHits).toEqual([]);
  });

  test('localhost 写法同样直连', async () => {
    const dir = join(tmp, 'clone-localhost');
    await gitPrim.clone(`http://localhost:${gitServer4.port}/repo.git`, dir, null);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('a');
    expect(proxyHits).toEqual([]);
  });

  test('[::1] 写法同样直连', async (ctx) => {
    if (!gitServer6) ctx.skip();
    const dir = join(tmp, 'clone-v6');
    await gitPrim.clone(`http://[::1]:${gitServer6?.port}/repo.git`, dir, null);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('a');
    expect(proxyHits).toEqual([]);
  });

  test('fetch 回环 server 同样直连', async () => {
    const url = `http://127.0.0.1:${gitServer4.port}/repo.git`;
    const dir = join(tmp, 'clone-fetch');
    await gitPrim.clone(url, dir, null);
    await gitPrim.fetch(dir, null);
    expect(proxyHits).toEqual([]);
  });

  test('非回环远端保留用户的 http.proxy', async () => {
    const dir = join(tmp, 'clone-external');
    await expect(
      gitPrim.clone('http://cairn-external.invalid/repo.git', dir, null),
    ).rejects.toThrow(/502/);
    expect(proxyHits.length).toBeGreaterThan(0);
    expect(proxyHits[0]).toContain('cairn-external.invalid');
  });

  test('用户已有的 NO_PROXY 条目保留，非回环 host 仍走代理', async () => {
    vi.stubEnv('NO_PROXY', 'internal.example');
    const dirLoop = join(tmp, 'clone-keep-loop');
    await gitPrim.clone(`http://127.0.0.1:${gitServer4.port}/repo.git`, dirLoop, null);
    expect(proxyHits).toEqual([]);

    await expect(
      gitPrim.clone('http://cairn-external.invalid/repo.git', join(tmp, 'clone-keep-ext'), null),
    ).rejects.toThrow(/502/);
    expect(proxyHits.length).toBeGreaterThan(0);

    const r = await runGit(['-c', 'alias.showenv=!env', 'showenv']);
    const lines = r.stdout.split('\n');
    const expected = 'internal.example,127.0.0.1,localhost,::1';
    expect(lines).toContain(`NO_PROXY=${expected}`);
    expect(lines).toContain(`no_proxy=${expected}`);
  });
});
