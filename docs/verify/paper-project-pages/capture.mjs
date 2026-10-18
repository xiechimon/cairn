// Project settings + new project evidence, light and dark, 1440x900 at DPR 2,
// from a fixture build served by `vite preview`.
//   node docs/verify/paper-project-pages/capture.mjs <label> <baseUrl>
// label = before | after. The fixture build turns live when the URL has no
// ?scenario, so the live shots stub /api the way the e2e specs do. Also writes
// <label>-metrics.json (card radius, row heights, control and button boxes).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const [label, base] = process.argv.slice(2);
if (!label || !base) throw new Error('usage: capture.mjs <label> <baseUrl>');
const out = dirname(fileURLToPath(import.meta.url));
mkdirSync(out, { recursive: true });

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: 'xmon', avatarUrl: null };
const PROJECTS = [
  {
    id: 'proj-pacman',
    name: 'pacman',
    teamId: 'team-1',
    repoKind: 'github',
    githubRepo: 'xiechimon/pacman',
    localPath: '/Users/xmon/Code/pacman',
    description: 'Agent workbench: board, chief, daemons on every machine.',
  },
  {
    id: 'proj-notes',
    name: 'field-notes',
    teamId: 'team-1',
    repoKind: 'local',
    githubRepo: null,
    localPath: '/Users/xmon/notes',
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
    name: 'settings-fixture',
    url: '/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c',
    ready: (page) => page.getByText('危险操作').waitFor(),
  },
  {
    name: 'settings-github',
    url: '/app/project/proj-pacman/settings',
    live: true,
    ready: (page) => page.getByRole('textbox', { name: '本机加速路径' }).waitFor(),
  },
  {
    name: 'settings-local',
    url: '/app/project/proj-notes/settings',
    live: true,
    ready: (page) => page.getByText('转换为 GitHub 形态', { exact: true }).waitFor(),
  },
  {
    name: 'new-fixture',
    url: '/app/project/new?scenario=01',
    ready: (page) => page.locator('#prj-new-name').waitFor(),
  },
  {
    name: 'new-filled',
    url: '/app/project/new',
    live: true,
    ready: async (page) => {
      await page.locator('#prj-new-name').fill('pacman');
    },
  },
];

function measure() {
  const box = (el) => {
    if (el == null) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: r.x,
      w: r.width,
      h: r.height,
      radius: cs.borderTopLeftRadius,
      bg: cs.backgroundColor,
    };
  };
  const card = document.querySelector('.settings-card');
  const create = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === '创建项目',
  );
  const del = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === '删除',
  );
  return {
    settingsCard: box(card),
    rows: card ? [...card.children].map((el) => el.getBoundingClientRect().height) : null,
    deleteButton: box(del),
    nameInput: box(document.querySelector('#prj-new-name')),
    repoControl: box(document.querySelector('#prj-new-repo')),
    createButton: box(create),
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
    await context.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    const page = await context.newPage();
    if (shot.live) await stubLive(page);
    await page.goto(`${base}${shot.url}`);
    await shot.ready(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, `${label}-${theme}-${shot.name}.png`) });
    metrics[`${theme}-${shot.name}`] = await page.evaluate(measure);
    await context.close();
  }
}
await browser.close();
writeFileSync(join(out, `${label}-metrics.json`), `${JSON.stringify(metrics, null, 2)}\n`);
