// create_tag 本地工具 + tag 原语（XMON-111 T1）：annotated tag 创建与
// refs/tags 推送。凭证纪律同 push 原语（02 §5.4/§8）：per-step token 只经
// gitCredentialEnv env 注入，agent bash 拿不到——本工具是 tag 出机器的唯一通路。
// github 形态以「HTTP 远端 + Basic auth（x-access-token）」代位真 GitHub
// （git-hosting.test.ts 同款代位纪律：CI 无 GitHub 凭证，git 协议面同形）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 缺省 HEAD：annotated tag 带 message 落在 HEAD，返回可读成功文本
//   2. 指定 commit：tag 落在较旧 commit
//   3. message 缺省 = tag 名作注记文本
//   4. tag 已存在 → git 原错误文本（already exists）
//   5. tag 名 git 拒绝 → 原错误文本（not a valid tag name）
//   6. local 形态：cred null，file 远端真推送成功（refs/tags 落 origin）
//   7. tag 参数空 → 明确原因文本（不 spawn git）
//   8. 步未绑 repo（repoDir null）→ 明确原因文本
//   9. github 形态：per-step 凭证（x-access-token）经 Basic auth 真 HTTP
//      推送成功，refs/tags 落远端
//  10. 凭证步中失效（服务端拒 token）→ 可读 auth 失败原文，不静默成功
//  11. 推送被拒：远端已有同名异值 tag → git 拒绝原文，本地 tag 状态在文本里

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
/** 探针 token（形近真实 GitHub token 的假值；github 形态代位凭证）。 */
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
  /** bare origin（file 路径远端）。 */
  origin: string;
  /** origin 的克隆工作树（agent worktree 代位）。 */
  work: string;
  commit(file: string, message: string): Promise<string>;
}

/** 真 git 世界：bare origin + 种子提交 + 克隆工作树（workspace.ts 契约的
 * 最小等价形，local 形态同构：origin 即本地路径）。 */
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

// —— github 形态代位：HTTP 远端 + Basic auth（git http-backend CGI）———————

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

/** 最小 git smart-HTTP 服务：Basic auth 闸 + `git http-backend` CGI。
 * accept = 期望凭证（不符 = 401，等价 GitHub 撤销/过期 token 面）。 */
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
  /** bare origin 所在 HTTP 根（PATH_INFO 前缀 /o/r.git）。 */
  http: HttpGit;
  /** 远端 URL（work 树 origin）。 */
  remoteUrl: string;
  work: string;
  /** 远端 bare 目录（断言 refs 落库用）。 */
  remoteBare: string;
  commit(file: string, message: string): Promise<string>;
}

/** github 形态世界：bare origin 挂到 HTTP 代位远端（x-access-token Basic
 * auth），work 树 origin = http URL。 */
async function makeHttpWorld(prefix: string, accept: GitCredentials): Promise<HttpWorld> {
  const root = workdir(`${prefix}-http`);
  const world = await makeWorld(prefix);
  // bare origin 挪进 HTTP 根的 o/r.git 布局（GIT_PROJECT_ROOT=root）。
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

describe('create_tag — annotated tag 创建面（失败方式 1–8）', () => {
  test('失败方式 1：缺省 HEAD — annotated tag 带 message 落在 HEAD', async () => {
    const w = await makeWorld('head');
    const head = await w.commit('a.txt', 'feat a');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: 'v1.0.0', message: 'release v1.0.0' });
    expect(out).toContain('v1.0.0');
    // annotated：refs/tags/v1.0.0 解引用是 tag 对象，非 commit 直挂。
    expect(await git(['cat-file', '-t', 'refs/tags/v1.0.0'], w.work)).toBe('tag');
    // message 落注记。
    const msg = await git(['tag', '-l', '--format=%(contents:subject)', 'v1.0.0'], w.work);
    expect(msg).toBe('release v1.0.0');
    // 落在 HEAD。
    expect(await git(['rev-parse', 'v1.0.0^{commit}'], w.work)).toBe(head);
    // 推送面（cred null file 远端）也成功：refs/tags 落 origin。
    expect(await remoteTags(w.origin)).toContain('v1.0.0');
  });

  test('失败方式 2：指定 commit — tag 落在较旧 commit', async () => {
    const w = await makeWorld('commit');
    const older = await w.commit('a.txt', 'first');
    await w.commit('b.txt', 'second');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: 'v0.9', message: 'older point', commit: older });
    expect(out).toContain('v0.9');
    expect(await git(['rev-parse', 'v0.9^{commit}'], w.work)).toBe(older);
  });

  test('失败方式 3：message 缺省 = tag 名作注记文本', async () => {
    const w = await makeWorld('msg');
    await w.commit('a.txt', 'feat a');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    await tool.execute({ tag: 'v1.2.3' });
    const msg = await git(['tag', '-l', '--format=%(contents:subject)', 'v1.2.3'], w.work);
    expect(msg).toBe('v1.2.3');
  });

  test('失败方式 4：tag 已存在 → git 原错误文本', async () => {
    const w = await makeWorld('exists');
    await w.commit('a.txt', 'feat a');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    await tool.execute({ tag: 'v1.0.0', message: 'first' });
    const out = await tool.execute({ tag: 'v1.0.0', message: 'second' });
    expect(out).toContain('already exists');
    // 原注记不被覆盖。
    const msg = await git(['tag', '-l', '--format=%(contents:subject)', 'v1.0.0'], w.work);
    expect(msg).toBe('first');
  });

  test('失败方式 5：tag 名 git 拒绝 → 原错误文本', async () => {
    const w = await makeWorld('badname');
    await w.commit('a.txt', 'feat a');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: 'bad name~^', message: 'x' });
    expect(out).toContain('not a valid tag name');
  });

  test('失败方式 6：local 形态 — cred null，file 远端真推送成功', async () => {
    const w = await makeWorld('local');
    await w.commit('a.txt', 'feat a');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: 'v2.0.0', message: 'local push' });
    expect(out).toContain('v2.0.0');
    expect(await remoteTags(w.origin)).toContain('v2.0.0');
  });

  test('失败方式 7：tag 参数空 → 明确原因文本', async () => {
    const w = await makeWorld('emptytag');
    const tool = buildCreateTagTool({ repoDir: w.work, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: '  ' });
    expect(out).toContain('non-empty');
    expect(await remoteTags(w.origin)).toEqual([]);
  });

  test('失败方式 8：步未绑 repo（repoDir null）→ 明确原因文本', async () => {
    const tool = buildCreateTagTool({ repoDir: null, cred: null, identity: IDENTITY });
    const out = await tool.execute({ tag: 'v1.0.0' });
    expect(out).toContain('no repository');
  });
});

describe('create_tag — github 形态真推送（HTTP + x-access-token Basic auth 代位）', () => {
  test('失败方式 9：per-step 凭证注入真 HTTP 推送成功，refs/tags 落远端', async () => {
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

  test('失败方式 10：凭证步中失效（服务端拒 token）→ 可读 auth 失败原文', async () => {
    // 服务端只认 PROBE_TOKEN；工具持已失效旧 token → 401。
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
      // 远端无该 tag（未静默成功）。
      expect(await remoteTags(w.remoteBare)).not.toContain('v4.0.0');
    } finally {
      await w.http.close();
    }
  });

  test('失败方式 11：推送被拒 — 远端已有同名异值 tag → git 拒绝原文', async () => {
    const w = await makeHttpWorld('gh-reject', PROBE_CRED);
    try {
      const first = await w.commit('a.txt', 'first');
      // 远端先落 v5.0.0 指向 first。
      const okTool = buildCreateTagTool({
        repoDir: w.work,
        cred: { ...PROBE_CRED, url: w.remoteUrl },
        identity: IDENTITY,
      });
      await okTool.execute({ tag: 'v5.0.0', message: 'remote wins' });
      expect(await remoteTags(w.remoteBare)).toContain('v5.0.0');
      // 本地删 tag、前进 commit、在新 HEAD 重打同名异值 tag → 推送被拒。
      await git(['tag', '-d', 'v5.0.0'], w.work);
      await w.commit('b.txt', 'second');
      const out = await okTool.execute({ tag: 'v5.0.0', message: 'local conflict' });
      expect(out).toMatch(/rejected|already exists|fetch first/i);
      // 远端仍是 first 指向的 tag（未被覆盖）。
      const remoteSha = await git(['rev-parse', 'refs/tags/v5.0.0^{commit}'], w.remoteBare);
      expect(remoteSha).toBe(first);
    } finally {
      await w.http.close();
    }
  });
});
