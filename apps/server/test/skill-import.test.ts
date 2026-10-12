// #1170 技能导入通道（localPath + GitHub URL）+ refresh 重拉。落盘一律复用
// createLocalSkill/updateLocalSkill 既有校验（不另开写路径）；来源记录落
// server 数据根 skill-sources.json（无 DB schema 改动）。
//
// 失败方式先行枚举（仓规：先列失败方式再写实现）——
// LP localPath 导入：LP1 happy → 201 + 落盘 + 来源记录 + 审计 create 行 +
//   列表可见 / LP2 源目录无 SKILL.md → 400 点名 / LP3 路径不存在或非目录
//   → 400 / LP4 源在技能根内（含 symlink 解析后）→ 400（已由 pacman 管理）
//   / LP5 超单文件上限 → 400 点名（树状来源同闸）/ LP6 非 utf8 二进制文件
//   → 400 点名（文本通道边界，不静默丢弃）/ LP7 符号链接文件不入包
//   （listSkillFiles 同律：不追链接，无链接走私）/ LP8 只读复制——源目录
//   内容与文件集写后逐字节不变 / LP9 frontmatter 缺 name → 400（唯一真值
//   律）/ LP10 同名目录占用 → 409（复用 createLocalSkill C2 闸）/ LP0
//   body 二选一约束（双缺/双给 → 400）。
// U URL 导入：U1 happy（mock GitHub API + raw，子目录形）→ 201 + 落盘 +
//   来源记录（canonical URL 含 ref）/ U1b 根目录仓（默认分支）/
//   U2 SSRF 拒绝面逐形：非 https、127.0.0.1、localhost、私网段、
//   link-local、v6 回环/link-local、非 github.com host → 400 明确报错、
//   零出站 / U3 blob 形与路径残缺（无 repo）→ 400 / U4 repo 404 → 400
//   点名；API 403/429 → 502（源暂不可用）/ U5 tree truncated → 400；文件
//   数超上限 → 400 / U6 tree 声明尺寸超限（单文件）→ 400 且零 raw 请求
//   （预检在拉取前）/ U7 raw 404 → 400 点名文件 / U8 拉取超时（挂起
//   fetch + 短超时注入）→ 504 显式 / U9 树条目路径逃逸（'../x' 形）→
//   400 无落盘 / U10 owner/ref 非法字符 → 400 / U11 URL 导入同样过
//   frontmatter 闸（缺 name → 400）。
// R refresh：R1 happy——源改内容后 refresh → 200、id 不变、盘上内容更新、
//   审计 update 行 / R2 无来源记录（手建技能）→ 409 说明 / R3 未知 sid →
//   404 / R4 来源身份漂移（frontmatter name 变）→ 409、盘上内容不动 /
//   R5 localPath 源目录丢失 → 400 点名 / R6 覆写语义钉扎——源删一个文件，
//   本地保留（列出者覆写、未列者保留）/ R7 来源记录跨「重启」持久（同
//   skillSourcesPath 二次 bootServer 可 refresh）/ R8 URL 来源 refresh
//   重拉（mock 二次内容不同）。
// M 物化面（#920 接力）：refresh 后 machine-wire 清单同 id 新 sha256
//   （清单每请求现扫，新内容 → 新 digest 视图的确定性根因）。
// W wire：两新端点在册（POST /api/teams/{id}/skills/import、POST
//   /api/teams/{id}/skills/{sid}/refresh），词表 = shared WEB_REST_ENDPOINTS。

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type ClaimedStep,
  MAX_SKILL_FILE_BYTES,
  machineSkillsManifestResponseSchema,
  skillRecordSchema,
} from '@pacman/shared';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { agent as agentTable, skillAudit } from '../src/db/schema.js';
import { bindAllAgents, bootServer, issueApiKey, postProject, req } from './helpers.js';

// —— 脚手架（隔离技能根 + 隔离来源目录 + GitHub mock）———————————————————

const roots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pacman-skills-'));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function skillMd(name: string, description: string, body = '步骤…\n'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n${body}`;
}

async function errorText(res: Response): Promise<string> {
  return ((await res.json()) as { error?: string }).error ?? '';
}

/** 带凭证的请求（机器面测试用；helpers.req 无 header 面）。 */
async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

/** GitHub 三面 mock（repo meta / git tree / raw 按需应答）。 */
type GhHandlers = {
  repo?: (owner: string, repo: string) => { status: number; body: unknown };
  tree?: (owner: string, repo: string, ref: string) => { status: number; body: unknown };
  raw?: (
    owner: string,
    repo: string,
    ref: string,
    path: string,
  ) => { status: number; body: string };
  hang?: boolean;
};
function githubMock(
  handlers: GhHandlers,
): ((url: string | URL, init?: RequestInit) => Promise<Response>) & { calls: () => string[] } {
  const calls: string[] = [];
  const fn = (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    calls.push(u);
    if (handlers.hang) {
      // 挂起并尊重 abort（超时注入测试的确定性挂起源）。
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    const apiRepo = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)$/.exec(u);
    if (apiRepo) {
      const r = handlers.repo?.(apiRepo[1]!, apiRepo[2]!) ?? {
        status: 200,
        body: { default_branch: 'main' },
      };
      return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
    }
    const apiTree =
      /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([^/?]+)\?recursive=1$/.exec(
        u,
      );
    if (apiTree) {
      const r = handlers.tree?.(apiTree[1]!, apiTree[2]!, apiTree[3]!) ?? {
        status: 200,
        body: { truncated: false, tree: [] },
      };
      return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
    }
    const raw = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(u);
    if (raw) {
      const r = handlers.raw?.(raw[1]!, raw[2]!, raw[3]!, raw[4]!) ?? { status: 404, body: '' };
      return Promise.resolve(new Response(r.body, { status: r.status }));
    }
    return Promise.resolve(new Response('unexpected url', { status: 500 }));
  };
  return Object.assign(fn, { calls: () => calls });
}

/** 源目录组装（localPath 测试用，位于技能根外）。 */
function makeSourceDir(files: Record<string, string>): string {
  const dir = makeRoot();
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

/** git tree 响应体（blob 尺寸在声明位——预检数据源）。 */
function treeBody(entries: { path: string; size?: number; type?: string }[]): {
  truncated: boolean;
  tree: { path: string; type: string; size: number; sha: string }[];
} {
  return {
    truncated: false,
    tree: entries.map((e) => ({
      path: e.path,
      type: e.type ?? 'blob',
      size: e.size ?? 10,
      sha: 'e5ace0f0',
    })),
  };
}

// —— LP localPath 导入 ————————————————————————————————————————————————

describe('POST /api/teams/{id}/skills/import（localPath）', () => {
  test('LP1：happy → 201 record + 落盘（frontmatter name 即目录名）+ 来源记录 + 审计行 + 列表可见', async () => {
    const skillsDir = makeRoot();
    const skillSourcesPath = join(makeRoot(), 'skill-sources.json');
    const source = makeSourceDir({
      'SKILL.md': skillMd('imported-skill', '导入的技能'),
      'scripts/run.sh': 'echo ok\n',
      'refs/note.md': '嵌套文件\n',
    });
    const s = bootServer({ skillsDir, skillSourcesPath });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: source,
      });
      expect(res.status).toBe(201);
      expect(skillRecordSchema.parse(await res.json())).toMatchObject({
        id: 'imported-skill',
        name: 'imported-skill',
        description: '导入的技能',
      });
      expect(readFileSync(join(skillsDir, 'imported-skill', 'SKILL.md'), 'utf8')).toBe(
        skillMd('imported-skill', '导入的技能'),
      );
      expect(readFileSync(join(skillsDir, 'imported-skill', 'scripts/run.sh'), 'utf8')).toBe(
        'echo ok\n',
      );
      expect(readFileSync(join(skillsDir, 'imported-skill', 'refs/note.md'), 'utf8')).toBe(
        '嵌套文件\n',
      );
      // 来源记录落盘（refresh 的数据源；ref = realpath 归一形——macOS
      // /var → /private/var，源路径与落盘值对拍用 realpathSync）。
      const stored = JSON.parse(readFileSync(skillSourcesPath, 'utf8')) as {
        sources: Record<string, { kind: string; ref: string; importedAt: number }>;
      };
      expect(stored.sources['imported-skill']).toMatchObject({
        kind: 'localPath',
        ref: realpathSync(source),
      });
      expect(stored.sources['imported-skill']!.importedAt).toBeGreaterThan(0);
      // 审计：REST 导入 = create 动作、actor member。
      const rows = s.db.select().from(skillAudit).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        skillId: 'imported-skill',
        actorType: 'member',
        action: 'create',
      });
      const list = (await (await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`)).json()) as {
        id: string;
      }[];
      expect(list.map((r) => r.id)).toContain('imported-skill');
    } finally {
      s.dispose();
    }
  });

  test('LP2：源目录无 SKILL.md → 400 点名', async () => {
    const s = bootServer({ skillsDir: makeRoot(), skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      const source = makeSourceDir({ 'README.md': '不是技能' });
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: source,
      });
      expect(res.status).toBe(400);
      expect(await errorText(res)).toContain('SKILL.md');
    } finally {
      s.dispose();
    }
  });

  test('LP3：路径不存在 / 指向文件 → 400', async () => {
    const s = bootServer({ skillsDir: makeRoot(), skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      const missing = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: '/no/such/dir',
      });
      expect(missing.status).toBe(400);
      const isFile = makeSourceDir({ 'SKILL.md': skillMd('x', 'd') });
      const notDir = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: join(isFile, 'SKILL.md'),
      });
      expect(notDir.status).toBe(400);
      expect(await errorText(notDir)).toContain('directory');
    } finally {
      s.dispose();
    }
  });

  test('LP4：源在技能根内（含 symlink 解析后）→ 400（已由 pacman 管理）', async () => {
    const skillsDir = makeRoot();
    mkdirSync(join(skillsDir, 'already-here'));
    writeFileSync(join(skillsDir, 'already-here', 'SKILL.md'), skillMd('already-here', 'd'));
    // 技能根外放一个 symlink 指进技能根（realpath 归一后仍落允许面外）。
    const linkParent = makeRoot();
    symlinkSync(join(skillsDir, 'already-here'), join(linkParent, 'alias'));
    const s = bootServer({ skillsDir, skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      const direct = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: join(skillsDir, 'already-here'),
      });
      expect(direct.status).toBe(400);
      expect(await errorText(direct)).toContain('skills directory');

      const viaLink = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: join(linkParent, 'alias'),
      });
      expect(viaLink.status).toBe(400);
      expect(await errorText(viaLink)).toContain('skills directory');
    } finally {
      s.dispose();
    }
  });

  test('LP5：单文件超 MAX_SKILL_FILE_BYTES → 400 点名文件与上限', async () => {
    const s = bootServer({ skillsDir: makeRoot(), skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      const source = makeSourceDir({
        'SKILL.md': skillMd('big-src', 'd'),
        'big.txt': 'x'.repeat(MAX_SKILL_FILE_BYTES + 1),
      });
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: source,
      });
      expect(res.status).toBe(400);
      const text = await errorText(res);
      expect(text).toContain('big.txt');
      expect(text).toContain(`${MAX_SKILL_FILE_BYTES}`);
    } finally {
      s.dispose();
    }
  });

  test('LP6：非 utf8 二进制文件 → 400 点名（文本通道边界，不静默丢弃）', async () => {
    const s = bootServer({ skillsDir: makeRoot(), skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      const source = makeSourceDir({ 'SKILL.md': skillMd('bin-src', 'd') });
      writeFileSync(join(source, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]));
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: source,
      });
      expect(res.status).toBe(400);
      const text = await errorText(res);
      expect(text).toContain('logo.png');
      expect(text).toContain('UTF-8');
    } finally {
      s.dispose();
    }
  });

  test('LP7：符号链接文件不入包（不追链接，无走私）', async () => {
    const skillsDir = makeRoot();
    const secret = makeSourceDir({ 'secret.txt': '技能根外秘密\n' });
    const source = makeSourceDir({ 'SKILL.md': skillMd('linked', 'd') });
    symlinkSync(join(secret, 'secret.txt'), join(source, 'leak.txt'));
    const s = bootServer({ skillsDir, skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: source,
      });
      expect(res.status).toBe(201);
      const names = readdirSync(join(skillsDir, 'linked'));
      expect(names.sort()).toEqual(['SKILL.md']);
    } finally {
      s.dispose();
    }
  });

  test('LP8：只读复制——源目录内容与文件集写后逐字节不变', async () => {
    const files = {
      'SKILL.md': skillMd('ro-src', '只读源'),
      'nested/a.txt': 'A\n',
      'nested/b.txt': 'B\n',
    };
    const source = makeSourceDir(files);
    const s = bootServer({ skillsDir: makeRoot(), skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, { localPath: source });
      const after = readdirSync(source, { recursive: true }).map(String).sort();
      expect(after).toEqual(['SKILL.md', 'nested', 'nested/a.txt', 'nested/b.txt']);
      for (const [rel, content] of Object.entries(files)) {
        expect(readFileSync(join(source, rel), 'utf8')).toBe(content);
      }
    } finally {
      s.dispose();
    }
  });

  test('LP9：frontmatter 缺 name → 400（frontmatter 唯一真值律）', async () => {
    const s = bootServer({ skillsDir: makeRoot(), skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      const source = makeSourceDir({ 'SKILL.md': '---\ndescription: 有描述无名\n---\n正文\n' });
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: source,
      });
      expect(res.status).toBe(400);
      expect(await errorText(res)).toContain('name');
    } finally {
      s.dispose();
    }
  });

  test('LP10：同名目录占用 → 409（复用 createLocalSkill 闸）', async () => {
    const skillsDir = makeRoot();
    mkdirSync(join(skillsDir, 'busy-skill'));
    writeFileSync(join(skillsDir, 'busy-skill', 'SKILL.md'), skillMd('busy-skill', 'd'));
    const source = makeSourceDir({ 'SKILL.md': skillMd('busy-skill', 'd') });
    const s = bootServer({ skillsDir, skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: source,
      });
      expect(res.status).toBe(409);
      expect(await errorText(res)).toContain('busy-skill');
    } finally {
      s.dispose();
    }
  });

  test('LP0：body 二选一约束——两者都缺/两者都给 → 400', async () => {
    const s = bootServer({ skillsDir: makeRoot(), skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      const neither = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {});
      expect(neither.status).toBe(400);
      const both = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: '/tmp/x',
        url: 'https://github.com/o/r',
      });
      expect(both.status).toBe(400);
      expect(await errorText(both)).toContain('exactly one');
    } finally {
      s.dispose();
    }
  });
});

// —— U URL 导入（GitHub 公共仓/子目录）———————————————————————————————————

describe('POST /api/teams/{id}/skills/import（url）', () => {
  test('U1：happy（子目录）→ 201 + 落盘 + 来源记录（canonical URL 含 ref）', async () => {
    const skillsDir = makeRoot();
    const skillSourcesPath = join(makeRoot(), 'skill-sources.json');
    const fetch = githubMock({
      tree: () => ({
        status: 200,
        body: treeBody([
          { path: 'skills/pdf/SKILL.md', size: 60 },
          { path: 'skills/pdf/scripts/run.py', size: 20 },
          { path: 'skills/other/SKILL.md', size: 50 },
          { path: 'skills/other', type: 'tree' },
        ]),
      }),
      raw: (_o, _r, _ref, path) =>
        path === 'skills/pdf/SKILL.md'
          ? { status: 200, body: skillMd('pdf-skill', 'PDF 技能') }
          : path === 'skills/pdf/scripts/run.py'
            ? { status: 200, body: 'print("ok")\n' }
            : { status: 404, body: '' },
    });
    const s = bootServer({ skillsDir, skillSourcesPath, skillImportFetch: fetch });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme/skills-repo/tree/main/skills/pdf',
      });
      expect(res.status).toBe(201);
      expect(skillRecordSchema.parse(await res.json())).toMatchObject({
        id: 'pdf-skill',
        description: 'PDF 技能',
      });
      expect(readFileSync(join(skillsDir, 'pdf-skill', 'SKILL.md'), 'utf8')).toContain('pdf-skill');
      expect(readFileSync(join(skillsDir, 'pdf-skill', 'scripts/run.py'), 'utf8')).toBe(
        'print("ok")\n',
      );
      // 子目录外的树条目不进包；技能根只多这一个目录。
      expect(readdirSync(skillsDir)).toEqual(['pdf-skill']);
      // 来源记录 = canonical URL（含 ref，refresh 确定性重拉）。
      const stored = JSON.parse(readFileSync(skillSourcesPath, 'utf8')) as {
        sources: Record<string, { kind: string; ref: string }>;
      };
      expect(stored.sources['pdf-skill']).toMatchObject({
        kind: 'github',
        ref: 'https://github.com/acme/skills-repo/tree/main/skills/pdf',
      });
    } finally {
      s.dispose();
    }
  });

  test('U1b：根目录仓（无 tree 段，默认分支解析）→ 201', async () => {
    const s = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: githubMock({
        tree: () => ({ status: 200, body: treeBody([{ path: 'SKILL.md', size: 40 }]) }),
        raw: () => ({ status: 200, body: skillMd('root-skill', '根目录技能') }),
      }),
    });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme/root-skill-repo',
      });
      expect(res.status).toBe(201);
      expect(skillRecordSchema.parse(await res.json())).toMatchObject({ id: 'root-skill' });
      expect(readFileSync(join(s.skillsDir, 'root-skill', 'SKILL.md'), 'utf8')).toContain(
        'root-skill',
      );
    } finally {
      s.dispose();
    }
  });

  test('U2：SSRF 拒绝面逐形 → 400 明确报错，零出站请求', async () => {
    const fetch = githubMock({});
    const s = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: fetch,
    });
    try {
      const cases: [string, string][] = [
        ['http://127.0.0.1/skills/pdf', '127.0.0.1'],
        ['https://127.0.0.1:8787/x', '127.0.0.1'],
        ['https://localhost/acme/repo', 'localhost'],
        ['https://10.1.2.3/acme/repo', '10.1.2.3'],
        ['https://192.168.1.5/acme/repo', '192.168.1.5'],
        ['https://172.16.0.1/acme/repo', '172.16.0.1'],
        ['https://169.254.169.254/latest/meta-data', '169.254.169.254'],
        ['https://[::1]/acme/repo', '::1'],
        ['https://[fe80::1]/acme/repo', 'fe80::1'],
      ];
      for (const [url, marker] of cases) {
        const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, { url });
        expect(res.status, url).toBe(400);
        const text = await errorText(res);
        expect(text, url).toContain(marker);
      }
      // 非 https 明确点名 scheme。
      const http = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'http://github.com/acme/repo',
      });
      expect(http.status).toBe(400);
      expect(await errorText(http)).toContain('https');
      // 非 github.com 公网 host：明确点名只支持 GitHub。
      const otherHost = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://evil.example.com/acme/repo',
      });
      expect(otherHost.status).toBe(400);
      expect(await errorText(otherHost)).toContain('GitHub');
      // 全部拒绝形零出站。
      expect(fetch.calls()).toHaveLength(0);
    } finally {
      s.dispose();
    }
  });

  test('U3：blob 形 / 路径残缺（无 repo）→ 400', async () => {
    const s = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: githubMock({}),
    });
    try {
      const blob = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme/repo/blob/main/skills/pdf/SKILL.md',
      });
      expect(blob.status).toBe(400);
      expect(await errorText(blob)).toContain('blob');

      const bare = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme',
      });
      expect(bare.status).toBe(400);
    } finally {
      s.dispose();
    }
  });

  test('U4：repo 404 → 400 点名；API 403/429 → 502（源暂不可用）', async () => {
    const notFound = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: githubMock({
        repo: () => ({ status: 404, body: { message: 'Not Found' } }),
      }),
    });
    try {
      const res = await req(notFound.app, 'POST', `/api/teams/${notFound.team.id}/skills/import`, {
        url: 'https://github.com/acme/gone',
      });
      expect(res.status).toBe(400);
      expect(await errorText(res)).toContain('acme/gone');
    } finally {
      notFound.dispose();
    }
    const rateLimited = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: githubMock({
        repo: () => ({ status: 429, body: { message: 'rate limit' } }),
      }),
    });
    try {
      const res = await req(
        rateLimited.app,
        'POST',
        `/api/teams/${rateLimited.team.id}/skills/import`,
        { url: 'https://github.com/acme/rate' },
      );
      expect(res.status).toBe(502);
      expect(await errorText(res)).toContain('GitHub');
    } finally {
      rateLimited.dispose();
    }
  });

  test('U5：tree truncated → 400；文件数超上限 → 400', async () => {
    const truncated = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: githubMock({
        tree: () => ({ status: 200, body: { truncated: true, tree: [] } }),
      }),
    });
    try {
      const res = await req(
        truncated.app,
        'POST',
        `/api/teams/${truncated.team.id}/skills/import`,
        {
          url: 'https://github.com/acme/huge',
        },
      );
      expect(res.status).toBe(400);
      expect(await errorText(res)).toContain('truncated');
    } finally {
      truncated.dispose();
    }
    const many: { path: string; size?: number }[] = [{ path: 'SKILL.md', size: 40 }];
    for (let i = 0; i < 300; i++) many.push({ path: `f${i}.txt`, size: 5 });
    const crowded = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: githubMock({ tree: () => ({ status: 200, body: treeBody(many) }) }),
    });
    try {
      const res = await req(crowded.app, 'POST', `/api/teams/${crowded.team.id}/skills/import`, {
        url: 'https://github.com/acme/crowded',
      });
      expect(res.status).toBe(400);
      expect(await errorText(res)).toContain('files');
    } finally {
      crowded.dispose();
    }
  });

  test('U6：tree 声明尺寸超限 → 400 且零 raw 请求（预检在拉取前）', async () => {
    const fetch = githubMock({
      tree: () => ({
        status: 200,
        body: treeBody([
          { path: 'SKILL.md', size: 40 },
          { path: 'big.txt', size: MAX_SKILL_FILE_BYTES + 1 },
        ]),
      }),
    });
    const s = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: fetch,
    });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme/big-files',
      });
      expect(res.status).toBe(400);
      const text = await errorText(res);
      expect(text).toContain('big.txt');
      expect(text).toContain(`${MAX_SKILL_FILE_BYTES}`);
      const rawCalls = fetch.calls().filter((u) => u.includes('raw.githubusercontent.com'));
      expect(rawCalls).toHaveLength(0);
    } finally {
      s.dispose();
    }
  });

  test('U7：raw 404 → 400 点名文件', async () => {
    const s = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: githubMock({
        tree: () => ({
          status: 200,
          body: treeBody([
            { path: 'SKILL.md', size: 40 },
            { path: 'gone.txt', size: 5 },
          ]),
        }),
        raw: (_o, _r, _ref, path) =>
          path === 'SKILL.md'
            ? { status: 200, body: skillMd('partial', 'd') }
            : { status: 404, body: '' },
      }),
    });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme/partial',
      });
      expect(res.status).toBe(400);
      expect(await errorText(res)).toContain('gone.txt');
    } finally {
      s.dispose();
    }
  });

  test('U8：拉取超时（挂起 fetch + 短超时注入）→ 504 显式', async () => {
    const s = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: githubMock({ hang: true }),
      skillImportTimeoutMs: 60,
    });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme/slow-repo',
      });
      expect(res.status).toBe(504);
      expect(await errorText(res)).toContain('timed out');
    } finally {
      s.dispose();
    }
  });

  test('U9：树条目路径逃逸（../ 形）→ 400 无落盘', async () => {
    const skillsDir = makeRoot();
    const s = bootServer({
      skillsDir,
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: githubMock({
        tree: () => ({
          status: 200,
          body: treeBody([
            { path: 'SKILL.md', size: 40 },
            { path: '../escape.txt', size: 5 },
          ]),
        }),
        raw: () => ({ status: 200, body: 'x' }),
      }),
    });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme/evil-tree',
      });
      expect(res.status).toBe(400);
      expect(await errorText(res)).toContain('escape.txt');
      expect(readdirSync(skillsDir)).toEqual([]);
    } finally {
      s.dispose();
    }
  });

  test('U10：owner/ref 非法字符 → 400', async () => {
    const s = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: githubMock({}),
    });
    try {
      const badOwner = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme%20evil/repo',
      });
      expect(badOwner.status).toBe(400);

      const badRef = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme/repo/tree/main%2f..%2fetc/skills',
      });
      expect(badRef.status).toBe(400);
    } finally {
      s.dispose();
    }
  });

  test('U11：URL 导入同样过 frontmatter 闸（缺 name → 400）', async () => {
    const s = bootServer({
      skillsDir: makeRoot(),
      skillSourcesPath: join(makeRoot(), 's.json'),
      skillImportFetch: githubMock({
        raw: () => ({ status: 200, body: '---\ndescription: 无名\n---\n' }),
      }),
    });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme/nameless',
      });
      expect(res.status).toBe(400);
      expect(await errorText(res)).toContain('name');
    } finally {
      s.dispose();
    }
  });
});

// —— R refresh ————————————————————————————————————————————————————————

describe('POST /api/teams/{id}/skills/{sid}/refresh', () => {
  async function importedWorld(files: Record<string, string>) {
    const skillsDir = makeRoot();
    const skillSourcesPath = join(makeRoot(), 'skill-sources.json');
    const source = makeSourceDir(files);
    const s = bootServer({ skillsDir, skillSourcesPath });
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
      localPath: source,
    });
    if (res.status !== 201) throw new Error(`import failed: ${res.status}`);
    return { s, skillsDir, skillSourcesPath, source };
  }

  test('R1：源改内容后 refresh → 200、id 不变、盘上更新、审计 update 行', async () => {
    const { s, skillsDir, source } = await importedWorld({
      'SKILL.md': skillMd('refresh-me', '旧描述'),
    });
    try {
      writeFileSync(join(source, 'SKILL.md'), skillMd('refresh-me', '新描述', '新正文\n'));
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/refresh-me/refresh`, {});
      expect(res.status).toBe(200);
      expect(skillRecordSchema.parse(await res.json())).toMatchObject({
        id: 'refresh-me',
        description: '新描述',
      });
      expect(readFileSync(join(skillsDir, 'refresh-me', 'SKILL.md'), 'utf8')).toContain('新描述');
      const rows = s.db.select().from(skillAudit).all();
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ skillId: 'refresh-me', action: 'update' });
    } finally {
      s.dispose();
    }
  });

  test('R2：无来源记录（手建技能）→ 409 说明', async () => {
    const skillsDir = makeRoot();
    mkdirSync(join(skillsDir, 'hand-made'));
    writeFileSync(join(skillsDir, 'hand-made', 'SKILL.md'), skillMd('hand-made', '手建'));
    const s = bootServer({ skillsDir, skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/hand-made/refresh`, {});
      expect(res.status).toBe(409);
      const text = await errorText(res);
      expect(text).toContain('hand-made');
      expect(text).toContain('source');
    } finally {
      s.dispose();
    }
  });

  test('R3：未知 sid → 404', async () => {
    const s = bootServer({ skillsDir: makeRoot(), skillSourcesPath: join(makeRoot(), 's.json') });
    try {
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/ghost/refresh`, {});
      expect(res.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('R4：来源身份漂移（frontmatter name 变）→ 409、盘上内容不动', async () => {
    const { s, skillsDir, source } = await importedWorld({
      'SKILL.md': skillMd('stable-id', '旧'),
    });
    try {
      writeFileSync(join(source, 'SKILL.md'), skillMd('renamed-id', '上游改名'));
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/stable-id/refresh`, {});
      expect(res.status).toBe(409);
      const text = await errorText(res);
      expect(text).toContain('stable-id');
      expect(text).toContain('renamed-id');
      expect(readFileSync(join(skillsDir, 'stable-id', 'SKILL.md'), 'utf8')).toContain('旧');
      expect(() => statSync(join(skillsDir, 'renamed-id'))).toThrow();
    } finally {
      s.dispose();
    }
  });

  test('R5：localPath 源目录丢失 → 400 点名', async () => {
    const { s, source } = await importedWorld({ 'SKILL.md': skillMd('gone-src', 'd') });
    try {
      rmSync(source, { recursive: true });
      const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/gone-src/refresh`, {});
      expect(res.status).toBe(400);
      expect(await errorText(res)).toContain('gone-src');
    } finally {
      s.dispose();
    }
  });

  test('R6：覆写语义钉扎——源删一个文件，本地保留（列出者覆写、未列者保留）', async () => {
    const { s, skillsDir, source } = await importedWorld({
      'SKILL.md': skillMd('overwrite-law', 'd'),
      'keep.txt': '保留我\n',
    });
    try {
      rmSync(join(source, 'keep.txt'));
      const res = await req(
        s.app,
        'POST',
        `/api/teams/${s.team.id}/skills/overwrite-law/refresh`,
        {},
      );
      expect(res.status).toBe(200);
      expect(readFileSync(join(skillsDir, 'overwrite-law', 'keep.txt'), 'utf8')).toBe('保留我\n');
    } finally {
      s.dispose();
    }
  });

  test('R7：来源记录跨「重启」持久（同 skillSourcesPath 二次 boot 可 refresh）', async () => {
    const skillsDir = makeRoot();
    const skillSourcesPath = join(makeRoot(), 'skill-sources.json');
    const source = makeSourceDir({ 'SKILL.md': skillMd('persist-src', 'v1') });
    const first = bootServer({ skillsDir, skillSourcesPath });
    await req(first.app, 'POST', `/api/teams/${first.team.id}/skills/import`, {
      localPath: source,
    });
    first.dispose();
    // 二次「进程」：同 skillsDir + 同 skillSourcesPath。
    const second = bootServer({ skillsDir, skillSourcesPath });
    try {
      writeFileSync(join(source, 'SKILL.md'), skillMd('persist-src', 'v2'));
      const res = await req(
        second.app,
        'POST',
        `/api/teams/${second.team.id}/skills/persist-src/refresh`,
        {},
      );
      expect(res.status).toBe(200);
      expect(skillRecordSchema.parse(await res.json())).toMatchObject({ description: 'v2' });
    } finally {
      second.dispose();
    }
  });

  test('R8：URL 来源 refresh 重拉（mock 二次内容不同）', async () => {
    const skillsDir = makeRoot();
    const skillSourcesPath = join(makeRoot(), 'skill-sources.json');
    let contentVersion = 1;
    const fetch = githubMock({
      tree: () => ({
        status: 200,
        body: { truncated: false, tree: [{ path: 'SKILL.md', type: 'blob', size: 40 }] },
      }),
      raw: () => ({ status: 200, body: skillMd('url-refresh', `第 ${contentVersion} 版`) }),
    });
    const s = bootServer({ skillsDir, skillSourcesPath, skillImportFetch: fetch });
    try {
      const imported = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        url: 'https://github.com/acme/live-repo',
      });
      expect(imported.status).toBe(201);
      contentVersion = 2;
      const res = await req(
        s.app,
        'POST',
        `/api/teams/${s.team.id}/skills/url-refresh/refresh`,
        {},
      );
      expect(res.status).toBe(200);
      expect(skillRecordSchema.parse(await res.json())).toMatchObject({ description: '第 2 版' });
      expect(readFileSync(join(skillsDir, 'url-refresh', 'SKILL.md'), 'utf8')).toContain('第 2 版');
    } finally {
      s.dispose();
    }
  });
});

// —— M 物化面（#920 接力：refresh → 清单新 sha256）———————————————————————

describe('refresh 与 machine-wire 清单（#920 接力）', () => {
  test('M1：refresh 后同 id 新 sha256（清单每请求现扫——新视图的根因）', async () => {
    const skillsDir = makeRoot();
    const skillSourcesPath = join(makeRoot(), 'skill-sources.json');
    const source = makeSourceDir({ 'SKILL.md': skillMd('dist-skill', 'v1'), 'helper.md': 'h1\n' });
    const s = bootServer({ skillsDir, skillSourcesPath, claimHoldMs: 250 });
    try {
      await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, { localPath: source });
      // 机器面世界：enroll + agent（白名单含导入技能）+ build + claim。
      const key = await issueApiKey(s);
      const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key,
        body: { teamId: s.team.id, name: 'import-dist', cliVersion: '0.1.0' },
      });
      expect(enroll.status).toBe(200);
      const { token } = (await enroll.json()) as { token: string };
      s.db
        .insert(agentTable)
        .values({
          id: 'agent-import-dist',
          teamId: s.team.id,
          displayName: '发技能的',
          provider: 'p',
          modelId: 'm',
          tools: [],
          skillsAllowlist: ['dist-skill'],
        })
        .run();
      bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

      const projectId = await postProject(s.app);
      const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        body: { title: '', spec: '干活\n\n现在的情况：没技能' },
      });
      const { id: todoId } = (await todoRes.json()) as { id: string };
      await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: {
          todoIds: [todoId],
          assignment: { plan: null, build: { agentId: 'agent-import-dist' } },
          withPlan: false,
        },
      });
      const claim = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: token,
        body: {},
      });
      const { step } = (await claim.json()) as { step: ClaimedStep | null };
      if (!step) throw new Error('no step claimed');
      const manifestGet = () =>
        call(s.app, 'GET', `/api/machine/skills/${step.step.id}`, { cred: token });
      const before = machineSkillsManifestResponseSchema.parse(await (await manifestGet()).json());
      expect(before.skills.map((sk) => sk.id)).toEqual(['dist-skill']);
      const beforeEntry = before.skills[0]!.files.find((f) => f.path === 'SKILL.md')!;

      // 源改内容 → refresh → 清单 sha 变、id/dirName 不变。
      writeFileSync(join(source, 'SKILL.md'), skillMd('dist-skill', 'v2', '更长的正文内容\n'));
      const refreshed = await req(
        s.app,
        'POST',
        `/api/teams/${s.team.id}/skills/dist-skill/refresh`,
        {},
      );
      expect(refreshed.status).toBe(200);
      const after = machineSkillsManifestResponseSchema.parse(await (await manifestGet()).json());
      expect(after.skills[0]).toMatchObject({ id: 'dist-skill', dirName: 'dist-skill' });
      const afterEntry = after.skills[0]!.files.find((f) => f.path === 'SKILL.md')!;
      expect(afterEntry.sha256).not.toBe(beforeEntry.sha256);
      expect(afterEntry.sizeBytes).toBeGreaterThan(beforeEntry.sizeBytes);
    } finally {
      s.dispose();
    }
  });
});

// —— W wire：端点在册 ——————————————————————————————————————————————————

describe('wire：导入/refresh 端点在册', () => {
  test('W1：POST /api/teams/{id}/skills/import 与 refresh 路由已注册', () => {
    const { app } = bootServer();
    const routes = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    expect(routes.has('POST /api/teams/:id/skills/import')).toBe(true);
    expect(routes.has('POST /api/teams/:id/skills/:sid/refresh')).toBe(true);
  });
});
