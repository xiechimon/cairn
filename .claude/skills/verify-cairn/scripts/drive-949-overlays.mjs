#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT
  ? resolve(process.env.VERIFY_REPO_ROOT)
  : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');

const portsFile = join(RUN_DIR, 'ports.json');
let stack;
try {
  stack = JSON.parse(readFileSync(portsFile, 'utf8'));
} catch {
  console.error(`无栈：${portsFile} 不存在或损坏。先跑 launch.mjs`);
  process.exit(1);
}
const API = `http://127.0.0.1:${stack.serverPort}`;
const WEB = `http://127.0.0.1:${stack.webPort}`;

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ??
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-949-overlays`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
const artifacts = [];
let failures = 0;
const check = (ok, label) => {
  checks.push({ ok, label });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
};
const shot = async (page, name) => {
  const file = join(EVIDENCE, name);
  await page.screenshot({ path: file });
  artifacts.push(name);
  console.log(`shot  ${name}`);
};

const parseRgb = (c) => {

  const srgb = c.startsWith('color(srgb');
  const m = c.match(/[\d.]+/g)?.map(Number);
  if (m == null || m.length < 3) return null;
  const scale = srgb ? 255 : 1;
  return { r: m[0] * scale, g: m[1] * scale, b: m[2] * scale, a: m.length > 3 ? m[3] : 1 };
};
const over = (fg, bg) => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
});
const lum = ({ r, g, b }) => {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (c1, c2) => {
  const l1 = lum(c1);
  const l2 = lum(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const scorePairs = (pairs) =>
  pairs.map((p) => {
    let fg = parseRgb(p.fg);
    let bg = parseRgb(p.bg);
    if (fg == null || bg == null) return { ...p, ratio: null, pass: false, note: 'unparsable' };
    if (p.bg.includes('||')) {
      const [pillColor, baseColor] = p.bg.split('||');
      bg = over(parseRgb(pillColor), parseRgb(baseColor));
    }
    const canvas = parseRgb(p.canvas);
    if (bg.a < 1 && canvas != null) bg = over(bg, canvas);
    if (fg.a < 1 && canvas != null) fg = over(fg, canvas);
    const r = ratio(fg, bg);

    const floor = p.kind === 'text' ? 4.5 : p.kind === 'ui' ? 3.0 : null;
    return {
      ...p,
      fgRgb: `rgb(${Math.round(fg.r)} ${Math.round(fg.g)} ${Math.round(fg.b)})`,
      bgRgb: `rgb(${Math.round(bg.r)} ${Math.round(bg.g)} ${Math.round(bg.b)})`,
      ratio: Math.round(r * 100) / 100,
      floor,
      pass: floor == null ? null : r >= floor,
    };
  });

async function api(method, path) {
  const res = await fetch(`${API}${path}`, { method });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

const browser = await chromium.launch();
const contrast = {};

const todosRes = await api('GET', '/api/todos');
const seeded = (todosRes.body?.todos ?? todosRes.body ?? [])[0];
if (seeded == null) {
  console.error('库里没有任务——先跑 drive.mjs new-task');
  process.exit(1);
}
const SEEDED_ID = seeded.id;
const SEEDED_TITLE = seeded.title;
const QUERY = SEEDED_TITLE.slice(0, Math.min(6, SEEDED_TITLE.length));

for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 732 },
    colorScheme: theme,
  });
  await context.addInitScript(
    ([t]) => localStorage.setItem('cairn-theme', t),
    [theme],
  );
  const page = await context.newPage();
  await page.goto(`${WEB}/app`);
  await page.getByRole('complementary').waitFor({ state: 'visible', timeout: 20_000 });

  const panel = page.getByRole('dialog', { name: '搜索' });
  const openPanel = async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await page.keyboard.press('Meta+k');
      const opened = await panel
        .waitFor({ state: 'visible', timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      if (opened) return;
    }
    throw new Error('⌘K never opened the panel');
  };

  await openPanel();
  await page.waitForTimeout(300);
  const pbox = await panel.boundingBox();
  check(
    pbox != null && Math.round(pbox.width) === 520 && Math.round(pbox.height) === 440 && Math.round(pbox.y) === 146,
    `A1[${theme}] 面板几何 520×440 @ top146（实测 ${JSON.stringify(pbox && { w: pbox.width, h: pbox.height, y: pbox.y })}）`,
  );
  const pskin = await panel.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, radius: s.borderRadius, shadow: s.boxShadow, role: el.getAttribute('role') };
  });
  const varOf = (v) =>
    page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), v);
  check(
    pskin.radius === (await varOf('--edge-radius')) && pskin.shadow !== 'none',
    `A2[${theme}] 面板皮肤：radius=--edge-radius(${pskin.radius})、shadow 在场`,
  );
  const navRow = panel.locator('[data-row-kind="nav"]').first();
  check(
    (await navRow.getAttribute('data-slot')) === 'button',
    `A3[${theme}] 行钮收编 components/ui Button（data-slot=button + data-row-kind 载体）`,
  );
  const litProbe = (loc) =>
    loc.evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--row-selected)';
      document.documentElement.append(probe);
      const lit = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(el).backgroundColor === lit;
    });
  await navRow.hover();
  await page.waitForTimeout(250);
  check(await litProbe(navRow), `A4[${theme}] 行 hover 亮正典 pill（--row-selected）`);
  await page.getByRole('textbox').focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  check(
    (await navRow.getAttribute('data-selected')) === '' && (await litProbe(navRow)),
    `A5[${theme}] 键盘光标 data-selected 载体 + 亮面跟随`,
  );
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden', timeout: 3000 });

  await openPanel();
  await page.keyboard.type(QUERY);
  const todoRow = panel.locator('[data-row-kind="todo"]').first();
  await todoRow.waitFor({ state: 'visible', timeout: 8000 });
  const chip = todoRow.locator('[data-tone]');
  const chipBox = await chip.boundingBox();
  check(
    (await chip.getAttribute('data-slot')) === 'badge' &&
      chipBox != null &&
      Math.round(chipBox.height) === 16,
    `A6[${theme}] 结果行 chip = StatusChip sm（data-tone + data-slot=badge + 16px，§5.2 正典）`,
  );

  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden', timeout: 3000 });
  await page.waitForTimeout(300);
  const pill = page.getByRole('complementary', { includeHidden: true }).locator('[aria-current="page"]');
  const pillBg = () => pill.evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
  const litAtRest = (await pillBg()) !== 'rgba(0, 0, 0, 0)';
  await openPanel();
  const marker = await page.evaluate(() => 'searchOpen' in document.documentElement.dataset);
  await page.waitForTimeout(300);
  const dimmed = await pillBg();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden', timeout: 3000 });
  await page.waitForTimeout(300);
  const restored = (await pillBg()) !== 'rgba(0, 0, 0, 0)';
  check(
    litAtRest && marker && dimmed === 'rgba(0, 0, 0, 0)' && restored,
    `A7[${theme}] 常亮互斥：静息亮(${litAtRest}) → 开面标记(${marker})+pill 透明(${dimmed}) → 关面复原(${restored})`,
  );

  await openPanel();
  const scrim = await page.evaluate(() => {
    const el = document.elementFromPoint(20, 20);
    if (el == null) return null;
    const s = getComputedStyle(el);
    return { slot: el.getAttribute('data-slot'), bg: s.backgroundColor, z: s.zIndex, pos: s.position };
  });
  await page.mouse.click(20, 20);
  await panel.waitFor({ state: 'hidden', timeout: 3000 });
  check(
    scrim?.slot === 'dialog-overlay' && scrim.pos === 'fixed' && scrim.z === '40',
    `A8[${theme}] scrim = 壳 Backdrop 位（data-slot=dialog-overlay、fixed、z=--z-modal-scrim(40)），暗角点击即关`,
  );

  await openPanel();
  await page.waitForTimeout(400);
  const traceP = page.evaluate(() => {
    const out = [];
    const t0 = performance.now();
    return new Promise((res) => {
      function snap() {
        const el = document.querySelector('[role="dialog"][aria-label="搜索"]');
        out.push(el ? Number(getComputedStyle(el).opacity) : null);
        if (performance.now() - t0 < 600) requestAnimationFrame(snap);
        else res(out);
      }
      requestAnimationFrame(snap);
    });
  });
  await page.keyboard.press('Meta+k');
  const trace = (await traceP).filter((v) => v != null);
  let floor = null;
  let rose = false;
  for (const op of trace) {
    if (floor == null && op < 0.9) floor = op;
    else if (floor != null) {
      if (op < floor) floor = op;
      if (op > floor + 0.12) rose = true;
    }
  }
  check(floor != null && !rose, `A9[${theme}] 退出透明度单调递减（#844 无闪律，samples=${trace.length}）`);
  await panel.waitFor({ state: 'hidden', timeout: 3000 });
  if (theme === 'dark') await shot(page, `01-board-${theme}.png`);

  await page.goto(`${WEB}/app/todo/${SEEDED_ID}`);
  await page.getByTestId('chip-chevron').waitFor({ state: 'visible', timeout: 15_000 });
  const chevron = page.getByTestId('chip-chevron');
  const chipBoxB = await chevron.boundingBox();
  await chevron.click();
  const popover = page.getByRole('dialog', { name: '任务分配' });
  await popover.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(200);
  const pobox = await popover.boundingBox();
  check(
    pobox != null && Math.round(pobox.width) === 298 && Math.round(pobox.height) === 193 && pobox.y > chipBoxB.y,
    `B1[${theme}] popover 锚定几何 298×193、挂在 chip 下方（y ${pobox?.y} > ${chipBoxB?.y}）`,
  );
  const poskin = await popover.evaluate((el) => {
    const s = getComputedStyle(el);
    const before = getComputedStyle(el, '::before');
    return {
      border: `${s.borderTopWidth} ${s.borderTopStyle}`,
      borderColor: s.borderTopColor,
      radius: s.borderRadius,
      arrowClip: before.clipPath,
      arrowBg: before.backgroundColor,
    };
  });
  check(
    poskin.border === '1px solid' && poskin.radius === '0px' && poskin.arrowClip.includes('polygon'),
    `B2[${theme}] V2 弹层壳：1px 墨线框 + 圆角 0 + Arrow clip-path 双三角在场`,
  );
  const catcher = await page.evaluate(() => {
    const el = document.elementFromPoint(400, 600);
    if (el == null) return null;
    const s = getComputedStyle(el);
    return { slot: el.getAttribute('data-slot'), z: s.zIndex, pos: s.position, bg: s.backgroundColor, aria: el.getAttribute('aria-hidden') };
  });
  check(
    catcher?.slot === 'button' && catcher.z === '29' && catcher.pos === 'fixed' && catcher.bg === 'rgba(0, 0, 0, 0)' && catcher.aria === 'true',
    `B3[${theme}] ClickCatcher 收编 Button（data-slot=button、fixed、z=--z-catcher(29)、透明、aria-hidden）`,
  );
  const selSection = popover.locator('[data-selected]');
  const selBg = await selSection.evaluate((el) => getComputedStyle(el).backgroundColor);
  const rowKinds = await popover.evaluate((el) =>
    [...el.querySelectorAll('[data-row-kind]')].map((r) => r.getAttribute('data-row-kind')),
  );
  check(
    (await selSection.count()) === 1 &&
      selBg !== 'rgba(0, 0, 0, 0)' &&
      rowKinds.includes('owner') && rowKinds.includes('agent'),
    `B4[${theme}] 选中 section data-selected 底(${selBg}) + 行族 data-row-kind=[${rowKinds}]`,
  );
  const ownerRow = popover.locator('[data-row-kind="owner"]');
  await ownerRow.hover();
  await page.waitForTimeout(250);
  const rowHoverBg = await ownerRow.evaluate((el) => getComputedStyle(el).backgroundColor);
  const accentSoft = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent-soft)';
    document.body.append(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    return v;
  });
  check(rowHoverBg === accentSoft, `B5[${theme}] popover 行 hover tint = --accent-soft（#73 家族同值 utility 自持）`);
  const editBtn = popover.getByRole('button', { name: '编辑分配' });
  await editBtn.hover();
  await page.waitForTimeout(200);
  const editHover = await editBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
  check(
    (await editBtn.count()) === 1 && editHover === 'rgba(0, 0, 0, 0)',
    `B6[${theme}] 编辑分配 = role button 一级载体，hover 底中和为透明（旧 unlayered 压制语义等值）`,
  );
  if (theme === 'dark') await shot(page, `05-popover-${theme}.png`);
  await page.keyboard.press('Escape');
  await popover.waitFor({ state: 'hidden', timeout: 3000 });
  check(page.url().includes(`/app/todo/${SEEDED_ID}`), `B7[${theme}] Esc 分层：先收 popover、不离开详情`);

  const mech = await page.evaluate(() => {
    const retired = [
      '.search-panel', '.search-row', '.search-scrim', '.search-input-row', '.search-group-label',
      '.search-empty', '.search-row-chip', '.search-row--selected', '.search-row--todo',
      '.chip-popover', '.chip-popover-row', '.chip-popover-edit', '.plan-dropdown',
      '.plan-dropdown-row', '.overlay-click-catcher', '.detail-chipwrap', '.detail-chip-chevron',
    ];
    const hits = {};
    let searchOpenRule = false;
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      const walk = (list) => {
        for (const r of list) {

          if (r.cssRules != null && r.cssRules.length > 0) walk(r.cssRules);
          const sel = r.selectorText;
          if (sel == null) continue;
          for (const cls of retired) {
            const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`\\.${escaped.slice(1)}(?![\\w-])`);
            if (re.test(sel)) hits[cls] = (hits[cls] ?? 0) + 1;
          }
          if (sel.includes('data-search-open')) searchOpenRule = true;
        }
      };
      walk(rules);
    }
    return { hits, searchOpenRule };
  });
  const hitList = Object.entries(mech.hits);
  check(hitList.length === 0, `D1[${theme}] 退役选择子零 CSS 规则（命中 ${JSON.stringify(mech.hits)}）`);
  check(mech.searchOpenRule, `D2[${theme}] 常亮互斥 utility 律在场（html[data-search-open] 变体已编译）`);

  await page.goto(`${WEB}/app`);
  await page.getByRole('complementary').waitFor({ state: 'visible', timeout: 20_000 });
  await openPanel();
  await page.keyboard.type(QUERY);
  await panel.locator('[data-row-kind="todo"]').first().waitFor({ state: 'visible', timeout: 8000 });
  const pairs = await page.evaluate(() => {
    const resolveVar = (decl, value) => {
      const probe = document.createElement('div');
      probe.style.setProperty(decl, value);
      document.body.append(probe);
      const out = getComputedStyle(probe).getPropertyValue(decl).trim();
      probe.remove();
      return out;
    };
    const cs = (el, pseudo) => getComputedStyle(el, pseudo);
    const q = (sel) => document.querySelector(sel);
    const canvas = resolveVar('color', 'var(--background)');
    const pairs = [];
    const push = (face, fg, bg, kind) => pairs.push({ face, fg, bg, kind, canvas });

    const panel = q('[role="dialog"][aria-label="搜索"]');
    const panelBg = cs(panel).backgroundColor;
    const row = panel.querySelector('[data-row-kind="todo"]');
    push('row-text', cs(row).color, panelBg, 'text');
    const title = row.querySelector('span > span:nth-child(1)');
    push('row-title', cs(title).color, panelBg, 'text');
    const sub = row.querySelector('span > span:nth-child(2)');
    push('row-sub', cs(sub).color, panelBg, 'text');
    const time = row.querySelector(':scope > span:nth-of-type(3)');
    push('row-time', cs(time).color, panelBg, 'text');
    const chip = row.querySelector('[data-tone]');
    push(`chip-${chip.getAttribute('data-tone')}-rendered`, cs(chip).color, cs(chip).backgroundColor, 'text');
    const label = [...panel.querySelectorAll('div')].find((d) => d.textContent.trim() === '任务' && d.children.length === 0);
    if (label != null) push('group-label', cs(label).color, panelBg, 'text');
    const input = panel.querySelector('input');
    push('input-text', cs(input).color, panelBg, 'text');

    push(
      'row-text-lit',
      cs(row).color,
      `${resolveVar('background-color', 'var(--row-selected)')}||${panelBg}`,
      'text',
    );

    const tile = row.querySelector(':scope > span:nth-of-type(1)');
    push('icon-tile-glyph', cs(tile).color, cs(tile).backgroundColor, 'ui');

    for (const tone of ['idle', 'plan', 'confirm', 'done', 'failed']) {
      push(
        `chip-${tone}-token`,
        resolveVar('color', `var(--chip-${tone}-fg)`),
        resolveVar('background-color', `var(--chip-${tone}-bg)`),
        'text',
      );
    }

    push('popover-title', resolveVar('color', 'var(--text-primary)'), resolveVar('background-color', 'var(--popover-bg)'), 'text');
    push('popover-row', resolveVar('color', 'var(--text-tertiary)'), resolveVar('background-color', 'var(--popover-bg)'), 'text');
    push(
      'popover-row-selected',
      resolveVar('color', 'var(--text-tertiary)'),
      `${resolveVar('background-color', 'var(--overlay-select-indigo)')}||${resolveVar('background-color', 'var(--popover-bg)')}`,
      'text',
    );
    push(
      'popover-label-selected',
      resolveVar('color', 'var(--text-primary)'),
      `${resolveVar('background-color', 'var(--overlay-select-indigo)')}||${resolveVar('background-color', 'var(--popover-bg)')}`,
      'text',
    );
    push('popover-seq', resolveVar('color', 'var(--text-tertiary)'), resolveVar('background-color', 'var(--popover-bg)'), 'text');

    const inputRowEl = panel.querySelector(':scope > div:nth-of-type(1)');
    push('input-icon', cs(inputRowEl).color, panelBg, 'ui');
    push(
      'popover-check',
      resolveVar('color', 'var(--card-button)'),
      `${resolveVar('background-color', 'var(--overlay-select-indigo)')}||${resolveVar('background-color', 'var(--popover-bg)')}`,
      'ui',
    );
    push('popover-divider', resolveVar('background-color', 'var(--overlay-divider)'), resolveVar('background-color', 'var(--popover-bg)'), 'report');
    push('panel-border', resolveVar('color', 'var(--card-border)'), resolveVar('background-color', 'var(--popover-bg)'), 'report');
    push('popover-border', resolveVar('color', 'var(--border-default)'), canvas, 'report');
    push('project-avatar', resolveVar('color', 'var(--project-avatar-fg)'), resolveVar('background-color', 'var(--project-avatar-bg)'), 'text');

    push('menu-row', resolveVar('color', 'var(--text-primary)'), resolveVar('background-color', 'var(--popover-bg)'), 'text');
    push(
      'menu-row-checked',
      resolveVar('color', 'var(--text-primary)'),
      `${resolveVar('background-color', 'var(--spot-soft)')}||${resolveVar('background-color', 'var(--popover-bg)')}`,
      'text',
    );
    push(
      'menu-indicator',
      resolveVar('color', 'var(--card-button)'),
      `${resolveVar('background-color', 'var(--spot-soft)')}||${resolveVar('background-color', 'var(--popover-bg)')}`,
      'ui',
    );
    push('focus-ring', resolveVar('color', 'var(--focus-ring)'), resolveVar('background-color', 'var(--popover-bg)'), 'ui');

    const aside = q('aside');
    push('sidebar-dim-row', resolveVar('color', 'var(--text-secondary)'), cs(aside).backgroundColor, 'text');
    return pairs;
  });
  const rows = scorePairs(pairs);
  const gated = rows.filter((r) => r.pass != null);
  const reported = rows.filter((r) => r.pass == null);
  const bad = gated.filter((r) => !r.pass);
  contrast[theme] = rows;
  check(
    bad.length === 0,
    `E-${theme} 对比度门控 ${gated.length} 对全过（report-only 软发丝线 ${reported.length} 对讲数不判：${reported.map((b) => `${b.face}=${b.ratio}`).join(', ')}；未过 ${bad.length}：${bad.map((b) => `${b.face}=${b.ratio}/${b.floor}`).join(', ')}）`,
  );
  if (theme === 'dark') await shot(page, `02-panel-${theme}.png`);
  else await shot(page, `03-panel-${theme}.png`);
  await context.close();
}

const result = {
  ticket: 949,
  domain: 'overlays/',
  stack: { API, WEB },
  todo: { id: SEEDED_ID, title: SEEDED_TITLE, query: QUERY },
  checks,
  failures,
  artifacts,
};
writeFileSync(join(EVIDENCE, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(join(EVIDENCE, 'contrast.json'), `${JSON.stringify(contrast, null, 2)}\n`);
console.log(`\ndrive-949-overlays: ${failures === 0 ? 'PASS' : 'FAIL'} (${checks.length - failures}/${checks.length})`);
console.log(`evidence: ${EVIDENCE}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
