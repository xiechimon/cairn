import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoundGitCredentials, GitCredentials } from '@cairn/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { commitEnv, runGit } from '../src/git.js';
import { buildCreateTagTool } from '../src/tag-tool.js';

const IDENTITY = { name: 'tag-agent', email: 'tag@cairn.local' };
const PROBE_TOKEN = 'ghp_PROBE0000000000000000000000000000';
const PROBE_CRED: GitCredentials = { username: 'x-access-token', password: PROBE_TOKEN };

const dirs: string[] = [];
function workdir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cairn-tag-${prefix}-`));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const r = await runGit(args, { cwd, env, timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

interface RepoWorld {
  origin: string;
  work: string;
  commit(file: string, message: string): Promise<string>;
}

async function makeWorld(prefix: string): Promise<RepoWorld> {
  const origin = workdir(`${prefix}-origin`);
  const seed = workdir(`${prefix}-seed`);
  const work = workdir(`${prefix}-work`);
  await runGit(['init', '--bare', origin], { timeoutMs: 60_000 });
  await git(['config', 'http.receivepack', 'true'], origin);
  await git(['config', 'http.uploadpack', 'true'], origin);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], origin);
  await runGit(['init', '-b', 'main', seed], { timeoutMs: 60_000 });
  writeFileSync(join(seed, 'README.md'), '# seed\n');
  await git(['add', '-A'], seed);
  await git(['commit', '-m', 'seed'], seed, commitEnv(IDENTITY));
  await git(['push', origin, 'refs/heads/main'], seed);
  await git(['clone', origin, work], join(origin, '..'));
  const commit = async (file: string, message: string): Promise<string> => {
    writeFileSync(join(work, file), `${message}\n`);
    await git(['add', '-A'], work);
    await git(['commit', '-m', message], work, commitEnv(IDENTITY));
    return git(['rev-parse', 'HEAD'], work);
  };
  return { origin, work, commit };
}

interface HttpGit {
  url: string;
  close(): Promise<void>;
}

function decodeChunked(buf: Buffer): Buffer {
  const out: Buffer[] = [];
  let pos = 0;
  for (;;) {
    const lineEnd = buf.indexOf('\n', pos);
    if (lineEnd === -1) break;
    const size = Number.parseInt(
      buf.subarray(pos, lineEnd).toString('ascii').trim().split(';')[0] ?? '',
      16,
    );
    if (!Number.isFinite(size) || Number.isNaN(size)) break;
    pos = lineEnd + 1;
    if (size === 0) break;
    out.push(buf.subarray(pos, pos + size));
    pos += size;
    if (buf[pos] === 0x0d) pos += 1;
    if (buf[pos] === 0x0a) pos += 1;
  }
  return Buffer.concat(out);
}

async function startHttpGit(opts: { root: string; accept: GitCredentials }): Promise<HttpGit> {
  const server = createServer((req, res) => {
    const want = `Basic ${Buffer.from(`${opts.accept.username}:${opts.accept.password}`).toString('base64')}`;
    if ((req.headers.authorization ?? '') !== want) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="git"' });
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const u = new URL(req.url ?? '/', 'http://localhost');
      const child = spawn('git', ['http-backend'], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: opts.root,
          GIT_HTTP_EXPORT_ALL: '1',
          PATH_INFO: u.pathname,
          QUERY_STRING: u.search.replace(/^\?/, ''),
          REQUEST_METHOD: req.method ?? 'GET',
          ...(req.headers['content-type'] ? { CONTENT_TYPE: req.headers['content-type'] } : {}),
          CONTENT_LENGTH: String(body.byteLength),
          GIT_COMMITTER_NAME: 'tag-http-e2e',
          GIT_COMMITTER_EMAIL: 'http@cairn.local',
        },
      });
      const out: Buffer[] = [];
      child.stdout.on('data', (c: Buffer) => out.push(c));
      child.stderr.resume();
      child.stdin.end(body);
      child.on('close', () => {
        const raw = Buffer.concat(out);
        const sepIdx = (() => {
          const a = raw.indexOf('\r\n\r\n');
          if (a !== -1) return { idx: a, len: 4 };
          const b = raw.indexOf('\n\n');
          return { idx: b, len: 2 };
        })();
        if (sepIdx.idx === -1) {
          res.writeHead(502);
          res.end(raw);
          return;
        }
        const headText = raw.subarray(0, sepIdx.idx).toString('utf8');
        let payload: Buffer = raw.subarray(sepIdx.idx + sepIdx.len);
        let status = 200;
        const headers: [string, string][] = [];
        let chunked = false;
        for (const line of headText.split(/\r?\n/)) {
          const colon = line.indexOf(':');
          if (colon === -1) continue;
          const name = line.slice(0, colon).trim();
          const value = line.slice(colon + 1).trim();
          if (name.toLowerCase() === 'status') {
            status = Number.parseInt(value, 10) || 200;
            continue;
          }
          if (name.toLowerCase() === 'transfer-encoding') {
            chunked = value.toLowerCase().includes('chunked');
            continue;
          }
          headers.push([name, value]);
        }
        if (chunked) payload = decodeChunked(payload);
        res.writeHead(status, headers);
        res.end(payload);
      });
    });
  });
  server.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
      }),
  };
}

interface HttpWorld {
  http: HttpGit;
  remoteUrl: string;
  work: string;
  remoteBare: string;
  commit(file: string, message: string): Promise<string>;
}

async function makeHttpWorld(prefix: string, accept: GitCredentials): Promise<HttpWorld> {
  const root = workdir(`${prefix}-http`);
  const world = await makeWorld(prefix);
  const remoteBare = join(root, 'o', 'r.git');
  cpSync(world.origin, remoteBare, { recursive: true });
  const http = await startHttpGit({ root, accept });
  const remoteUrl = `${http.url}/o/r.git`;
  await git(['remote', 'set-url', 'origin', remoteUrl], world.work);
  return {
    http,
    remoteUrl,
    work: world.work,
    remoteBare,
    commit: world.commit,
  };
}

async function remoteTags(bareDir: string): Promise<string[]> {
  const out = await git(['for-each-ref', 'refs/tags', '--format=%(refname:short)'], bareDir);
  return out === '' ? [] : out.split('\n');
}

describe('create_tag — annotated tag creation surface (failure modes 1–8)', () => {
  test('failure mode 1: default HEAD — annotated tag with a message lands on HEAD', async () => {
    const w = await makeWorld('head');
    const head = await w.commit('a.txt', 'feat a');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: 'v1.0.0', message: 'release v1.0.0' });
    expect(out).toContain('v1.0.0');
    expect(await git(['cat-file', '-t', 'refs/tags/v1.0.0'], w.work)).toBe('tag');
    const msg = await git(['tag', '-l', '--format=%(contents:subject)', 'v1.0.0'], w.work);
    expect(msg).toBe('release v1.0.0');
    expect(await git(['rev-parse', 'v1.0.0^{commit}'], w.work)).toBe(head);
    expect(await remoteTags(w.origin)).toContain('v1.0.0');
  });

  test('failure mode 2: specified commit — tag lands on an older commit', async () => {
    const w = await makeWorld('commit');
    const older = await w.commit('a.txt', 'first');
    await w.commit('b.txt', 'second');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: 'v0.9', message: 'older point', commit: older });
    expect(out).toContain('v0.9');
    expect(await git(['rev-parse', 'v0.9^{commit}'], w.work)).toBe(older);
  });

  test('failure mode 3: message absent = tag name used as the annotation text', async () => {
    const w = await makeWorld('msg');
    await w.commit('a.txt', 'feat a');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    await tool.execute({ tag: 'v1.2.3' });
    const msg = await git(['tag', '-l', '--format=%(contents:subject)', 'v1.2.3'], w.work);
    expect(msg).toBe('v1.2.3');
  });

  test("failure mode 4: tag already exists → git's original error text", async () => {
    const w = await makeWorld('exists');
    await w.commit('a.txt', 'feat a');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    await tool.execute({ tag: 'v1.0.0', message: 'first' });
    const out = await tool.execute({ tag: 'v1.0.0', message: 'second' });
    expect(out).toContain('already exists');
    const msg = await git(['tag', '-l', '--format=%(contents:subject)', 'v1.0.0'], w.work);
    expect(msg).toBe('first');
  });

  test('failure mode 5: tag name refused by git → original error text', async () => {
    const w = await makeWorld('badname');
    await w.commit('a.txt', 'feat a');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: 'bad name~^', message: 'x' });
    expect(out).toContain('not a valid tag name');
  });

  test('failure mode 6: local shape — cred null, real push to the file remote succeeds', async () => {
    const w = await makeWorld('local');
    await w.commit('a.txt', 'feat a');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: 'v2.0.0', message: 'local push' });
    expect(out).toContain('v2.0.0');
    expect(await remoteTags(w.origin)).toContain('v2.0.0');
  });

  test('failure mode 7: empty tag argument → explicit reason text', async () => {
    const w = await makeWorld('emptytag');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: '  ' });
    expect(out).toContain('non-empty');
    expect(await remoteTags(w.origin)).toEqual([]);
  });

  test('failure mode 8: step not bound to a repo (repoDir null) → explicit reason text', async () => {
    const tool = buildCreateTagTool({ repoDir: null, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: 'v1.0.0' });
    expect(out).toContain('no repository');
  });
});

describe('create_tag — github shape real push (HTTP + x-access-token Basic auth stand-in)', () => {
  test('failure mode 9: per-step credentials injected, real HTTP push succeeds, refs/tags land on the remote', async () => {
    const w = await makeHttpWorld('gh-ok', PROBE_CRED);
    try {
      await w.commit('a.txt', 'feat a');
      const tool = buildCreateTagTool({
        repoDir: w.work,
        cred: { ...PROBE_CRED, url: w.remoteUrl },
        identity: IDENTITY,
      });
      const out = await tool.execute({ tag: 'v3.0.0', message: 'github shape push' });
      expect(out).toContain('v3.0.0');
      expect(await remoteTags(w.remoteBare)).toContain('v3.0.0');
    } finally {
      await w.http.close();
    }
  });

  test('failure mode 10: credential expired mid-step (server rejects token) → readable auth-failure original text', async () => {
    const w = await makeHttpWorld('gh-expired', PROBE_CRED);
    try {
      await w.commit('a.txt', 'feat a');
      const expired: BoundGitCredentials = {
        username: 'x-access-token',
        password: 'ghp_EXPIRED00000000000000000000000000',
        url: w.remoteUrl,
      };
      const tool = buildCreateTagTool({ repoDir: w.work, cred: expired, identity: IDENTITY });
      const out = await tool.execute({ tag: 'v4.0.0', message: 'will fail auth' });
      expect(out).toMatch(/401|Authentication failed|HTTP Basic: Access denied/i);
      expect(await remoteTags(w.remoteBare)).not.toContain('v4.0.0');
    } finally {
      await w.http.close();
    }
  });

  test('failure mode 11: push refused — remote already has a same-named tag with a different value → git refusal original text', async () => {
    const w = await makeHttpWorld('gh-reject', PROBE_CRED);
    try {
      const first = await w.commit('a.txt', 'first');
      const okTool = buildCreateTagTool({
        repoDir: w.work,
        cred: { ...PROBE_CRED, url: w.remoteUrl },
        identity: IDENTITY,
      });
      await okTool.execute({ tag: 'v5.0.0', message: 'remote wins' });
      expect(await remoteTags(w.remoteBare)).toContain('v5.0.0');
      await git(['tag', '-d', 'v5.0.0'], w.work);
      await w.commit('b.txt', 'second');
      const out = await okTool.execute({ tag: 'v5.0.0', message: 'local conflict' });
      expect(out).toMatch(/rejected|already exists|fetch first/i);
      const remoteSha = await git(['rev-parse', 'refs/tags/v5.0.0^{commit}'], w.remoteBare);
      expect(remoteSha).toBe(first);
    } finally {
      await w.http.close();
    }
  });
});
