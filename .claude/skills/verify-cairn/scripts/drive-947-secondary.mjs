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
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-947-secondary`);
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

  if (c.startsWith('color(')) {
    const m = c.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
    if (m == null) return null;
    return {
      r: Number(m[1]) * 255,
      g: Number(m[2]) * 255,
      b: Number(m[3]) * 255,
      a: m[4] != null ? Number(m[4]) : 1,
    };
  }
  const m = c.match(/[\d.]+/g)?.map(Number);
  if (m == null || m.length < 3) return null;
  return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
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

const measurePairs = (page, opts) =>
  page.evaluate((o) => {
    const resolveVar = (decl, value) => {
      const probe = document.createElement('div');
      probe.style.setProperty(decl, value);
      document.body.append(probe);
      const out = getComputedStyle(probe).getPropertyValue(decl).trim();
      probe.remove();
      return out;
    };
    const cs = (el) => getComputedStyle(el);
    const q = (sel, root = document) => root.querySelector(sel);
    const canvas = resolveVar('color', 'var(--background)');
    const pairs = [];
    const push = (face, fg, bg, kind) => pairs.push({ face, fg, bg, kind, canvas });
    const tokenPair = (face, fgVar, bgVar, kind) =>
      push(face, resolveVar('color', fgVar), resolveVar('color', bgVar), kind);

    if (o.face === 'team') {
      const main = q('.secondary-main');
      const card = q('[data-testid="team-agent-card"]');
      if (card) {
        const cardBg = cs(card).backgroundColor;

        const rows = [...card.querySelectorAll(':scope > span:last-child > span')];
        const faces = ['team-card-name', 'team-card-model', 'team-card-role'];
        rows.forEach((el, i) => {
          if (faces[i]) push(faces[i], cs(el).color, cardBg, 'text');
        });
      }

      const settings = q('[aria-label="设置"]');
      if (settings && main)
        push('secondary-link', cs(settings).color, cs(main).backgroundColor, 'text');

      const create = [...document.querySelectorAll('button')].find((b) =>
        b.textContent.includes('创建 Agent'),
      );
      if (create && main)
        push('team-create-slot', cs(create).color, cs(main).backgroundColor, 'text');

      const fab = q('button[aria-label="总管"]');
      if (fab) push('secondary-fab-glyph', cs(fab).color, cs(fab).backgroundColor, 'ui');

      tokenPair('chart-crown', 'var(--card-button)', 'var(--spot-soft)', 'ui');
      tokenPair('chart-provider', 'var(--text-primary)', 'var(--surface-secondary)', 'ui');
      tokenPair('chart-model', 'var(--text-tertiary)', 'var(--surface)', 'text');
      tokenPair('chart-name', 'var(--text-primary)', 'var(--surface)', 'text');
      tokenPair('chart-create', 'var(--text-tertiary)', 'var(--surface)', 'text');
      tokenPair('title-glyph', 'var(--text-tertiary)', 'var(--surface)', 'ui');
    }

    if (o.face === 'account') {

      const trigger = q('[aria-haspopup="listbox"]');
      if (trigger) push('lang-trigger', cs(trigger).color, cs(trigger).backgroundColor, 'text');

      const menu = q('[role="listbox"]');
      if (menu) {
        const row = menu.querySelector('[role="option"]');
        const checkMark = menu.querySelector('[role="option"] span svg');
        if (row) push('lang-row', cs(row).color, cs(menu).backgroundColor, 'text');
        if (checkMark)
          push(
            'lang-check',
            cs(checkMark.closest('span')).color,
            cs(menu).backgroundColor,
            'ui',
          );
      }

      const sw = q('[role="switch"]');
      const card = q('.account-card');
      if (sw && card) {

        push('switch-track-off[§4-1]', cs(sw).backgroundColor, cs(card).backgroundColor, 'obs');
        const thumb = sw.querySelector('[data-slot="switch-thumb"]');
        if (thumb)
          push(
            'switch-thumb-off[§4-1]',
            cs(thumb).backgroundColor,
            cs(sw).backgroundColor,
            'obs',
          );
      }

      tokenPair('switch-track-on', 'var(--primary)', 'var(--surface)', 'ui');
    }

    if (o.face === 'api-keys') {
      void canvas;

      tokenPair('keys-empty-desc', 'var(--text-tertiary)', 'var(--surface)', 'text');
      tokenPair('keys-empty-title', 'var(--text-primary)', 'var(--surface)', 'text');
      tokenPair(
        'keys-empty-tile',
        'var(--text-secondary)',
        'var(--surface-secondary)',
        'ui',
      );
      tokenPair('keys-cta-invert', 'var(--text-on-accent)', 'var(--card-button)', 'text');

      const row = [...document.querySelectorAll('div')].find(
        (d) => typeof d.className === 'string' && d.className.includes('h-[62px]'),
      );
      if (row) {
        const rowBg = cs(row).backgroundColor;
        const textCol = row.querySelector(':scope > span:nth-child(2)');
        const name = textCol?.querySelector('span:first-child');
        const mask = textCol?.querySelector('span:nth-child(2)');
        if (name) push('keys-row-name', cs(name).color, rowBg, 'text');
        if (mask) push('keys-row-mask', cs(mask).color, rowBg, 'text');
      }

      tokenPair('keys-row-chevron', 'var(--text-tertiary)', 'var(--surface-secondary)', 'ui');
      tokenPair('apikey-label', 'var(--text-tertiary)', 'var(--popover-bg)', 'text');
      tokenPair('apikey-toolname', 'var(--text-secondary)', 'var(--popover-bg)', 'text');
      tokenPair('apikey-quickbtn', 'var(--text-tertiary)', 'var(--popover-bg)', 'text');
    }
    return pairs;
  }, opts);

const scorePairs = (pairs) =>
  pairs.map((p) => {
    let fg = parseRgb(p.fg);
    let bg = parseRgb(p.bg);
    if (fg == null || bg == null) return { ...p, ratio: null, pass: false, note: 'unparsable' };
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
      pass: floor == null ? true : r >= floor,
    };
  });

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    if (seen.has(r.face)) return false;
    seen.add(r.face);
    return true;
  });
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    body: res.status === 204 ? null : await res.json().catch(() => null),
  };
}

const teams = await api('GET', '/api/teams');
const teamId = Array.isArray(teams.body) ? teams.body[0]?.id : null;
if (teamId == null) {
  console.error('无团队种子，live 栈未就绪');
  process.exit(1);
}
for (const name of ['verify-947-alpha', 'verify-947-beta']) {
  const existing = await api('GET', `/api/teams/${teamId}/members`);
  const has =
    Array.isArray(existing.body) && existing.body.some((m) => m.actor?.displayName === name);
  if (!has) {
    const created = await api('POST', `/api/teams/${teamId}/agents`, {
      displayName: name,
      description: `#947 drive probe (${name})`,
    });
    if (created.status !== 201) {
      console.error(`建 Agent 失败：${created.status} ${JSON.stringify(created.body)}`);
      process.exit(1);
    }
  }
}

const browser = await chromium.launch();
const contrast = {};

for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 732 },
    colorScheme: theme,
  });
  await context.addInitScript(([t]) => localStorage.setItem('cairn-theme', t), [theme]);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const collected = [];

  await page.goto(`${WEB}/app/team`);
  await page.getByTestId('team-agent-card').first().waitFor({ timeout: 20_000 });

  if (theme === 'dark') {

    const geo = await page.evaluate(() => {
      const box = (el) => (el ? el.getBoundingClientRect() : null);
      const head = document.querySelector('[data-route="team"] header');
      const back = document.querySelector('[aria-label="返回"]');
      const col = document.querySelector('[data-testid="team-agent-grid"]')?.parentElement;
      const card = document.querySelector('[data-testid="team-agent-card"]');
      const fab = document.querySelector('button[aria-label="总管"]');
      return {
        headH: box(head)?.height,
        backW: box(back)?.width,
        backH: box(back)?.height,
        colW: box(col)?.width,
        cardH: box(card)?.height,
        cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : null,
        fabW: box(fab)?.width,
        fabH: box(fab)?.height,
      };
    });
    check(geo.headH === 44, `A1 壳头 44px（实测 ${geo.headH}）`);
    check(
      geo.backW === 28 && geo.backH === 28,
      `A2 back 钮 28×28（实测 ${geo.backW}×${geo.backH}）`,
    );
    check(geo.colW === 766, `A3 版心 766px（实测 ${geo.colW}）`);
    check(
      geo.cardH === 76 && geo.cardRadius === '12px',
      `A4 Agent 卡 76 高 / radius-popover 12（实测 ${geo.cardH} / ${geo.cardRadius}）`,
    );
    check(geo.fabW === 48 && geo.fabH === 48, `A5 总管 FAB 48×48（实测 ${geo.fabW}×${geo.fabH}）`);
    check(
      (await page.getByTestId('team-agent-card').count()) === 2,
      'A6 两枚 Agent 卡在场（REST 前置）',
    );

    await page.getByRole('tab', { name: 'chart' }).click();
    await page.getByTestId('team-chart-node').first().waitFor();
    const chartGeo = await page.evaluate(() => {
      const node = document.querySelector('[data-testid="team-chart-node"]');
      const link = document.querySelector('[data-testid="team-chart-link"]');
      const bracket = document.querySelector('[data-testid="team-chart-bracket"]');
      const box = (el) => (el ? el.getBoundingClientRect() : null);
      return {
        nodeW: box(node)?.width,
        nodeH: box(node)?.height,
        nodeRadius: node ? getComputedStyle(node).borderTopLeftRadius : null,
        linkW: box(link)?.width,
        linkH: box(link)?.height,
        bracketW: box(bracket)?.width,
      };
    });
    check(
      chartGeo.nodeW === 220 && chartGeo.nodeH === 56 && chartGeo.nodeRadius === '8px',
      `A7 chart 节点 220×56 / 圆角 8（实测 ${chartGeo.nodeW}×${chartGeo.nodeH} / ${chartGeo.nodeRadius}）`,
    );
    check(
      chartGeo.linkW === 44 && chartGeo.linkH === 1 && chartGeo.bracketW === 28,
      `A8 连接线 44×1 / 括号列 28（实测 ${chartGeo.linkW}×${chartGeo.linkH} / ${chartGeo.bracketW}）`,
    );
    await shot(page, `03-team-chart-${theme}.png`);
    await page.getByRole('tab', { name: 'grid' }).click();
    await page.getByTestId('team-agent-card').first().waitFor();
    await shot(page, `02-team-grid-${theme}.png`);

    collected.push(...scorePairs(await measurePairs(page, { face: 'team' })));

    const slots = await page.evaluate(() => {
      const create = [...document.querySelectorAll('button')].find((b) =>
        b.textContent.includes('创建 Agent'),
      );
      return {
        createSlot: create?.dataset.slot ?? null,
        createVariant: create?.dataset.variant ?? null,
      };
    });
    check(
      slots.createSlot === 'button' && slots.createVariant === 'ghost',
      `B1 创建槽 = Button ghost 件槽（data-slot=${slots.createSlot} data-variant=${slots.createVariant}）`,
    );

    await page.getByRole('tab', { name: 'chart' }).click();
    await page.getByTestId('team-chart-node').first().waitFor();
    const gridGone = (await page.getByTestId('team-agent-grid').count()) === 0;
    await page.getByRole('tab', { name: 'grid' }).click();
    await page.getByTestId('team-agent-card').first().waitFor();
    check(gridGone, 'C1 布局 tab 往返：chart 下 grid 整格退场，回 grid 卡复现');

    await page.getByRole('button', { name: '创建 Agent' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 5_000 });
    check(await dialog.isVisible(), 'C2 创建 Agent 弹窗开出（role=dialog）');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    check(!(await dialog.isVisible().catch(() => false)), 'C2b Esc 关弹窗（家族律）');

    await page.getByRole('link', { name: '设置', exact: true }).click();
    await page.waitForURL(/\/app\/account/);
    await page.getByRole('switch', { name: '推送通知' }).waitFor();
    const langTrigger = page.locator('[aria-haspopup="listbox"]');
    await langTrigger.click();
    const listbox = page.getByRole('listbox', { name: '语言' });
    await listbox.waitFor({ timeout: 5_000 });
    const optionCount = await listbox.getByRole('option').count();
    check(optionCount === 2, `C3 语言盘开出：role=listbox + ${optionCount} 项`);

    collected.push(...scorePairs(await measurePairs(page, { face: 'account' })));
    await shot(page, `05-lang-dropdown-${theme}.png`);
    await listbox.getByRole('option', { name: 'English' }).click();
    await listbox.waitFor({ state: 'hidden', timeout: 5_000 });
    const stored = await page.evaluate(() => localStorage.getItem('cairn.locale'));
    const triggerText = await langTrigger.textContent();
    check(
      stored === 'en' && triggerText === 'English',
      `C3b 选择即关 + locale 持久（cairn.locale=${stored}，触发钮=${triggerText}）`,
    );

    await langTrigger.click();
    await page.getByRole('listbox').getByRole('option', { name: '简体中文' }).click();
    check((await langTrigger.textContent()) === '简体中文', 'C3c locale 换回 简体中文');

    const sw = page.getByRole('switch', { name: '推送通知' });
    const before = await sw.getAttribute('aria-checked');
    await sw.click();
    await page.waitForTimeout(300);
    const after = await sw.getAttribute('aria-checked');
    const swSlot = await page.evaluate(
      () => document.querySelector('[role="switch"]')?.dataset.slot ?? null,
    );
    check(
      before === 'false' && after === 'false' && swSlot === 'switch' && pageErrors.length === 0,
      `C4 推送开关 denied 落定（aria-checked ${before} → ${after}，data-slot=${swSlot}，pageerror ${pageErrors.length}）`,
    );
    await shot(page, `04-account-${theme}.png`);

    await page.goto(`${WEB}/app/api-keys`);
    const emptyState = page.getByTestId('keys-empty');
    await emptyState.waitFor({ timeout: 10_000 });
    check(await emptyState.isVisible(), 'C5 API 密钥空态在场（keys-empty testid）');

    collected.push(...scorePairs(await measurePairs(page, { face: 'api-keys' })));
    await shot(page, `06-apikeys-empty-${theme}.png`);
    await emptyState.getByRole('button', { name: '新建密钥' }).click();
    const keyDialog = page.getByRole('dialog');
    await keyDialog.waitFor({ timeout: 5_000 });

    await keyDialog.getByRole('button', { name: '授予全部' }).click();
    const boxes = keyDialog.getByRole('checkbox');
    const boxCount = await boxes.count();
    const firstAfterGrant = await boxes.first().getAttribute('aria-checked');
    await keyDialog.getByRole('button', { name: '清空' }).click();
    const firstAfterClear = await boxes.first().getAttribute('aria-checked');
    check(
      boxCount > 100 && firstAfterGrant === 'true' && firstAfterClear === 'false',
      `C5b 权限位表单：${boxCount} 枚 checkbox，授予全部 → ${firstAfterGrant}，清空 → ${firstAfterClear}`,
    );
    const quickSlot = await keyDialog
      .getByRole('button', { name: '授予全部' })
      .evaluate((el) => el.dataset.slot ?? null);
    check(quickSlot === 'button', `B2 快捷钮 = Button 件槽（data-slot=${quickSlot}）`);
    await shot(page, `07-apikey-dialog-${theme}.png`);

    await keyDialog.getByLabel('名称（可选）').fill('verify-947-key');
    await keyDialog.getByRole('button', { name: '创建', exact: true }).click();
    await keyDialog.waitFor({ state: 'hidden', timeout: 5_000 });
    const onceNote = page.getByText('请立即复制密钥，它仅显示一次。');
    await onceNote.waitFor({ timeout: 5_000 });
    const rowName = page.getByText('verify-947-key');
    check(await onceNote.isVisible(), 'C5c 创建落地：一次性明文块 + canon 提示在场');
    check(await rowName.isVisible(), 'C5d 列表行带名称（掩码行并存）');

    collected.push(...scorePairs(await measurePairs(page, { face: 'api-keys' })));
    await shot(page, `08-apikeys-created-${theme}.png`);

    const cssScan = await page.evaluate(() => {
      const retired = [
        '.secondary-shell',
        '.secondary-head',
        '.secondary-back',
        '.secondary-title',
        '.secondary-head-right',
        '.secondary-link',
        '.secondary-body',
        '.secondary-col',
        '.secondary-fab',
        '.team-toprow',
        '.team-stats',
        '.team-members',
        '.team-layout-tab',
        '.team-chart-empty',
        '.team-chart-link',
        '.team-chart-bracket',
        '.team-chart-node',
        '.team-chart-create',
        '.team-chart-avatar',
        '.team-chart-name',
        '.team-chart-model',
        '.team-chart-provider',
        '.team-chart-crown',
        '.team-grid',
        '.team-agent-card',
        '.team-agent-avatar',
        '.team-create-agent',
        '.team-create-icon',
        '.account-select',
        '.account-switch',
        '.keys-empty-tile',
        '.keys-create',
        '.keys-once',
        '.keys-list',
        '.keys-row',
        '.lang-dropdown',
        '.apikey-form',
      ];
      const hits = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        const walk = (list) => {
          for (const rule of list) {
            if (rule.cssRules) walk(rule.cssRules);
            const sel = rule.selectorText;
            if (sel == null) continue;

            if (sel.includes('[data-base-ui-portal]')) continue;
            if (sel.includes('\\[')) continue;
            for (const cls of retired) {
              const re = new RegExp(`\\${cls}(?![\\w-])`);
              if (re.test(sel)) hits.push(sel);
            }
          }
        };
        walk(rules);
      }
      return hits;
    });
    check(
      cssScan.length === 0,
      `D1 退役选择器零规则（命中 ${cssScan.length}：${cssScan.slice(0, 3).join(' | ')}）`,
    );
  } else {

    await shot(page, `09-team-grid-${theme}.png`);
    collected.push(...scorePairs(await measurePairs(page, { face: 'team' })));

    await page.getByRole('link', { name: '设置', exact: true }).click();
    await page.waitForURL(/\/app\/account/);
    await page.getByRole('switch', { name: '推送通知' }).waitFor();
    await page.locator('[aria-haspopup="listbox"]').click();
    await page.getByRole('listbox', { name: '语言' }).waitFor({ timeout: 5_000 });
    collected.push(...scorePairs(await measurePairs(page, { face: 'account' })));
    await shot(page, `10-account-lang-${theme}.png`);
    await page.keyboard.press('Escape');

    await page.goto(`${WEB}/app/api-keys`);
    await page.locator('.secondary-main').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(400);
    collected.push(...scorePairs(await measurePairs(page, { face: 'api-keys' })));
  }

  const rows = dedupe(collected);
  contrast[theme] = rows;
  const bad = rows.filter((r) => !r.pass);
  check(
    bad.length === 0,
    `E-${theme} 对比度 ${rows.length} 对全过（未过 ${bad.length}：${bad
      .map((b) => `${b.face}=${b.ratio}`)
      .join(', ')}）`,
  );
  await context.close();
}

await browser.close();

writeFileSync(
  join(EVIDENCE, 'result.json'),
  `${JSON.stringify({ probe: 'drive-947-secondary', checks, artifacts, failures }, null, 2)}\n`,
);
writeFileSync(join(EVIDENCE, 'contrast.json'), `${JSON.stringify(contrast, null, 2)}\n`);
console.log(`evidence:${EVIDENCE}`);
console.log(
  failures === 0 ? 'drive-947-secondary:PASS' : `drive-947-secondary:FAIL(${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
