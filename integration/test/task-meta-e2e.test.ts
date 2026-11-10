import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

describe('spec 15 untitled tasks without category vocabulary (live UI → wire → SQLite)', () => {
  test('project creation seeds no categories and the vocabulary endpoints are retired', async () => {
    const rows = server.db.select().from(tagTable).where(eq(tagTable.projectId, projectId)).all();
    expect(rows).toEqual([]);
    for (const method of ['GET', 'POST']) {
      const response = await api(
        server.url,
        method,
        `/api/projects/${projectId}/tags`,
        method === 'POST' ? { name: 'retired', color: '#123456' } : undefined,
      );
      expect(response.status).toBe(404);
    }
  });

  test('a draft takes its first body line as the placeholder title; detail page has no tag add surface', async () => {
    await api(server.url, 'POST', `/api/projects/${projectId}/todos`, {
      title: '',
      spec: '394 占位标题探针\n\n现在的情况：第二行不进标题',
    });
    await page.goto(`${server.url}/app/project/${projectId}/tasks`);
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
    await pexpect(page.getByTestId('side-chat')).toBeVisible({ timeout: 15_000 });
    await pexpect(page.locator('.fresh-tags')).toHaveCount(0);
  }, 180_000);
});
