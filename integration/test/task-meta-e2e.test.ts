// spec 15 #394 无标题面 + 固定标签词表 live 全链（接替 m7-tags-e2e 的 #309
// 手动标签面——该面随 ADR 0002 D5 移除）：真 web 生产构建（server 同源静态
// 托管）+ 真 server（内存库），Playwright 走真用户路径：
//   新建任务对话框（无标题输入/无标签行）→ 正文多行 → 保存 → 看板卡标题 =
//   首行截断（占位标题，server 派生）。
// 证据三面：UI 断言（卡标题/负空间钉）、REST 真值（todo.title + 播种词表）、
// SQLite 行（tag 播种 6 行直读）。set_task_meta 回填面 = server vitest
// （task-meta.test.ts relay 链）——本链无 daemon/LLM 面（不点 保存并开始）。

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXED_TAGS, type TagRecord } from '@cairn/shared';
import { type Browser, chromium, type Page, expect as pexpect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { tag as tagTable } from '../../apps/server/src/db/schema.js';
import { api, bootRealServer, type RealServer } from './helpers.js';

// integration/test/<file> → repo root = 三级上跳。
const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const WEB_DIST = join(ROOT, 'apps/web/dist');

let server: RealServer;
let browser: Browser;
let page: Page;
let projectId = '';

beforeAll(async () => {
  // web 生产构建（scenario-blind = 恒 live 数据源，#58 gate）。与 m5-web-e2e
  // 同款；dist 为两文件共用，CI 顺序跑不互踩（同 worktree 内 dist 互斥纪律
  // 归 AGENTS.md，此处均为 vite 默认 mode）。
  const build = spawnSync('pnpm', ['--filter', '@cairn/web', 'exec', 'vite', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`web build failed:\n${build.stdout}\n${build.stderr}`);
  }
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error(`web dist missing at ${WEB_DIST}`);
  }
  server = await bootRealServer({
    // 本链无 LLM 面：provider 行指向不监听的地址即可（不产调用）。
    providerBaseUrl: 'http://127.0.0.1:1',
    webDir: WEB_DIST,
  });
  const project = await api(server.url, 'POST', '/api/projects', {
    name: 'task-meta-it',
    teamId: server.teamId,
  });
  projectId = (project.body as { id: string }).id;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 732 }, locale: 'zh-CN' });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('spec 15 #394 无标题面 + 固定词表（live UI → wire → SQLite）', () => {
  test('项目创建即播种固定 6 词表（REST 全形 + SQLite 行）', async () => {
    const tags = (await api(server.url, 'GET', `/api/projects/${projectId}/tags`))
      .body as TagRecord[];
    expect(tags.map((t) => t.name)).toEqual(FIXED_TAGS.map((t) => t.name));
    expect(tags.map((t) => t.color)).toEqual(FIXED_TAGS.map((t) => t.color));
    for (const row of tags) {
      expect(row.projectId).toBe(projectId);
      expect(row.v).toBe(1);
      expect(row.createdAt).toBeGreaterThan(0);
    }
    const rows = server.db.select().from(tagTable).where(eq(tagTable.projectId, projectId)).all();
    expect(rows).toHaveLength(FIXED_TAGS.length);
  });

  test('对话框无标题输入/无标签 UI；正文首行成占位标题；详情页无标签添加面', async () => {
    await page.goto(`${server.url}/app`);
    // #445：顶栏「+ 任务」撤除——就绪探针与创建入口改指侧栏「新任务」行。
    // #943/#910：类名钉换一级 role+name 载体（integration 面同律）。
    await pexpect(
      page.getByRole('complementary').getByRole('button', { name: '新任务' }),
    ).toBeVisible({ timeout: 30_000 });

    // —— 负空间钉：标题位与手动标签面不存在 ——
    await page.getByRole('complementary').getByRole('button', { name: '新任务' }).click();
    const dialog = page.locator('.new-task-dialog');
    await pexpect(dialog).toBeVisible();
    await pexpect(dialog.locator('.new-task-input')).toHaveCount(0);
    await pexpect(dialog.locator('.new-task-tags')).toHaveCount(0);
    await pexpect(dialog.locator('.new-task-tag-add')).toHaveCount(0);

    // —— 保存（保存钮 = 创建不开始，fresh 态停留）→ 卡落板，标题 = 首行 ——
    await dialog.locator('.new-task-spec').fill('394 占位标题探针\n\n现在的情况：第二行不进标题');
    await page.locator('.new-task-save').click();
    await pexpect(page.getByRole('link', { name: '394 占位标题探针' })).toBeVisible({
      timeout: 30_000,
    });

    // —— REST 真值：占位标题 = 首行；tagIds 空（回填是 agent 面,本链无 daemon）——
    const todos = (await api(server.url, 'GET', '/api/todos')).body as {
      id: string;
      title: string;
      tagIds: string[];
    }[];
    const probe = todos.find((t) => t.title === '394 占位标题探针');
    expect(probe).toBeTruthy();
    expect(probe!.tagIds).toEqual([]);

    // —— 详情页：无标签 → chips 行不渲染、无添加 affordance（D5 只读律）——
    await page.getByRole('link', { name: '394 占位标题探针' }).click();
    await pexpect(page.locator('.detail-shell')).toBeVisible({ timeout: 15_000 });
    await pexpect(page.locator('.fresh-tags')).toHaveCount(0);
  }, 180_000);
});
