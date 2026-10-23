// spec 12 / #359 G2-T1：POST /api/projects local 形态——localPath 校验
// （`~` 展开 + 绝对路径要求；存在性/git 仓判定下沉到 daemon 端预检，
// 仿 Multica local_directory：server 只验形态）+ body 双名兼容
// （kind = spec 12 数据契约面，repoKind = 既有 wire 面；kind 优先）。
// 既有 hosted / github 创建面不回归（AC「旧 hosted 不破」）。
// 失败方式先于实现枚举（仓测试纪律）：本文件即 local 校验的失败场景清单。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { type LocalErrorReason, PROJECT_LOCAL_ERROR_REASONS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { project } from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { expandHomePath } from '../src/services/git.js';
import { bootServer, req } from './helpers.js';

const s = bootServer();
const tempRoots: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  s.dispose();
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
});

/** 真 git 工作树仓（`git init` 即够——is-inside-work-tree 判定不要求首提交）。 */
async function makeGitRepo(): Promise<string> {
  const dir = tempDir('cairn-local-repo-');
  const r = await runGit(['init', dir]);
  expect(r.code).toBe(0);
  return dir;
}

/** 创建面应答投影（record 位 + 错误位；断言只消费这些键）。 */
interface CreateReply {
  id?: string;
  repoKind?: string;
  repoName?: string;
  githubRepo?: string;
  localPath?: string;
  cloneUrl?: string;
  error?: string;
  reason?: string;
}

async function postCreate(body: unknown): Promise<{ status: number; body: CreateReply }> {
  const res = await req(s.app, 'POST', '/api/projects', body);
  return { status: res.status, body: (await res.json()) as CreateReply };
}

describe('POST /api/projects kind=local——localPath 校验三态（#359 AC）', () => {
  test('缺 localPath → 400（错误位指 localPath）', async () => {
    const r = await postCreate({ name: 'p-missing', kind: 'local' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('localPath');
  });

  test('localPath 空串 → 400（required 态不分类）', async () => {
    const r = await postCreate({ name: 'p-empty', kind: 'local', localPath: '   ' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('localPath');
    expect(r.body.reason).toBeUndefined();
  });

  // 创建闸松闸（仿 Multica local_directory：server 只验形态，可达性归 daemon）——
  // 路径不存在 / 非 git 仓不再在创建面 400，server 看不见执行机 fs（多机部署
  // 常态：server 在 Mac、repo 在 mea）。daemon 侧 workspace.ts 预检抛
  // LocalRepoUnreachableError，runner 合成步失败文案点名机器/路径/原因。
  test('松闸一：路径不存在 → 201（可达性归 daemon 端预检）', async () => {
    const missing = join(tempDir('cairn-local-base-'), 'no-such-dir');
    const r = await postCreate({ name: 'p-gone', kind: 'local', localPath: missing });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('local');
    expect(r.body.localPath).toBe(missing);
  });

  test('松闸二：存在但不是 git 仓 → 201（可达性归 daemon 端预检）', async () => {
    const plain = tempDir('cairn-local-plain-');
    const r = await postCreate({ name: 'p-plain', kind: 'local', localPath: plain });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('local');
    expect(r.body.localPath).toBe(plain);
  });

  test('松闸三：指向普通文件 → 201（非目录形态仍过，可达性归 daemon）', async () => {
    const dir = tempDir('cairn-local-file-');
    const file = join(dir, 'not-a-repo.txt');
    writeFileSync(file, 'x');
    const r = await postCreate({ name: 'p-file', kind: 'local', localPath: file });
    expect(r.status).toBe(201);
    expect(r.body.localPath).toBe(file);
  });

  test('相对路径 → 400 + reason=not_absolute（`~` 展开后判定）', async () => {
    const r = await postCreate({ name: 'p-rel', kind: 'local', localPath: 'relative/dir' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('absolute');
    expect(r.body.reason).toBe<LocalErrorReason>('not_absolute');
  });

  test('三态三：是 git 工作树仓 → 201，record/DB 行 localPath = 规范绝对路径', async () => {
    const repo = await makeGitRepo();
    const r = await postCreate({ name: 'p-ok', kind: 'local', localPath: repo });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('local');
    expect(r.body.localPath).toBe(repo);
    const row = s.db
      .select()
      .from(project)
      .where(eq(project.id, String(r.body.id)))
      .get();
    expect(row?.repoKind).toBe('local');
    expect(row?.localPath).toBe(repo);
  });

  test('`~` 展开：localPath `~/<name>` 按 server 端 HOME 展开为绝对路径', async () => {
    const repo = await makeGitRepo();
    const parent = dirname(repo);
    const prevHome = process.env.HOME;
    process.env.HOME = parent;
    try {
      const r = await postCreate({
        name: 'p-tilde',
        kind: 'local',
        localPath: `~/${basename(repo)}`,
      });
      expect(r.status).toBe(201);
      expect(r.body.localPath).toBe(join(parent, basename(repo)));
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
    }
  });
});

describe('expandHomePath（`~` 展开单源；homeDir 测试注入）', () => {
  test('~/x → <home>/x；裸 ~ → <home>', () => {
    expect(expandHomePath('~/code/x', '/home/u')).toBe('/home/u/code/x');
    expect(expandHomePath('~', '/home/u')).toBe('/home/u');
  });

  test('绝对路径与相对路径原样；~user 形态不展开', () => {
    expect(expandHomePath('/abs/x', '/home/u')).toBe('/abs/x');
    expect(expandHomePath('rel/x', '/home/u')).toBe('rel/x');
    expect(expandHomePath('~other/x', '/home/u')).toBe('~other/x');
  });
});

// —— local 读面（#1030：推翻 spec 12「Files tab 对 local 项目隐藏/禁用」的
// out-of-scope——目录解析分支 + 闸放行，git 读原语不动）—————————————
// 失败方式先列（仓测试纪律，本 describe 即失败场景清单）：
//   F1 可达 local 工作树仓 → tree/file/branches/commits/files 五读面全回
//      真值；且 HEAD 落在非 main 分支（trunk）照样读——web 端不得硬编码
//      ref=main（local 仓默认分支任意，这是「无 ref 读 HEAD」设计的根因）
//   F2 目录消失（多机部署 server 看不见 / 用户已删）→ 404 + reason
//      not_found——分类降级供 web 分译，不是 500、不是空树
//   F3 目录被非 git 内容替换 → 404 + reason not_git（同族分类）
//   F4 repoKind=local 而 localPath 列空（行完整性破）→ 404 显式红，
//      无 reason（缺物必红，不静默空）
//   F5 闸不泛化：github 形态仍 404（git-hosting.test.ts 既有钉，不复制）
//   F6 提交详情面（#1102）：根提交（无父）→ 相对空树全文件新增，不崩不空
//      404；目录消失 → 与列表面同闸同形 404 + reason（S2/S4，
//      readCommitDetail 头注失败清单）
describe('local 项目读面——Files tab 开闸（#1030）', () => {
  // 与 git-hosting.test.ts 同款隔离：防用户 git 配置（gpgsign / credential）
  // 干扰提交与判定；提交身份固定 env。
  const READ_GIT_ENV = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'local-read-probe',
    GIT_AUTHOR_EMAIL: 'probe@localhost',
    GIT_COMMITTER_NAME: 'local-read-probe',
    GIT_COMMITTER_EMAIL: 'probe@localhost',
  };

  /** 带 README 提交的 local 工作树仓；默认分支钉 trunk（非 main——机器
   * init.defaultBranch 不可依赖，且非 main HEAD 正是 F1 要钉的失败面）。 */
  async function makeLocalRepo(): Promise<string> {
    const dir = tempDir('cairn-local-read-');
    expect((await runGit(['init', '-b', 'trunk', dir], { env: READ_GIT_ENV })).code).toBe(0);
    writeFileSync(join(dir, 'README.md'), '# local-read-probe\n');
    for (const args of [
      ['add', '.'],
      ['commit', '-m', 'init local probe'],
    ] as string[][]) {
      expect((await runGit(args, { cwd: dir, env: READ_GIT_ENV })).code, args.join(' ')).toBe(0);
    }
    return dir;
  }

  async function createLocalProject(repo: string): Promise<string> {
    const r = await postCreate({ name: 'p-read-probe', kind: 'local', localPath: repo });
    expect(r.status).toBe(201);
    return String(r.body.id);
  }

  test('F1 可达仓：五读面全回真值；HEAD 在非 main 分支照样读', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);

    // tree（无 ref → HEAD）：读回工作树 HEAD 的树
    const tree = (await (await req(s.app, 'GET', `/api/projects/${id}/tree`)).json()) as {
      ref: string;
      commit: string;
      entries: { name: string; path: string; type: string; size: number }[];
    };
    expect(tree.ref).toBe('HEAD');
    expect(tree.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(tree.entries).toContainEqual({
      name: 'README.md',
      path: 'README.md',
      type: 'blob',
      size: Buffer.byteLength('# local-read-probe\n'),
    });

    // file（无 ref → HEAD）：内容字节读回
    const file = (await (
      await req(s.app, 'GET', `/api/projects/${id}/file?path=README.md`)
    ).json()) as {
      encoding: string;
      content: string;
      size: number;
    };
    expect(file.encoding).toBe('utf-8');
    expect(file.content).toBe('# local-read-probe\n');
    expect(file.size).toBe(Buffer.byteLength('# local-read-probe\n'));

    // branches：工作树 HEAD 所在分支（symbolic-ref 面）
    const branches = (await (await req(s.app, 'GET', `/api/projects/${id}/branches`)).json()) as {
      defaultBranch: string | null;
      branches: { name: string; isDefault: boolean }[];
    };
    expect(branches.defaultBranch).toBe('trunk');
    expect(branches.branches).toEqual([{ name: 'trunk', isDefault: true }]);

    // commits：默认分支历史（新→旧）
    const commits = (await (await req(s.app, 'GET', `/api/projects/${id}/commits`)).json()) as {
      ref: string;
      commits: { message: string; authorName: string }[];
    };
    expect(commits.ref).toBe('trunk');
    expect(commits.commits).toHaveLength(1);
    expect(commits.commits[0]?.message).toBe('init local probe');
    expect(commits.commits[0]?.authorName).toBe('local-read-probe');

    // files（@ 候选全递归面）
    const files = (await (await req(s.app, 'GET', `/api/projects/${id}/files`)).json()) as {
      files: { path: string }[];
    };
    expect(files.files.map((f) => f.path)).toContain('README.md');
  });

  test('F2 目录消失 → 404 + reason=not_found（分类降级；commits 同闸同形）', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);
    rmSync(repo, { recursive: true, force: true });
    const res = await req(s.app, 'GET', `/api/projects/${id}/tree`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string; reason?: LocalErrorReason };
    expect(body.reason).toBe<LocalErrorReason>('not_found');
    const commits = await req(s.app, 'GET', `/api/projects/${id}/commits`);
    expect(commits.status).toBe(404);
    expect(((await commits.json()) as { reason?: LocalErrorReason }).reason).toBe<LocalErrorReason>(
      'not_found',
    );
  });

  test('F3 目录被非 git 内容替换 → 404 + reason=not_git', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(repo, { recursive: true });
    const res = await req(s.app, 'GET', `/api/projects/${id}/tree`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { reason?: LocalErrorReason }).reason).toBe<LocalErrorReason>(
      'not_git',
    );
  });

  test('F4 repoKind=local 而 localPath 列空 → 404 显式红（无 reason）', async () => {
    const repo = await makeLocalRepo();
    const id = await createLocalProject(repo);
    s.db.update(project).set({ localPath: null }).where(eq(project.id, id)).run();
    const res = await req(s.app, 'GET', `/api/projects/${id}/tree`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string; reason?: string };
    expect(String(body.error)).toContain('local repo');
    expect(body.reason).toBeUndefined();
  });

  test('F6 提交详情：根提交 = 相对空树全文件新增；目录消失 = 同闸 reason', async () => {
    const repo = await makeLocalRepo(); // 单根提交（README.md），无父
    const id = await createLocalProject(repo);
    const list = (await (await req(s.app, 'GET', `/api/projects/${id}/commits`)).json()) as {
      commits: { sha: string; message: string; authorName: string; at: number }[];
    };
    const root = list.commits[0]!;

    // S4 根提交（无父）：全文件新增的定义态，不是 500 也不是空集
    const res = await req(s.app, 'GET', `/api/projects/${id}/commits/${root.sha}`);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
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
    // S7 元信息与列表行同源一致
    expect(detail.sha).toBe(root.sha);
    expect(detail.message).toBe('init local probe');
    expect(detail.authorName).toBe('local-read-probe');
    expect(detail.at).toBe(root.at);
    expect(detail.sha.startsWith(detail.shortSha)).toBe(true);
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0]?.path).toBe('README.md');
    expect(detail.files[0]?.additions).toBe(1);
    expect(detail.files[0]?.deletions).toBe(0);
    expect(detail.files[0]?.hunks[0]?.lines).toContain('+# local-read-probe');

    // S2 目录消失 → 404 + reason not_found（列表面同闸同形，不 500）
    rmSync(repo, { recursive: true, force: true });
    const gone = await req(s.app, 'GET', `/api/projects/${id}/commits/${root.sha}`);
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { reason?: LocalErrorReason }).reason).toBe<LocalErrorReason>(
      'not_found',
    );
  });
});

describe('local 400 reason 词表（#386：web 分译的单源契约）', () => {
  test('词表 = not_found / not_git / not_absolute（值域钉死，web 按此分译）', () => {
    expect(PROJECT_LOCAL_ERROR_REASONS).toHaveLength(3);
    expect([...PROJECT_LOCAL_ERROR_REASONS].sort()).toEqual([
      'not_absolute',
      'not_found',
      'not_git',
    ]);
  });
});

describe('body 双名兼容：kind（spec 12 契约）与 repoKind（既有 wire），kind 优先', () => {
  test('既有面回归：repoKind github + githubRepo 字符串 → 201', async () => {
    const r = await postCreate({ name: 'p-old-gh', repoKind: 'github', githubRepo: 'octo/cat' });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('github');
    expect(r.body.githubRepo).toBe('octo/cat');
  });

  test('新面：kind github + githubRepo {owner,repo} 对象 → 201，列值归一 owner/repo', async () => {
    const r = await postCreate({
      name: 'p-new-gh',
      kind: 'github',
      githubRepo: { owner: 'octo', repo: 'dog' },
    });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('github');
    expect(r.body.githubRepo).toBe('octo/dog');
  });

  test('kind 与 repoKind 并存 → kind 优先（不误触 hosted provisioning）', async () => {
    const repo = await makeGitRepo();
    const r = await postCreate({
      name: 'p-prio',
      kind: 'local',
      repoKind: 'hosted',
      localPath: repo,
    });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('local');
    expect(r.body.repoName).toBeUndefined();
  });

  test('kind=github 缺 githubRepo → 400（owner/repo 提示）', async () => {
    const r = await postCreate({ name: 'p-gh-none', kind: 'github' });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('owner/repo');
  });

  test('kind=github githubRepo 非法串 → 400', async () => {
    const r = await postCreate({ name: 'p-gh-bad', kind: 'github', githubRepo: 'has space/x' });
    expect(r.status).toBe(400);
  });

  test('kind=github githubRepo 对象空段 → 400（归一后过 isGithubRepoRef 闸）', async () => {
    const r = await postCreate({
      name: 'p-gh-empty',
      kind: 'github',
      githubRepo: { owner: 'a', repo: '' },
    });
    expect(r.status).toBe(400);
  });

  test('旧 hosted 不破：kind=hosted → 201 + bare repo 落地（repoName 在位）', async () => {
    const r = await postCreate({ name: 'p-hosted', kind: 'hosted' });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBe('hosted');
    expect(typeof r.body.repoName).toBe('string');
    expect(String(r.body.cloneUrl)).toContain('/git/');
  });

  test('无 repo 默认面不破：仅 name → 201，record 无 repoKind/localPath', async () => {
    const r = await postCreate({ name: 'p-plain' });
    expect(r.status).toBe(201);
    expect(r.body.repoKind).toBeUndefined();
    expect(r.body.localPath).toBeUndefined();
  });

  test('GET /api/projects 投影带 localPath（record 单源 = shared projectRecordSchema）', async () => {
    const repo = await makeGitRepo();
    const created = await postCreate({ name: 'p-list', kind: 'local', localPath: repo });
    expect(created.status).toBe(201);
    const res = await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`);
    expect(res.status).toBe(200);
    const rows = (await res.json()) as CreateReply[];
    const hit = rows.find((r) => r.id === created.body.id);
    expect(hit?.localPath).toBe(repo);
    expect(hit?.repoKind).toBe('local');
  });
});

// —— tree 路由 path 参数透传（#1097）：readTree/lsTree 早就支持子目录，
// 路由层从未把 `path` query 接出去 → 前端永远只见顶层、点目录必落
// 「文件加载失败」。失败方式先列（仓测试纪律，本 describe 即场景清单）：
//   P1 tree?path=docs → 只回 docs 单层，entries 的 path 全带 docs/ 前缀、
//      name 是裸名，且 path 回显 'docs'——不再混回顶层条目；
//   P2 深层嵌套（≥3 层）逐层可下钻：path=docs/guide 回其单层；
//   P3 无 path / path 空串 → 顶层 + path 回显 ''（既有行为零回归）；
//   P4 同名文件（根 README.md vs docs/README.md）在 file 读面各自回各自
//      真值——「选中键用完整路径不串」的服务端半边；
//   P5 path 指向不存在的目录 → 200 + 空 entries（git ls-tree 语义，
//      web 侧据此演空目录态，不 500）。
describe('tree 路由 path 参数透传（#1097）', () => {
  // 与 #1030 读面同款隔离：防用户 git 配置干扰提交；提交身份固定 env。
  const GIT_ENV = {
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'tree-path-probe',
    GIT_AUTHOR_EMAIL: 'probe@localhost',
    GIT_COMMITTER_NAME: 'tree-path-probe',
    GIT_COMMITTER_EMAIL: 'probe@localhost',
  };

  interface TreeReply {
    ref: string;
    commit: string;
    path: string;
    entries: { name: string; path: string; type: string; size: number | null }[];
  }

  /** 嵌套仓：README.md + docs/README.md + docs/guide/deep.md（同名跨目录 +
   *  3 层深嵌套，一把 fixture 盖住 P1/P2/P4）。 */
  async function makeNestedRepo(): Promise<string> {
    const dir = tempDir('cairn-tree-path-');
    expect((await runGit(['init', '-b', 'trunk', dir], { env: GIT_ENV })).code).toBe(0);
    mkdirSync(join(dir, 'docs', 'guide'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), '# root readme\n');
    writeFileSync(join(dir, 'docs', 'README.md'), '# docs readme\n');
    writeFileSync(join(dir, 'docs', 'guide', 'deep.md'), 'deep content\n');
    for (const args of [
      ['add', '.'],
      ['commit', '-m', 'init nested probe'],
    ] as string[][]) {
      expect((await runGit(args, { cwd: dir, env: GIT_ENV })).code, args.join(' ')).toBe(0);
    }
    return dir;
  }

  async function makeNestedProject(): Promise<string> {
    const repo = await makeNestedRepo();
    const r = await postCreate({ name: 'p-tree-path', kind: 'local', localPath: repo });
    expect(r.status).toBe(201);
    return String(r.body.id);
  }

  test('P1 tree?path=docs → docs 单层 + path 回显，不混顶层条目', async () => {
    const id = await makeNestedProject();
    const res = await req(s.app, 'GET', `/api/projects/${id}/tree?path=docs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TreeReply;
    expect(body.path).toBe('docs');
    expect(body.entries).toContainEqual({
      name: 'README.md',
      path: 'docs/README.md',
      type: 'blob',
      size: Buffer.byteLength('# docs readme\n'),
    });
    expect(body.entries).toContainEqual({
      name: 'guide',
      path: 'docs/guide',
      type: 'tree',
      size: null,
    });
    expect(body.entries.map((e) => e.path)).not.toContain('README.md');
    expect(body.entries).toHaveLength(2);
  });

  test('P2 深层嵌套：path=docs/guide 回其单层（3 层可下钻）', async () => {
    const id = await makeNestedProject();
    const res = await req(
      s.app,
      'GET',
      `/api/projects/${id}/tree?path=${encodeURIComponent('docs/guide')}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TreeReply;
    expect(body.path).toBe('docs/guide');
    expect(body.entries).toEqual([
      {
        name: 'deep.md',
        path: 'docs/guide/deep.md',
        type: 'blob',
        size: Buffer.byteLength('deep content\n'),
      },
    ]);
  });

  test('P3 无 path / 空 path → 顶层 + path 回显空串（零回归）', async () => {
    const id = await makeNestedProject();
    for (const qs of ['', '?path=']) {
      const res = await req(s.app, 'GET', `/api/projects/${id}/tree${qs}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as TreeReply;
      expect(body.path).toBe('');
      expect(body.entries).toContainEqual({
        name: 'README.md',
        path: 'README.md',
        type: 'blob',
        size: Buffer.byteLength('# root readme\n'),
      });
      expect(body.entries).toContainEqual({
        name: 'docs',
        path: 'docs',
        type: 'tree',
        size: null,
      });
    }
  });

  test('P4 同名文件跨目录：file?path= 各回各的真值', async () => {
    const id = await makeNestedProject();
    const root = (await (
      await req(s.app, 'GET', `/api/projects/${id}/file?path=README.md`)
    ).json()) as { content: string };
    expect(root.content).toBe('# root readme\n');
    const nested = (await (
      await req(
        s.app,
        'GET',
        `/api/projects/${id}/file?path=${encodeURIComponent('docs/README.md')}`,
      )
    ).json()) as { content: string };
    expect(nested.content).toBe('# docs readme\n');
  });

  test('P5 path 指向不存在目录 → 200 + 空 entries（web 空目录态的数据源）', async () => {
    const id = await makeNestedProject();
    const res = await req(s.app, 'GET', `/api/projects/${id}/tree?path=nope`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TreeReply;
    expect(body.path).toBe('nope');
    expect(body.entries).toEqual([]);
  });
});
