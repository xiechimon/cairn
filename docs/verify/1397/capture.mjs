// Project page evidence (#1397), light and dark, 1440x900 at DPR 2, from a
// fixture build served by `vite preview`.
//   node docs/verify/1397/capture.mjs <label> <baseUrl>
// label = before | after. The fixture build turns live when the URL has no
// ?scenario, so the GitHub-project shot stubs /api the way the e2e specs do.
// Also writes <label>-metrics.json (boxes, corners, type sizes).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });

const PROJ = '/app/project/ZAQczKCu0MOAzC1ZqcFlX';
const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: 'xmon', avatarUrl: null };
const PROJECTS = [
  {
    id: 'proj-pacman',
    name: 'pacman',
    teamId: 'team-1',
    repoKind: 'github',
    githubRepo: 'xiechimon/pacman',
    localPath: null,
    description: null,
  },
];

async function stubLive(page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'capture stub' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: PROJECTS }));
}

const shots = [
  {
    name: 'tasks-list',
    url: `${PROJ}?scenario=prj-tasks`,
    ready: (page) => page.getByTestId('task-row').first().waitFor(),
  },
  {
    name: 'tasks-grid',
    url: `${PROJ}?scenario=prj-tasks`,
    storage: { 'pacman.projectTasksLayout': 'grid' },
    ready: (page) => page.getByTestId('task-card').first().waitFor(),
  },
  {
    name: 'tasks-empty',
    url: `${PROJ}?scenario=r2-24b&tab=tasks`,
    ready: (page) => page.getByText('暂无内容').waitFor(),
  },
  {
    name: 'files-viewer',
    url: `${PROJ}?scenario=prj-local-files`,
    ready: async (page) => {
      await page.locator('[data-tree-entry="file"]', { hasText: 'README.md' }).click();
      await page.locator('pre').waitFor();
    },
  },
  {
    name: 'history-detail',
    url: `${PROJ}?scenario=prj-local-files`,
    ready: async (page) => {
      await page.locator('.prj-files-seg-tab', { hasText: '历史' }).click();
      await page.locator('[data-history-entry="commit"]').first().click();
      await page.locator('[data-commit-detail="pane"]').waitFor();
    },
  },
  {
    name: 'files-github',
    url: '/app/project/proj-pacman',
    live: true,
    ready: (page) => page.getByText('打开 GitHub 仓库').waitFor(),
  },
];

function measure() {
  const one = (sel) => {
    const el =
      typeof sel === 'string'
        ? document.querySelector(sel)
        : [...document.querySelectorAll(sel.tag)].find((n) => n.textContent?.trim() === sel.text);
    if (el == null) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      radius: cs.borderTopLeftRadius,
      bg: cs.backgroundColor,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      color: cs.color,
    };
  };
  return {
    taskList: one('.prj-task-list'),
    taskRow: one('[data-testid="task-row"]'),
    taskRowTitle: one('[data-testid="task-row"] .prj-task-link'),
    taskCard: one('[data-testid="task-card"]'),
    toolbarFilter: one({ tag: 'button', text: '筛选' }),
    emptyIconTile: one('[data-slot="empty-icon"]'),
    emptyTitle: one('.empty-state h2, [data-slot="empty-title"]'),
    treePane: one('.prj-files > div'),
    fileRowName: one('[data-tree-entry="file"] span'),
    historyMessage: one('[data-history-entry="commit"] span span'),
    historyMeta: one('[data-history-entry="commit"] span span + span'),
    commitMessage: one('[data-commit-detail="message"]'),
    commitMeta: one('[data-commit-detail="meta"]'),
    viewerPre: one('pre'),
  };
}

const metrics = {};
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    await context.addInitScript(
      ([t, extra]) => {
        localStorage.setItem('pacman-theme', t);
        for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
      },
      [theme, shot.storage ?? {}],
    );
    const page = await context.newPage();
    if (shot.live) await stubLive(page);
    await page.goto(`${base}${shot.url}`);
    await shot.ready(page);
    // Avatars load from the network; wait so every shot shows them.
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}.png`) });
    metrics[`${theme}-${shot.name}`] = await page.evaluate(measure);
    await context.close();
  }
}
await browser.close();
writeFileSync(join(out, `${label}-metrics.json`), `${JSON.stringify(metrics, null, 2)}\n`);
