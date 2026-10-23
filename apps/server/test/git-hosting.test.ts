// repo 托管双形态 E2E（02 §3/A4 契约实走）：
// - 托管 = server 本地 bare repo + `git http-backend` CGI：真 git 客户端经真
//   HTTP clone/push 实走绿（凭证纪律 r3 §1.4：手动 fetch 无凭证失败 = 401 面）；
//   文件浏览面 tree?ref=/file?path=&ref= 读裸库（r3 §8.2）。
// - 接入 = GitHub：记录面（owner/repo + cloneUrl 派生）+ executor 契约实走
//   （conv-* 分支 push 到用户自有 repo，02 §3/§5.5）——CI 无 GitHub 凭证，
//   远端以本地 bare 代位（git 协议面同形）。
// git 客户端调用带 GIT_TERMINAL_PROMPT=0（401 时不吊住等输入）。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAND, conversationBranch, type ProjectRecord } from '@cairn/shared';
import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runGit } from '../src/lib/git.js';
import { newUuidv7 } from '../src/lib/ids.js';
import { bootServer, insertGitApiKey, req, type TestServer } from './helpers.js';

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  // 隔离用户/系统 git 配置——否则本机的 `credential.helper=osxkeychain` 会把
  // 「匿名 clone 必失败」这条断言变成随机红：git 的 credential host **带端口**
  // （非默认端口时形如 host:port），而本文件的测试服务器绑随机端口，一旦撞上
  // 钥匙串里历史遗留的 127.0.0.1:<port> 条目（authenticated clone 会写进去），
  // 匿名 clone 就被悄悄补上凭证 → 服务端放行 → 退出码 0，断言 `not.toBe(0)` 失败。
  // 实测（2026-09-28）：默认配置下 `git credential fill` 对 127.0.0.1:64052 能取到
  // password；加这两条后取不到。顺带隔离掉用户 http.proxy（本地回环不该走代理）。
  // CI（ubuntu）无钥匙串，故该抖动只在开发机上偶发。
  //
  // 为何跨运行仍有效：本文件的 API_KEY 是**硬编码常量**（见下方 API_KEY），所以
  // 任何一次运行写进钥匙串的凭证对后续运行照样通过校验。另：不隔离时本套测试会
  // **往开发者的钥匙串写凭证**（每次 authenticated clone 一次），隔离后不再写。
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'r3-probe',
  GIT_AUTHOR_EMAIL: 'probe@localhost',
  GIT_COMMITTER_NAME: 'r3-probe',
  GIT_COMMITTER_EMAIL: 'probe@localhost',
};

const dirs: string[] = [];
function workdir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cairn-git-${prefix}-`));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let s: TestServer;
let baseUrl: string;
let closeServer: () => Promise<void>;
const API_KEY = 'cairn_e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0'; // 形态示意（发行面归 M2c）

beforeAll(async () => {
  s = bootServer();
  insertGitApiKey(s, API_KEY);
  const server = serve({ fetch: s.app.fetch, port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
});

afterAll(async () => {
  await closeServer();
  s.dispose();
});

async function createProject(body: unknown): Promise<ProjectRecord> {
  const res = await req(s.app, 'POST', '/api/projects', body);
  expect(res.status).toBe(201);
  return (await res.json()) as ProjectRecord;
}

/** 托管远端 URL（record.cloneUrl 的 origin 随请求源；测试面 app.request 无真
 * 端口，取 pathname 拼真 server 源）。 */
function hostedUrl(record: ProjectRecord): string {
  return `${baseUrl}${new URL(record.cloneUrl as string).pathname}`;
}

/** 带凭证的托管远端 URL（用户名位忽略、密码位 = API key，PAT 同款 [设计]）。 */
function authedUrl(record: ProjectRecord): string {
  const url = new URL(hostedUrl(record));
  url.username = 'git';
  url.password = API_KEY;
  return url.toString();
}

async function git(args: string[], cwd: string) {
  return runGit(args, { cwd, env: GIT_ENV, timeoutMs: 60_000 });
}

describe('托管形态：bare repo + git http-backend（02 §3 锁定）', () => {
  test('POST /api/projects repoKind:hosted → bare repo 落地 + record 带 repoName/cloneUrl', async () => {
    const record = await createProject({ name: 'r3-lifecycle', repoKind: 'hosted' });
    expect(record.repoKind).toBe('hosted');
    expect(record.repoName).toBe('r3-lifecycle'); // slug = 原名同形（r3 daemon.log 样本）
    // 形状对应 r3 §1.4 `https://git.todos.dev/<teamId>/<repoName>`（域名段 = 本地
    // 主机代位 + 同源 /git 前缀 [设计]）：路径尾段 = <teamId>/<repoName>
    expect(new URL(record.cloneUrl as string).pathname).toBe(`/git/${s.team.id}/r3-lifecycle`);
    const dir = join(s.reposDir, s.team.id, 'r3-lifecycle.git');
    const head = await git(['symbolic-ref', '--short', 'HEAD'], dir);
    expect(head.stdout.toString().trim()).toBe('main'); // 默认分支 main（r3 §3.6 origin/main）
  });

  test('凭证纪律（r3 §1.4：手动 fetch 无凭证失败）：匿名 clone → 401 → git 非零退', async () => {
    const record = await createProject({ name: 'anon-probe', repoKind: 'hosted' });
    const dir = workdir('anon');
    const r = await git(['clone', hostedUrl(record), join(dir, 'repo')], dir);
    expect(r.code).not.toBe(0);
    // 401 + WWW-Authenticate（HTTP 面直查）
    const res = await fetch(`${hostedUrl(record)}/info/refs?service=git-upload-pack`);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic realm=');
    // 错误凭证同样 401
    const bad = new URL(hostedUrl(record));
    bad.username = 'git';
    bad.password = 'cairn_wrong';
    const r2 = await git(['clone', bad.toString(), join(dir, 'repo2')], dir);
    expect(r2.code).not.toBe(0);
  });

  test('clone/commit/push 实走绿（http-backend CGI 全链）→ branches/tree/file 读回', async () => {
    const record = await createProject({ name: 'push-probe', repoKind: 'hosted' });
    const dir = workdir('push');
    const repoDir = join(dir, 'repo');
    // clone（空库容忍）
    const clone = await git(['clone', authedUrl(record), repoDir], dir);
    expect(clone.code, clone.stderr).toBe(0);
    // 首个提交进 main（-B：空库 clone 的本地 unborn HEAD 名不定，强制落 main）
    const readme = '# push-probe\n\n托管形态实走。\n';
    writeFileSync(join(repoDir, 'README.md'), readme);
    expect((await git(['checkout', '-B', 'main'], repoDir)).code).toBe(0);
    expect((await git(['add', 'README.md'], repoDir)).code).toBe(0);
    expect((await git(['commit', '-m', 'docs: README'], repoDir)).code).toBe(0);
    const push = await git(['push', '-u', 'origin', 'main'], repoDir);
    expect(push.code, push.stderr).toBe(0);

    // branches（「分支与 PR」区数据面）
    const branches = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/branches`)
    ).json()) as { defaultBranch: string | null; branches: { name: string; isDefault: boolean }[] };
    expect(branches.defaultBranch).toBe('main');
    expect(branches.branches).toContainEqual({ name: 'main', isDefault: true });

    // tree?ref=（读裸库 ref 树，无检出要求，02 §3）
    const tree = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/tree?ref=main`)
    ).json()) as {
      ref: string;
      commit: string;
      entries: { name: string; path: string; type: string; size: number | null }[];
    };
    expect(tree.ref).toBe('main');
    expect(tree.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(tree.entries).toContainEqual({
      name: 'README.md',
      path: 'README.md',
      type: 'blob',
      size: Buffer.byteLength(readme),
    });

    // file?path=&ref=（单文件读回；83 号验证同款「main README 读回」语义）
    const file = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/file?path=README.md&ref=main`)
    ).json()) as { encoding: string; content: string; size: number };
    expect(file.encoding).toBe('utf-8');
    expect(file.content).toBe(readme);
    expect(file.size).toBe(Buffer.byteLength(readme));

    // 缺 ref → HEAD（= main）
    const headTree = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/tree`)
    ).json()) as { entries: unknown[] };
    expect(headTree.entries).toHaveLength(1);
  });

  // files 全递归候选面（#760 composer `@` 候选源）：一次打全仓路径表。
  // 失败方式钉死：
  //   F1 大仓无界 → limit 缺省 2000/最大 5000，超了 git 序截断 + truncated；
  //   F2 子模块 gitlink（commit 型）列出来也读不了 → 服务端滤掉；
  //   F3 插入的 path agent 侧读不到 → round-trip：候选 path 原样 file?path=
  //      取回字节（裸路径可读性的 wire 实证）；
  //   F4 坏 ref / 非托管 / 未知项目 → 404（tree/file 同口径，web 静默退回
  //      agents-only）。
  test('GET /api/projects/{id}/files → 全递归 + 目录条目 + 上界 + round-trip（#760）', async () => {
    const record = await createProject({ name: 'files-probe', repoKind: 'hosted' });
    const dir = workdir('files');
    const repoDir = join(dir, 'repo');
    expect((await git(['clone', authedUrl(record), repoDir], dir)).code).toBe(0);
    writeFileSync(join(repoDir, 'README.md'), '# files-probe\n');
    mkdirSync(join(repoDir, 'apps', 'web', 'src'), { recursive: true });
    writeFileSync(join(repoDir, 'apps', 'web', 'src', 'button.tsx'), 'export const B = 1;\n');
    writeFileSync(join(repoDir, 'apps', 'web', 'src', 'with space.ts'), 'export const S = 1;\n');
    expect((await git(['checkout', '-B', 'main'], repoDir)).code).toBe(0);
    expect((await git(['add', '.'], repoDir)).code).toBe(0);
    // 子模块 gitlink（160000）：目标须是真实对象（新 git 拒绝空 sha 入 index；
    // hash-object 写一个哑 blob 取 sha——ls-tree 只读 tree 对象，目标内容无妨）
    const subSha = (await git(['hash-object', '-w', 'apps/web/src/button.tsx'], repoDir)).stdout
      .toString()
      .trim();
    expect(subSha).toMatch(/^[0-9a-f]{40}$/);
    expect(
      (await git(['update-index', '--add', '--cacheinfo', '160000', subSha, 'vendor/sub'], repoDir))
        .code,
    ).toBe(0);
    expect((await git(['commit', '-m', 'feat: files'], repoDir)).code).toBe(0);
    expect((await git(['push', '-u', 'origin', 'main'], repoDir)).code, 'push').toBe(0);

    const res = await req(s.app, 'GET', `/api/projects/${record.id}/files?ref=main`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ref: string;
      commit: string;
      truncated: boolean;
      files: { path: string; type: string; size: number | null }[];
    };
    expect(body.ref).toBe('main');
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(body.truncated).toBe(false);
    const paths = body.files.map((f) => f.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('apps/web/src/button.tsx');
    expect(paths).toContain('apps/web/src/with space.ts');
    // 目录条目（tree 型，插入时尾随 `/`，CC rule 28/29 同款）
    expect(paths).toContain('apps');
    expect(paths).toContain('apps/web/src');
    expect(body.files.find((f) => f.path === 'apps')?.type).toBe('tree');
    // 子模块 gitlink 滤掉（F2：列出来也读不了的死候选）——父目录 vendor/
    // 作为 tree 照常保留，只有 commit 型条目本身消失
    expect(paths).not.toContain('vendor/sub');
    expect(paths).toContain('vendor');

    // 上界（F1）：limit=2 → 截断 + 置位；非法 limit → 缺省，不 400
    const capped = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/files?ref=main&limit=2`)
    ).json()) as { truncated: boolean; files: unknown[] };
    expect(capped.files).toHaveLength(2);
    expect(capped.truncated).toBe(true);
    const fallback = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/files?ref=main&limit=abc`)
    ).json()) as { truncated: boolean; files: { path: string }[] };
    expect(fallback.truncated).toBe(false);
    expect(fallback.files.length).toBe(body.files.length);

    // round-trip（F3）：候选 path 原样取回字节
    const file = (await (
      await req(
        s.app,
        'GET',
        `/api/projects/${record.id}/file?path=apps/web/src/button.tsx&ref=main`,
      )
    ).json()) as { content: string };
    expect(file.content).toBe('export const B = 1;\n');

    // 坏 ref → 404（F4）
    expect(
      (await req(s.app, 'GET', `/api/projects/${record.id}/files?ref=no-such-ref`)).status,
    ).toBe(404);
  });

  // commits 读面（#149 文件|历史 分段「历史」数据源；[推断] 路由，
  // wire.test INFERRED_ROUTES 登记）：种子提交 + README 提交 = 2 行，
  // 新→旧序（git log 同序），行形 = sha/shortSha/message/authorName/at。
  test('GET /api/projects/{id}/commits → 提交历史新到旧读回', async () => {
    const record = await createProject({ name: 'commits-probe', repoKind: 'hosted' });
    const dir = workdir('commits');
    const repoDir = join(dir, 'repo');
    expect((await git(['clone', authedUrl(record), repoDir], dir)).code).toBe(0);
    writeFileSync(join(repoDir, 'README.md'), '# commits-probe\n');
    expect((await git(['checkout', '-B', 'main'], repoDir)).code).toBe(0);
    expect((await git(['add', 'README.md'], repoDir)).code).toBe(0);
    expect((await git(['commit', '-m', 'docs: README'], repoDir)).code).toBe(0);
    expect((await git(['push', '-u', 'origin', 'main'], repoDir)).code, 'push').toBe(0);

    const res = await req(s.app, 'GET', `/api/projects/${record.id}/commits`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ref: string;
      commits: { sha: string; shortSha: string; message: string; authorName: string; at: number }[];
    };
    expect(body.ref).toBe('main');
    // 种子提交（空树）+ README 提交；新→旧
    expect(body.commits).toHaveLength(2);
    const head = body.commits[0]!;
    expect(head.message).toBe('docs: README');
    expect(head.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(head.shortSha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(head.sha.startsWith(head.shortSha)).toBe(true);
    expect(head.authorName).toBe('r3-probe');
    expect(head.at).toBeGreaterThan(0);
    expect(Number.isFinite(head.at)).toBe(true);

    // 非托管形态无本地读面 → 404（tree/file/branches 同族口径）
    const github = await createProject({
      name: 'gh-probe',
      repoKind: 'github',
      githubRepo: 'octocat/hello',
    });
    const ghRes = await req(s.app, 'GET', `/api/projects/${github.id}/commits`);
    expect(ghRes.status).toBe(404);
    // 未知项目 → 404
    expect((await req(s.app, 'GET', `/api/projects/${newUuidv7()}/commits`)).status).toBe(404);
  });

  // 提交详情读面（#1102 历史行点击 → 该提交 diff；[推断] 路由，wire.test
  // INFERRED_ROUTES 登记）。仓形 = 种子提交（根、空树）→ README → main 侧
  // another.txt → --no-ff 合入 side 分支（side.txt）：一棵树上同时钉住
  // S5（merge = 第一父 diff，combined 恒空集的反面）、S6（根空提交 files=[]
  // 定义态）、S3（不可达/注入形 404）、S7（元信息与列表行同源一致）。
  // S4（根提交全文件新增）需要根提交带文件——钉在 project-local.test.ts F6。
  test('GET /api/projects/{id}/commits/{sha} → 元信息 + 第一父 diff；边界 404/定义态', async () => {
    const record = await createProject({ name: 'commit-detail-probe', repoKind: 'hosted' });
    const dir = workdir('commit-detail');
    const repoDir = join(dir, 'repo');
    expect((await git(['clone', authedUrl(record), repoDir], dir)).code).toBe(0);
    writeFileSync(join(repoDir, 'README.md'), '# detail-probe\n');
    expect((await git(['checkout', '-B', 'main'], repoDir)).code).toBe(0);
    expect((await git(['add', 'README.md'], repoDir)).code).toBe(0);
    expect((await git(['commit', '-m', 'docs: README detail'], repoDir)).code).toBe(0);
    expect((await git(['checkout', '-b', 'side'], repoDir)).code).toBe(0);
    writeFileSync(join(repoDir, 'side.txt'), 'side work\n');
    expect((await git(['add', 'side.txt'], repoDir)).code).toBe(0);
    expect((await git(['commit', '-m', 'side: add side.txt'], repoDir)).code).toBe(0);
    expect((await git(['checkout', 'main'], repoDir)).code).toBe(0);
    writeFileSync(join(repoDir, 'another.txt'), 'main work\n');
    expect((await git(['add', 'another.txt'], repoDir)).code).toBe(0);
    expect((await git(['commit', '-m', 'main: add another.txt'], repoDir)).code).toBe(0);
    expect(
      (await git(['merge', '--no-ff', 'side', '-m', 'merge side into main'], repoDir)).code,
    ).toBe(0);
    expect((await git(['push', '-u', 'origin', 'main'], repoDir)).code, 'push').toBe(0);

    const list = (await (await req(s.app, 'GET', `/api/projects/${record.id}/commits`)).json()) as {
      commits: { sha: string; shortSha: string; message: string; authorName: string; at: number }[];
    };
    // 种子（根、空树）+ README + side + another + merge = 5（git log 含被合
    // 分支的提交，非 first-parent 序）
    expect(list.commits).toHaveLength(5);
    const byMessage = Object.fromEntries(list.commits.map((c) => [c.message, c]));
    const merge = byMessage['merge side into main']!;
    const readme = byMessage['docs: README detail']!;
    const seed = byMessage[`init ${record.repoName}`]!;

    type Detail = {
      sha: string;
      shortSha: string;
      message: string;
      authorName: string;
      at: number;
      files: {
        path: string;
        additions: number;
        deletions: number;
        hunks: { header: string; lines: string[] }[];
      }[];
    };

    // merge 提交（S5）：diff = 相对第一父 = side 带来的 side.txt；默认
    // combined diff 对这条干净 merge 恒空集——files 非空即钉死 --first-parent
    const mergeRes = await req(s.app, 'GET', `/api/projects/${record.id}/commits/${merge.sha}`);
    expect(mergeRes.status).toBe(200);
    const mergeDetail = (await mergeRes.json()) as Detail;
    expect(mergeDetail.files.map((f) => f.path)).toEqual(['side.txt']);
    expect(mergeDetail.files[0]?.additions).toBe(1);
    // S7 元信息与列表行一致（同 %x00 格式串同源）
    expect(mergeDetail.sha).toBe(merge.sha);
    expect(mergeDetail.shortSha).toBe(merge.shortSha);
    expect(mergeDetail.message).toBe(merge.message);
    expect(mergeDetail.authorName).toBe(merge.authorName);
    expect(mergeDetail.at).toBe(merge.at);

    // 普通提交：README.md 全文件新增行
    const readmeDetail = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/commits/${readme.sha}`)
    ).json()) as Detail;
    expect(readmeDetail.files).toHaveLength(1);
    expect(readmeDetail.files[0]?.path).toBe('README.md');
    expect(readmeDetail.files[0]?.hunks[0]?.lines).toContain('+# detail-probe');

    // 种子提交（根、空树，S6）：files=[] 定义态——200 不是 404/500
    const seedRes = await req(s.app, 'GET', `/api/projects/${record.id}/commits/${seed.sha}`);
    expect(seedRes.status).toBe(200);
    expect(((await seedRes.json()) as Detail).files).toEqual([]);

    // S3 不可达 sha → 404；注入形（rev-parse --end-of-options 拒绝）→ 404
    expect(
      (await req(s.app, 'GET', `/api/projects/${record.id}/commits/${'0'.repeat(40)}`)).status,
    ).toBe(404);
    expect(
      (
        await req(
          s.app,
          'GET',
          `/api/projects/${record.id}/commits/${encodeURIComponent('HEAD; echo hacked')}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await req(
          s.app,
          'GET',
          `/api/projects/${record.id}/commits/${encodeURIComponent('--output=/tmp/evil')}`,
        )
      ).status,
    ).toBe(404);

    // 非托管形态无本地读面 → 404（commits 列表面同族口径）
    const github = await createProject({
      name: 'gh-detail-probe',
      repoKind: 'github',
      githubRepo: 'octocat/hello',
    });
    expect(
      (await req(s.app, 'GET', `/api/projects/${github.id}/commits/${'0'.repeat(40)}`)).status,
    ).toBe(404);
    // 未知项目 → 404
    expect(
      (await req(s.app, 'GET', `/api/projects/${newUuidv7()}/commits/${'0'.repeat(40)}`)).status,
    ).toBe(404);
  });

  test('conv 分支 push（02 §5.5：conv-<conversationId>）+ 二进制文件 base64', async () => {
    const record = await createProject({ name: 'conv-probe', repoKind: 'hosted' });
    const dir = workdir('conv');
    const repoDir = join(dir, 'repo');
    await git(['clone', authedUrl(record), repoDir], dir);
    // 基座 main 先立（空库无 ref 不能 worktree；种子提交）
    writeFileSync(join(repoDir, 'README.md'), '# conv-probe\n');
    await git(['checkout', '-B', 'main'], repoDir);
    await git(['add', '.'], repoDir);
    await git(['commit', '-m', 'init'], repoDir);
    await git(['push', '-u', 'origin', 'main'], repoDir);
    // 任务分支 = 品牌前缀 + conversationId（02 §5.5 词表；前缀 cairn/ 品牌位，D3 已切换 #109）
    const convId = '01a0b85b-0000-7000-8000-000000000000';
    const branch = conversationBranch(convId);
    expect(branch).toBe(`${BRAND.branchPrefix}${convId}`);
    expect((await git(['checkout', '-b', branch], repoDir)).code).toBe(0);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // ‰PNG 魔数段
    writeFileSync(join(repoDir, 'icon.png'), png);
    await git(['add', '.'], repoDir);
    await git(['commit', '-m', 'feat: icon'], repoDir);
    const push = await git(['push', '-u', 'origin', branch], repoDir);
    expect(push.code, push.stderr).toBe(0);
    // 分支面读回 + conv 分支 tree
    const branches = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/branches`)
    ).json()) as { branches: { name: string }[] };
    expect(branches.branches.map((b) => b.name).sort()).toEqual(['main', branch].sort());
    const file = (await (
      await req(s.app, 'GET', `/api/projects/${record.id}/file?path=icon.png&ref=${branch}`)
    ).json()) as { encoding: string; content: string };
    expect(file.encoding).toBe('base64');
    expect(Buffer.from(file.content, 'base64').equals(png)).toBe(true);
  });

  test('同名项目 repoName 唯一化（-2 后缀 [设计]）；未知 repo 404', async () => {
    const first = await createProject({ name: 'dupe probe', repoKind: 'hosted' });
    const second = await createProject({ name: 'dupe probe', repoKind: 'hosted' });
    expect(first.repoName).toBe('dupe-probe'); // slug：空格 → -
    expect(second.repoName).toBe('dupe-probe-2');
    const r = await fetch(
      `${baseUrl}/git/${s.team.id}/no-such-repo/info/refs?service=git-upload-pack`,
      {
        headers: { authorization: `Basic ${Buffer.from(`git:${API_KEY}`).toString('base64')}` },
      },
    );
    expect(r.status).toBe(404);
  });

  test('文件面错误形状：缺 path 400 / 未知 ref·文件 404 / github 项目无本地库 404', async () => {
    const record = await createProject({ name: 'err-probe', repoKind: 'hosted' });
    const missingPath = await req(s.app, 'GET', `/api/projects/${record.id}/file`);
    expect(missingPath.status).toBe(400);
    expect(Object.keys((await missingPath.json()) as Record<string, unknown>)).toEqual(['error']);
    const badRef = await req(s.app, 'GET', `/api/projects/${record.id}/tree?ref=no-such-ref`);
    expect(badRef.status).toBe(404);
    // 路径护栏：`..` 段拒绝（400 族，绝不逃逸裸库）
    const traversal = await req(s.app, 'GET', `/api/projects/${record.id}/file?path=../server.db`);
    expect(traversal.status).toBe(400);
    const gh = await createProject({
      name: 'imported',
      repoKind: 'github',
      githubRepo: 'octocat/hello',
    });
    expect((await req(s.app, 'GET', `/api/projects/${gh.id}/tree`)).status).toBe(404);
    // files 面同口径：非托管无本地库 404 + 未知项目 404（F4）
    expect((await req(s.app, 'GET', `/api/projects/${gh.id}/files`)).status).toBe(404);
    expect((await req(s.app, 'GET', `/api/projects/${newUuidv7()}/files`)).status).toBe(404);
  });
});

describe('GitHub 接入形态（02 §3：记录面 + executor 契约实走）', () => {
  test('POST repoKind:github → owner/repo 记录 + cloneUrl 派生；坏 owner/repo 400', async () => {
    const record = await createProject({
      name: 'imported',
      repoKind: 'github',
      githubRepo: 'octocat/hello',
    });
    expect(record.repoKind).toBe('github');
    expect(record.githubRepo).toBe('octocat/hello');
    expect(record.cloneUrl).toBe('https://github.com/octocat/hello.git');
    const bad = await req(s.app, 'POST', '/api/projects', {
      name: 'bad',
      repoKind: 'github',
      githubRepo: 'no-slash',
    });
    expect(bad.status).toBe(400);
    // GET /api/projects 读回同形
    const list = (await (await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`)).json()) as
      | ProjectRecord[]
      | { error: string };
    expect(Array.isArray(list)).toBe(true);
    const found = (list as ProjectRecord[]).find((p) => p.id === record.id);
    expect(found).toMatchObject({ repoKind: 'github', githubRepo: 'octocat/hello' });
  });

  test('executor 契约实走：clone 用户自有 repo → conv-* 分支 → push（远端本地 bare 代位）', async () => {
    // GitHub 远端代位：本地 bare（git 协议面同形；CI 无 GitHub 凭证）。
    const remoteDir = join(workdir('gh-remote'), 'hello.git');
    expect((await runGit(['init', '--bare', remoteDir], { env: GIT_ENV })).code).toBe(0);
    const record = await createProject({
      name: 'imported',
      repoKind: 'github',
      githubRepo: 'octocat/hello',
    });
    expect(record.cloneUrl).toContain('github.com'); // 记录面指向 GitHub；实走用代位远端

    const dir = workdir('gh-walk');
    const repoDir = join(dir, 'repo');
    expect((await git(['clone', remoteDir, repoDir], dir)).code).toBe(0);
    writeFileSync(join(repoDir, 'CHANGELOG.md'), '# changelog\n');
    await git(['checkout', '-B', 'main'], repoDir);
    await git(['add', '.'], repoDir);
    await git(['commit', '-m', 'docs: changelog'], repoDir);
    await git(['push', '-u', 'origin', 'main'], repoDir);
    // executor push conv-* 分支（02 §3 GitHub 行；分支词表 02 §5.5）
    const branch = conversationBranch(newUuidv7());
    expect((await git(['checkout', '-b', branch], repoDir)).code).toBe(0);
    writeFileSync(join(repoDir, 'CHANGELOG.md'), '# changelog\n\n- conv 轮改动\n');
    await git(['add', '.'], repoDir);
    await git(['commit', '-m', 'feat: conv round'], repoDir);
    const push = await git(['push', '-u', 'origin', branch], repoDir);
    expect(push.code, push.stderr).toBe(0);
    // 远端读回：conv 分支在（PR 建卡面依赖 GitHub API，归 M3+）
    const lsRemote = await git(['ls-remote', '--heads', remoteDir], dir);
    const heads = lsRemote.stdout.toString();
    expect(heads).toContain('refs/heads/main');
    expect(heads).toContain(`refs/heads/${branch}`);
    expect(branch.startsWith(BRAND.branchPrefix)).toBe(true);
  });
});
