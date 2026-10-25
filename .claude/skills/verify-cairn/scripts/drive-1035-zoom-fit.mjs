#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const MODE = process.argv.includes('--expect=old') ? 'old' : 'new';
const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPO = process.env.VERIFY_REPO_ROOT ?? SCRIPT_REPO;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(REPO, '.claude/verify-run');
const ports = existsSync(join(RUN_DIR, 'ports.json'))
  ? JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'))
  : {};
const SERVER = `http://127.0.0.1:${ports.serverPort ?? process.env.VERIFY_PORT ?? 8791}`;
const WEB = `http://127.0.0.1:${ports.webPort ?? process.env.VERIFY_WEB_PORT ?? 5273}`;
const DB_PATH = join(RUN_DIR, 'home/server/server.db');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_REPO, `.claude/verify-evidence/${ts}-1035-zoom-fit-${MODE}`);
mkdirSync(EVIDENCE, { recursive: true });

const require2 = createRequire(join(REPO, 'apps/server/package.json'));

const checks = [];
function check(name, ok, detail) {

  if (typeof ok !== 'boolean') {
    throw new TypeError(`check(${JSON.stringify(name)}) 的 ok 位须为 boolean，收到 ${typeof ok}`);
  }
  checks.push({ name, ok, detail: detail ?? null });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
}
const artifacts = [];
const shot = async (page, name) => {
  await page.screenshot({ path: join(EVIDENCE, name) });
  artifacts.push(name);
  process.stdout.write(`shot  ${name}\n`);
};

const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
};
const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!(res.status === 200 || res.status === 201)) {
    throw new Error(`POST ${url} → ${res.status} ${await res.text()}`);
  }
  return res.json();
};

const LEVELS = [
  { tag: 'resting-1440', width: 1440, zoom: '100%' },
  { tag: 'natural-1309', width: 1309, zoom: '110%' },
  { tag: 'natural-1200', width: 1200, zoom: '120%' },
  { tag: 'natural-1152', width: 1152, zoom: '125%' },
  { tag: 'boundary-1116', width: 1116, zoom: '~129%' },
  { tag: 'boundary-1115', width: 1115, zoom: '~129%' },
  { tag: 'natural-1024', width: 1024, zoom: '~141%' },
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 732 },
  colorScheme: 'dark',
});

await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="11" fill="#6366f1"/></svg>',
  }),
);

const measure = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-scroller"]');
    if (!el) return null;
    const s = el.getBoundingClientRect();
    return {
      scroller: { left: s.left, right: s.right, width: s.width },
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      pageSpill: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      columns: [...el.querySelectorAll('[data-column]')].map((c) => {
        const r = c.getBoundingClientRect();
        return { id: c.getAttribute('data-column'), left: r.left, right: r.right, width: r.width };
      }),
    };
  });

const sweep = [];
async function measureAt(level) {
  await page.setViewportSize({ width: level.width, height: 732 });

  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const m = await measure();
  const row = { ...level, ...m, fits: m.scrollWidth <= m.clientWidth };
  sweep.push(row);
  process.stdout.write(
    `measure  ${level.tag}  client=${m.clientWidth} scroll=${m.scrollWidth} fits=${row.fits}` +
      ` cols=[${m.columns.map((c) => Math.round(c.width)).join(',')}] spill=${m.pageSpill}\n`,
  );
  return row;
}

try {

  const existing = await getJson(`${SERVER}/api/todos`);
  if (!Array.isArray(existing) || existing.length === 0) {
    const project = await postJson(`${SERVER}/api/projects`, { name: `缩放探针-1035-${MODE}` });
    for (let i = 1; i <= 4; i++) {
      await postJson(`${SERVER}/api/projects/${project.id}/todos`, {
        title: `1035 几何任务 ${i}${i === 4 ? '：带一段略长的标题模拟真实卡面文案占用' : ''}`,
        spec: '列宽地板两态劈开的取证铺底任务。',
      });
    }
  }

  await page.goto(`${WEB}/app`);
  await page.waitForSelector('[data-route="board"]', { timeout: 15_000 });
  await page.waitForSelector('[data-todo-id]', { timeout: 15_000 });

  const todos = await getJson(`${SERVER}/api/todos`);
  let dbCount = -1;
  try {
    const Database = require2('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    try {
      dbCount = db.prepare('SELECT COUNT(*) AS n FROM todo').get().n;
    } finally {
      db.close();
    }
  } catch (err) {
    process.stdout.write(`db skip: ${String(err?.message ?? err)}\n`);
  }
  check(
    'seed-live-data',
    Array.isArray(todos) && todos.length >= 4 && dbCount >= 4,
    `API todos=${Array.isArray(todos) ? todos.length : '?'} SQLite todo=${dbCount}`,
  );

  const rows = {};
  for (const level of LEVELS) rows[level.tag] = await measureAt(level);

  if (MODE === 'new') {

    const rest = rows['resting-1440'];
    check(
      'nat-1440-resting-unchanged',
      rest.fits &&
        rest.columns.every((c) => c.width > 280 && c.width < 282) &&
        rest.pageSpill <= 0,
      `1fr 流值 cols=[${rest.columns.map((c) => Math.round(c.width)).join(',')}]（281±1）无横滚`,
    );

    for (const [tag, zoom] of [
      ['natural-1309', '110%'],
      ['natural-1200', '120%'],
      ['natural-1152', '125%'],
    ]) {
      const r = rows[tag];
      const last = r.columns[3];
      check(
        `nat-${tag}-fits`,
        r.columns.length === 4 &&
          r.fits &&
          last.right <= r.scroller.right + 1 &&
          r.columns.every((c) => c.width >= 199) &&
          r.pageSpill <= 0,
        `${zoom}（${r.width}px）client=${r.clientWidth} scroll=${r.scrollWidth} 末列 right=${Math.round(last.right)} ≤ 窗缘 ${Math.round(r.scroller.right)}`,
      );
      await page.setViewportSize({ width: r.width, height: 732 });
      await shot(page, `${tag}-zoom-${zoom}.png`);
    }

    const b1116 = rows['boundary-1116'];
    const b1115 = rows['boundary-1115'];
    check(
      'boundary-flip-measured',
      b1116.fits && !b1115.fits && b1115.columns.every((c) => c.width >= 199),
      `1116 fits=${b1116.fits}（cols ${Math.round(b1116.columns[0].width)}px）/ 1115 fits=${b1115.fits}（地板接管 cols ${Math.round(b1115.columns[0].width)}px，诚实横滚）`,
    );
    await page.setViewportSize({ width: 1115, height: 732 });
    await shot(page, 'boundary-1115-honest-scroll.png');

    const r1024 = rows['natural-1024'];
    check(
      'nat-1024-floor-holds',
      r1024.columns.every((c) => c.width >= 199) && !r1024.fits && r1024.pageSpill <= 0,
      `cols=[${r1024.columns.map((c) => Math.round(c.width)).join(',')}] ≥199，scroll ${r1024.scrollWidth} > client ${r1024.clientWidth}`,
    );
  } else {

    const b1309 = rows['natural-1309'];
    const lastB = b1309.columns[3];
    check(
      'before-nat-1309-overflows',
      !b1309.fits &&
        lastB.right > b1309.scroller.right + 1 &&
        b1309.columns.every((c) => c.width >= 279) &&
        b1309.pageSpill <= 0,
      `280 地板接管 cols=[${b1309.columns.map((c) => Math.round(c.width)).join(',')}]，scroll ${b1309.scrollWidth} > client ${b1309.clientWidth}，末列出屏 ${Math.round(lastB.right - b1309.scroller.right)}px，页面级 spill=${b1309.pageSpill}`,
    );
    await page.setViewportSize({ width: 1309, height: 732 });
    await shot(page, 'before-natural-1309-overflow.png');

    const b1152 = rows['natural-1152'];
    check('before-nat-1152-overflows', !b1152.fits, `scroll ${b1152.scrollWidth} > client ${b1152.clientWidth}`);
    await page.setViewportSize({ width: 1152, height: 732 });
    await shot(page, 'before-natural-1152-overflow.png');

    const restB = rows['resting-1440'];
    check(
      'before-nat-1440-fits',
      restB.fits && restB.columns.every((c) => c.width > 280 && c.width < 282),
      `cols=[${restB.columns.map((c) => Math.round(c.width)).join(',')}]`,
    );
  }

  await page.setViewportSize({ width: 1309, height: 732 });
  await page.keyboard.press('Meta+j');
  await page.waitForSelector('[data-route="board"][data-chief-open]', { timeout: 5_000 });
  const drawerEl = page.locator('.chief-drawer');
  await drawerEl.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const docked = await measure();
  check(
    'docked-1309-floor-280-scrolls',
    docked.columns.every((c) => c.width >= 279) &&
      docked.scrollWidth > docked.clientWidth &&
      docked.pageSpill <= 0,
    `⌘J 停靠 cols=[${docked.columns.map((c) => Math.round(c.width)).join(',')}] ≥279，横滚 scroll ${docked.scrollWidth} > client ${docked.clientWidth}（#692 有意行为）`,
  );
  await shot(page, MODE === 'new' ? 'docked-1309-floor-280.png' : 'before-docked-1309-floor-280.png');

  if (MODE === 'new') {

    await page.keyboard.press('Escape');
    await page.waitForSelector('.chief-drawer', { state: 'detached', timeout: 5_000 });
    const restored = await measure();
    check(
      'toggle-restores-natural-fit',
      restored.scrollWidth <= restored.clientWidth && restored.columns.every((c) => c.width >= 199),
      `关抽屉后 scroll ${restored.scrollWidth} ≤ client ${restored.clientWidth}，cols=[${restored.columns.map((c) => Math.round(c.width)).join(',')}]`,
    );
  }
} finally {
  await browser.close();
}

const ok = checks.every((c) => c.ok);
const result = {
  probe: '1035-zoom-fit',
  issue: 1035,
  expect: MODE,
  ok,
  at: new Date().toISOString(),
  stack: { api: SERVER, web: WEB, homeDir: join(RUN_DIR, 'home') },
  checks,
  artifacts,

  sweep: sweep.map((r) => ({
    tag: r.tag,
    zoom: r.zoom,
    width: r.width,
    clientWidth: r.clientWidth,
    scrollWidth: r.scrollWidth,
    fits: r.fits,
    pageSpill: r.pageSpill,
    colWidths: r.columns.map((c) => Math.round(c.width * 10) / 10),
  })),
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(
  `\nevidence: ${EVIDENCE}\nallOk=${ok}\n${ok ? 'drive 1035-zoom-fit:PASS' : 'drive 1035-zoom-fit:FAIL'}\n`,
);
process.exit(ok ? 0 : 1);
