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

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const WEB_DIST = join(ROOT, 'apps/web/dist');

let server: RealServer;
let browser: Browser;
let page: Page;
let projectId = '';

beforeAll(async () => {
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

describe('spec 15 #394 title-less surface + fixed tag vocabulary (live UI → wire → SQLite)', () => {
  test('project creation seeds the fixed 6-tag vocabulary (REST shape + SQLite rows)', async () => {
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

  test('dialog has no title input / no tag UI; first body line becomes the placeholder title; detail page has no tag add surface', async () => {
    await page.goto(`${server.url}/app?view=board`);
    await pexpect(
      page.getByRole('complementary').getByRole('button', { name: '新任务' }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole('complementary').getByRole('button', { name: '新任务' }).click();
    const dialog = page.locator('.new-task-dialog');
    await pexpect(dialog).toBeVisible();
    await pexpect(dialog.locator('.new-task-input')).toHaveCount(0);
    await pexpect(dialog.locator('.new-task-tags')).toHaveCount(0);
    await pexpect(dialog.locator('.new-task-tag-add')).toHaveCount(0);

    await dialog.locator('.new-task-spec').fill('394 占位标题探针\n\n现在的情况：第二行不进标题');
    await page.locator('.new-task-save').click();
    await pexpect(page.getByRole('link', { name: '394 占位标题探针' })).toBeVisible({
      timeout: 30_000,
    });

    const todos = (await api(server.url, 'GET', '/api/todos')).body as {
      id: string;
      title: string;
      tagIds: string[];
    }[];
    const probe = todos.find((t) => t.title === '394 占位标题探针');
    expect(probe).toBeTruthy();
    expect(probe!.tagIds).toEqual([]);

    await page.getByRole('link', { name: '394 占位标题探针' }).click();
    await pexpect(page.locator('.detail-shell')).toBeVisible({ timeout: 15_000 });
    await pexpect(page.locator('.fresh-tags')).toHaveCount(0);
  }, 180_000);
});
