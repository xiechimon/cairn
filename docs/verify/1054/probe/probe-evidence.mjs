#!/usr/bin/env node
// #1054/#1055 evidence probe: measured radii + brand-ink pair contrast +
// before/after scene screenshots, run against a fixture stack (vite build
// --mode fixture + vite preview). Canon formula for contrast = measure-912
// (WCAG 2.1 relative luminance, (Lhi+0.05)/(Llo+0.05)); colors are read from
// rendered computed styles (probe elements for var() resolution, incl.
// color-mix slots), never estimated. Translucent values composite over
// --background before measuring.
//
// Usage: PROBE_BASE=http://127.0.0.1:<port> PROBE_OUT=<dir> PROBE_SIDE=before|after
//        node <this file>   (run from a worktree with deps installed; imports
//        @playwright/test — copy it next to apps/web/e2e/ or run with the
//        worktree's apps/web as cwd so resolution finds node_modules)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.PROBE_BASE ?? 'http://127.0.0.1:8413';
const OUT = process.env.PROBE_OUT ?? '/tmp/probe-1054-1055';
const SIDE = process.env.PROBE_SIDE ?? 'after';
mkdirSync(`${OUT}/shots`, { recursive: true });

const TOKENS = [
  '--card-button',
  '--focus-ring',
  '--popover',
  '--card',
  '--background',
  '--secondary',
  '--spot-soft',
  '--accent-soft',
  '--spot-text-on-tint',
  '--notify-icon-bg',
  '--primary',
  '--primary-foreground',
  '--text-on-accent',
  '--foreground',
  '--text-secondary',
  '--text-tertiary',
  '--accent',
  '--accent-foreground',
  '--border',
  '--muted',
];

const measurements = [];
const rec = (theme, face, prop, value) =>
  measurements.push({ side: SIDE, theme, face, prop, value });

function parseRgb(s) {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  // color-mix slots compute to `color(srgb r g b [/ a])` with 0..1 components.
  const c = s.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
  if (c) {
    return {
      r: Math.round(Number(c[1]) * 255),
      g: Math.round(Number(c[2]) * 255),
      b: Math.round(Number(c[3]) * 255),
      a: c[4] === undefined ? 1 : Number(c[4]),
    };
  }
  return null;
}
function compositeOver(fg, bg) {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}
function luminance({ r, g, b }) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(c1, c2) {
  const l1 = luminance(c1);
  const l2 = luminance(c2);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

async function resolveTokens(page) {
  return page.evaluate((tokens) => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.append(probe);
    const out = {};
    for (const t of tokens) {
      probe.style.backgroundColor = `var(${t})`;
      out[t] = getComputedStyle(probe).backgroundColor;
    }
    probe.remove();
    return out;
  }, TOKENS);
}

const radiusOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el == null ? null : getComputedStyle(el).borderTopLeftRadius;
  }, selector);

async function runTheme(browser, theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 732 } });
  await context.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
  const page = await context.newPage();
  const tokens = {};

  // --- board: column + card + drag clone ---
  await page.goto(`${BASE}/app?scenario=01`);
  await page.waitForSelector('.board-column');
  Object.assign(tokens, await resolveTokens(page));
  rec(theme, 'board-column', 'borderTopLeftRadius', await radiusOf(page, '.board-column'));
  rec(theme, 'todo-card', 'borderTopLeftRadius', await radiusOf(page, '.todo-card'));
  const card = page.locator('.todo-card').first();
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 6, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 60, { steps: 8 });
  await page.waitForSelector('[data-testid="drag-overlay"] [data-todo-id]');
  rec(
    theme,
    'drag-card',
    'borderTopLeftRadius',
    await radiusOf(page, '[data-testid="drag-overlay"] [data-todo-id]'),
  );
  await page.screenshot({ path: `${OUT}/shots/${SIDE}-${theme}-board-drag.png` });
  await page.mouse.up();

  // --- user-menu plate (fresh navigation: the drag above leaves pointer state) ---
  await page.goto(`${BASE}/app?scenario=01`);
  await page.waitForSelector('.board-sidebar');
  await page.getByRole('button', { name: 'Xmon Dai' }).first().click();
  await page.waitForSelector('.user-menu', { state: 'visible' });
  await page.waitForTimeout(250); // past the enter keyframe
  rec(theme, 'user-menu', 'borderTopLeftRadius', await radiusOf(page, '.user-menu'));
  await page.locator('.user-menu').screenshot({ path: `${OUT}/shots/${SIDE}-${theme}-user-menu.png` });
  await page.keyboard.press('Escape');

  // --- detail: composer + chat-bubble (spec-block needs the stubbed live face, below) ---
  await page.goto(`${BASE}/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=17b`);
  await page.waitForSelector('.composer');
  rec(theme, 'composer (registered deviation, stays)', 'borderTopLeftRadius', await radiusOf(page, '.composer'));
  rec(theme, 'chat-bubble (registered deviation, stays)', 'borderTopLeftRadius', await radiusOf(page, '[data-testid="user-bubble"]'));
  await page.screenshot({ path: `${OUT}/shots/${SIDE}-${theme}-detail.png` });

  // --- chief settings (scenario 101): tabs + card family ---
  await page.goto(`${BASE}/app?scenario=101`);
  await page.waitForSelector('.chief-settings, [data-testid="chief-tab-indicator"]', { timeout: 15000 }).catch(() => {});
  rec(theme, 'chief TabsList', 'borderTopLeftRadius', await radiusOf(page, '[role="tablist"]'));
  rec(theme, 'chief tab indicator', 'borderTopLeftRadius', await radiusOf(page, '[data-testid="chief-tab-indicator"]'));
  const family = await page.evaluate((secondaryRgb) => {
    const out = [];
    for (const el of document.querySelectorAll('[class]')) {
      const cs = getComputedStyle(el);
      if (cs.backgroundColor !== secondaryRgb) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) continue;
      out.push({
        cls: String(el.getAttribute('class')).slice(0, 60),
        radius: cs.borderTopLeftRadius,
        h: Math.round(r.height),
      });
    }
    return out;
  }, tokens['--secondary']);
  rec(theme, 'chief secondary-bg blocks', JSON.stringify(family), '');
  await page.screenshot({ path: `${OUT}/shots/${SIDE}-${theme}-chief-settings.png` });

  // --- chief drawer + mention picker: live mode with route stubs (the
  // fixture world carries no mention sources; chief-composer-tools.spec
  // recipe, inline minimal wire shapes) ---
  const TEAM_ID = 'team-1';
  const BRIEF_ID = 'todo-brief-1';
  const WIRE_BRIEF = {
    id: BRIEF_ID,
    teamId: TEAM_ID,
    projectId: 'proj-1',
    title: '登录按钮圆角与悬停过渡',
    spec: '# 任务目标\n\n把圆角改成 **8px**。\n',
    phase: 'todo',
    phaseAt: 0,
    seqNum: 1,
    orderIndex: 0,
    tagIds: [],
    assignment: null,
    agent: null,
    latestBuildId: null,
    lastRunAt: null,
    hasChanges: false,
    hasPlan: false,
    buildHistory: [],
    sourceTodo: null,
    v: 1,
  };
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    const path = new URL(request.url()).pathname;
    if (path === `/api/todos/${BRIEF_ID}`) return route.fulfill({ json: WIRE_BRIEF });
    if (path === '/api/todos') return route.fulfill({ json: [WIRE_BRIEF] });
    return route.fulfill({ status: 500, json: { error: 'probe stub' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({ json: [{ id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }] }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
    route.fulfill({ json: { unreadThreadIds: [] } }),
  );
  await page.route(`**/api/teams/${TEAM_ID}/members`, (route) =>
    route.fulfill({
      json: [
        { id: 'member-agent-0', teamId: TEAM_ID, actorId: 'agent-1', memberType: 'agent', actor: { id: 'agent-1', displayName: 'builder', description: 'Builds features' } },
      ],
    }),
  );
  await page.route('**/api/todos?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/skills?*', (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/teams/${TEAM_ID}/machines`, (route) => route.fulfill({ json: [] }));
  await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [] });
  });
  const membersLoaded = page.waitForResponse((r) => r.url().includes(`/api/teams/${TEAM_ID}/members`) && r.status() === 200);
  await page.goto(`${BASE}/app`);
  await membersLoaded;
  await page.getByRole('button', { name: '总管' }).click();
  await page.waitForSelector('.chief-drawer', { timeout: 15000 });
  rec(theme, 'chief-composer (registered deviation, stays)', 'borderTopLeftRadius', await radiusOf(page, '.chief-composer'));
  const drawer = page.locator('.chief-drawer');
  await drawer.getByRole('button', { name: '提及' }).click();
  await page.waitForSelector('.mention-picker');
  await page.locator('.mention-row--top:not([data-disabled])').first().click();
  await page.waitForSelector('.mention-row--entry');
  await page.locator('.mention-row--entry').first().click();
  const insert = page.locator('.mention-picker-insert');
  const insertStyle = await insert.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, bg: cs.backgroundColor, radius: cs.borderTopLeftRadius };
  });
  rec(theme, 'mention-picker-insert', JSON.stringify(insertStyle), '');
  await page.locator('.mention-picker-foot').screenshot({ path: `${OUT}/shots/${SIDE}-${theme}-mention-foot.png` });
  await page.screenshot({ path: `${OUT}/shots/${SIDE}-${theme}-mention-picker.png` });
  await page.keyboard.press('Escape');

  // --- spec-block on the stubbed live fresh face (fixture world has no spec) ---
  await page.goto(`${BASE}/app/todo/${BRIEF_ID}`);
  await page.waitForSelector('.spec-block');
  rec(theme, 'spec-block', 'borderTopLeftRadius', await radiusOf(page, '.spec-block'));
  await page.locator('.spec-block').screenshot({ path: `${OUT}/shots/${SIDE}-${theme}-spec-block.png` });

  // --- account: name button hover ink (fixture scenario carries the user) ---
  await page.goto(`${BASE}/app/account?scenario=01`);
  const nameBtn = page.locator('.profile-row', { hasText: '名称' }).locator('button').first();
  await nameBtn.waitFor();
  const rest = await nameBtn.evaluate((el) => getComputedStyle(el).color);
  rec(theme, 'account name button (rest)', 'color', rest);
  await nameBtn.hover();
  await page.waitForTimeout(350); // past the color step
  const hov = await nameBtn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.color, bg: cs.backgroundColor };
  });
  rec(theme, 'account name button (hover)', JSON.stringify(hov), '');
  await page.locator('.profile-row', { hasText: '名称' }).screenshot({ path: `${OUT}/shots/${SIDE}-${theme}-account-hover.png` });

  await context.close();
  return tokens;
}

const browser = await chromium.launch();
const tokensByTheme = {};
for (const theme of ['dark', 'light']) {
  tokensByTheme[theme] = await runTheme(browser, theme);
}
await browser.close();

// --- contrast table (canon formula, rendered values) ---
const contrastRows = [];
function pair(theme, name, fgTok, bgTok, threshold, kind) {
  const t = tokensByTheme[theme];
  let fg = parseRgb(t[fgTok]);
  const bg = parseRgb(t[bgTok]);
  if (fg == null || bg == null) {
    contrastRows.push({ theme, name, fg: t[fgTok], bg: t[bgTok], ratio: null, threshold, kind, result: 'UNRESOLVED' });
    return;
  }
  if (fg.a < 1) fg = compositeOver(fg, parseRgb(t['--background']));
  const r = ratio(fg, bg);
  contrastRows.push({
    theme,
    name,
    fg: `${fgTok} ${t[fgTok]}`,
    bg: `${bgTok} ${t[bgTok]}`,
    ratio: r,
    threshold,
    kind,
    result: r >= threshold ? 'PASS' : 'FAIL',
  });
}
for (const theme of ['dark', 'light']) {
  pair(theme, 'bell glyph on notify disc (registered badge-glyph)', '--card-button', '--notify-icon-bg', 3, 'ui');
  pair(theme, 'check mark on popover plate (registered selection-mark)', '--card-button', '--popover', 3, 'ui');
  pair(theme, 'check mark on dialog background (registered selection-mark)', '--card-button', '--background', 3, 'ui');
  pair(theme, 'spinner on stream background (registered indicator)', '--card-button', '--background', 3, 'ui');
  pair(theme, 'spinner on card surface (registered indicator)', '--card-button', '--card', 3, 'ui');
  pair(theme, 'crown on spot-soft disc (registered badge-glyph)', '--card-button', '--spot-soft', 3, 'ui');
  pair(theme, 'brand ink AS TEXT on popover (#1055 before-face reference)', '--card-button', '--popover', 4.5, 'text');
  pair(theme, 'insert button AFTER: label on primary fill', '--primary-foreground', '--primary', 4.5, 'text');
  pair(theme, 'account hover AFTER: accent-foreground on accent', '--accent-foreground', '--accent', 4.5, 'text');
  pair(theme, 'link tier reference (#1006 R4): primary on card', '--primary', '--card', 4.5, 'text');
}

writeFileSync(`${OUT}/measure-${SIDE}.json`, JSON.stringify({ side: SIDE, base: BASE, measurements, contrastRows, tokens: tokensByTheme }, null, 2));

let md = `# ${SIDE} — measured at ${BASE}\n\n## geometry / state measurements\n\n| theme | face | value |\n| --- | --- | --- |\n`;
for (const m of measurements) md += `| ${m.theme} | ${m.face} | ${m.value || m.prop} |\n`;
md += `\n## contrast pairs (WCAG 2.1, rendered token values)\n\n| theme | pair | fg | bg | ratio | gate | result |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
for (const r of contrastRows) md += `| ${r.theme} | ${r.name} | ${r.fg} | ${r.bg} | ${r.ratio} | ${r.threshold} (${r.kind}) | ${r.result} |\n`;
writeFileSync(`${OUT}/measure-${SIDE}.md`, md);
console.log(md);
