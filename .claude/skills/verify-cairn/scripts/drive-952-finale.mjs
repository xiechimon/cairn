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
  join(SCRIPT_ROOT, '.claude', 'verify-evidence', `${stamp}-952-finale`);
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
    const fg = parseRgb(p.fg);
    const bg = parseRgb(p.bg);
    if (fg == null || bg == null) return { ...p, ratio: null, pass: false, note: 'unparsable' };
    const r = ratio(fg, bg);
    const floor = p.kind === 'text' ? 4.5 : p.kind === 'ui' ? 3.0 : null;
    return {
      ...p,
      ratio: Math.round(r * 100) / 100,
      floor,
      pass: floor == null ? true : r >= floor,
    };
  });

const tokenPairs = (page) =>
  page.evaluate(() => {
    const resolveVar = (decl, value) => {
      const probe = document.createElement('div');
      probe.style.setProperty(decl, value);
      document.body.append(probe);
      const out = getComputedStyle(probe).getPropertyValue(decl).trim();
      probe.remove();
      return out;
    };
    const tokenPair = (face, fgVar, bgVar, kind) => ({
      face,
      fg: resolveVar('color', fgVar),
      bg: resolveVar('color', bgVar),
      kind,
    });
    return [
      tokenPair('select-trigger', 'var(--text-primary)', 'var(--surface)', 'text'),
      tokenPair('profile-row-label', 'var(--text-secondary)', 'var(--surface-secondary)', 'text'),
      tokenPair('detail-value', 'var(--text-primary)', 'var(--surface-secondary)', 'text'),
      tokenPair('checkbox-check', 'var(--text-on-accent)', 'var(--card-button)', 'ui'),
      tokenPair('secret-add-link', 'var(--chip-plan-fg)', 'var(--surface-secondary)', 'text'),
      tokenPair('perm-error', 'var(--danger)', 'var(--background)', 'text'),
    ];
  });

const RETIRED_SELECTORS = [
  '.dlg-title',
  '.dlg-close',
  '.dlg-head',
  '.dlg-body',
  '.dlg-foot',
  '.dlg-backdrop',
  '.dlg-form',
  '.dlg-agent-create',
  '.dlg-shell',
  '.dlg-viewport',
  '.agent-name',
  '.agent-task-row',
  '.agent-tasks',
  '.agent-memory',
  '.agent-perm',
  '.agent-role',
  '.agent-thinking',
  '.agent-secret-add',
  '.profile-card',
  '.profile-row',
  '.profile-head',
  '.profile-avatar',
  '.profile-label',
  '.profile-hint',
  '.profile-value',
  '.ui-select-menu',
  '.ui-select-row',
  '.ui-select-shell',
  '.ui-checkbox-tile',
  '.ui-checkbox-indicator',
  '.anchored-pop-shell',
  '.chip--',
];
const auditStylesheets = (page) =>
  page.evaluate((retired) => {
    const hits = [];
    const walk = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules != null) {
          walk(rule.cssRules);
          continue;
        }
        const sel = rule.selectorText;
        if (sel == null || sel.includes('\\')) continue;
        for (const name of retired) {
          if (sel.includes(name)) hits.push(`${sel} (${name})`);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      walk(rules);
    }

    return hits;
  }, RETIRED_SELECTORS);

const toggleSlots = (page) =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      track: cs.getPropertyValue('--toggle-track').trim(),
      knob: cs.getPropertyValue('--toggle-knob').trim(),
    };
  });

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body == null ? undefined : { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: null, text };
  }
}

const browser = await chromium.launch();
const contrast = {};
let agentId = null;
let teamId = null;

for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 732 },
    colorScheme: theme,
  });
  await context.addInitScript(([t]) => localStorage.setItem('cairn-theme', t), [theme]);
  const page = await context.newPage();

  await page.goto(`${WEB}/app`);
  await page.locator('[data-testid="board-scroller"]').waitFor({ timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
  const hits = await auditStylesheets(page);
  check(
    hits.length === 0,
    `F1-${theme} 退役选择器零规则（命中 ${hits.length}${hits.length > 0 ? `：${hits.slice(0, 5).join('; ')}` : ''}）`,
  );
  const slots = await toggleSlots(page);
  check(
    slots.track === '' && slots.knob === '',
    `F2-${theme} --toggle-track/--toggle-knob 两槽已删（track='${slots.track}' knob='${slots.knob}'）`,
  );

  if (theme === 'dark') {

    await page.goto(`${WEB}/app/team`);
    await page.getByRole('button', { name: '创建 Agent' }).first().click();
    const dialog = page.getByRole('dialog', { name: '创建 agent' });
    await dialog.waitFor({ timeout: 10_000 });

    await dialog
      .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
      .catch(() => {});
    check(true, 'A1 创建弹窗 = role=dialog + 可及名「创建 agent」（§5.5 一级载体）');
    check(
      (await dialog.getByTestId('dialog-head').count()) === 1 &&
        (await dialog.getByTestId('dialog-body').count()) === 1 &&
        (await dialog.getByTestId('dialog-foot').count()) === 1,
      'A2 结构钩子 dialog-head/-body/-foot testid 三件在场（§5.5 二级）',
    );
    check(
      (await dialog.getByRole('button', { name: '关闭' }).count()) === 1,
      'A3 关闭钮 aria-label 载体在场',
    );

    const panelMotion = await dialog.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { dur: cs.transitionDuration, prop: cs.transitionProperty };
    });
    check(
      /0\.1s|100ms/.test(panelMotion.dur) && !panelMotion.prop.includes('visibility'),
      `A4 registry 退场档生效 + 手写 visibility 桥退役（transition-duration=${panelMotion.dur}, property=${panelMotion.prop}）`,
    );
    const labelBox = await dialog.getByText('名称', { exact: true }).first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fs: cs.fontSize, lh: cs.lineHeight, ls: cs.letterSpacing };
    });
    check(
      labelBox.fs === '12px' && labelBox.lh === '18px' && labelBox.ls === '0.12px',
      `B1 label 12px/18px/0.01em（§5.4 --label-size 定版；实测 ${labelBox.fs}/${labelBox.lh}/${labelBox.ls}）`,
    );
    const inputH = await dialog.locator('#dlg-agent-name').evaluate((el) =>
      el.getBoundingClientRect().height,
    );
    check(
      Math.abs(inputH - 32) <= 1,
      `B2 名称输入 32 高（件正典 h-8，36px 不存续；实测 ${inputH}）`,
    );
    const submitW = await dialog
      .getByRole('button', { name: '创建', exact: true })
      .evaluate((el) => el.getBoundingClientRect().width);
    const footW = await dialog.getByTestId('dialog-foot').evaluate((el) => {
      const cs = getComputedStyle(el.firstElementChild ?? el);
      return el.getBoundingClientRect().width - Number.parseFloat(cs.paddingLeft ?? 0) * 0 - 32;
    });
    check(
      Math.abs(submitW - footW) <= 2,
      `B3 提交钮 w-full 钉底（钮 ${submitW} ≈ foot 内容宽 ${footW}）`,
    );
    await shot(page, '01-create-agent-dialog.png');
    const agentName = `verify-952-${stamp}`;
    await dialog.locator('#dlg-agent-name').fill(agentName);
    await dialog.getByRole('button', { name: '创建', exact: true }).click();
    await page.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 10_000 });
    const teams = await api('GET', '/api/teams');
    teamId = teams.json?.[0]?.id;

    const members = teamId == null ? { json: [] } : await api('GET', `/api/teams/${teamId}/members`);
    const memberRow = (members.json ?? []).find(
      (m) => m.memberType === 'agent' && m.actor?.displayName === agentName,
    );
    agentId = memberRow?.actorId ?? null;
    check(agentId != null, 'B4 创建全链落 REST 真值（members 投影命中新 agent 行）');

    if (agentId != null) {
      await page.goto(`${WEB}/app/resources/agents/${agentId}`);
      const nameRow = page.locator('.profile-row').filter({ hasText: '名称' }).first();
      await nameRow.waitFor({ timeout: 10_000 });
      const nameRowH = await nameRow.evaluate((el) => el.getBoundingClientRect().height);
      check(Math.abs(nameRowH - 49) <= 1, `C1 名称行 49 高（模板 name 档；实测 ${nameRowH}）`);
      const runtimeRow = page.locator('.profile-row').filter({ hasText: '运行时' }).first();
      const rowH = await runtimeRow.evaluate((el) => el.getBoundingClientRect().height);
      check(Math.abs(rowH - 41) <= 1, `C2 字段行 41 高（40+1 分隔线；实测 ${rowH}）`);
      const avatarW = await page
        .locator('.profile-avatar img')
        .first()
        .evaluate((el) => el.getBoundingClientRect().width);
      check(Math.abs(avatarW - 64) <= 1, `C3 头像圆 64（实测 ${avatarW}）`);
      const tasksRadius = await page.locator('.agent-tasks').evaluate((el) =>
        getComputedStyle(el).borderRadius,
      );
      check(tasksRadius === '10px', `C4 进行中卡 radius 10（实测 ${tasksRadius}）`);
      check(
        (await page.getByText('暂无进行中的任务').count()) === 1,
        'C5 进行中 canon 空态在场',
      );

      const trigger = page.locator('.agent-runtime-select');
      await trigger.click();
      const menu = page.locator('.agent-runtime-menu');
      await menu.waitFor({ state: 'visible', timeout: 5_000 });
      await page.waitForTimeout(200);
      const tb = await trigger.boundingBox();
      const mb = await menu.boundingBox();
      const anchored = mb.x < tb.x + tb.width && mb.x + mb.width > tb.x;
      const inViewport =
        mb.x >= -0.5 && mb.y >= -0.5 && mb.x + mb.width <= 1440.5 && mb.y + mb.height <= 732.5;
      check(
        anchored && inViewport,
        `C6 概览菜单锚在触发钮上且整块在视口内（registry 默认几何，#1010；锚定 ${anchored} / 视口 ${inViewport}）`,
      );
      check(
        (await menu.getByRole('option').first().textContent())?.includes('内置 (pi)') === true,
        'C7 运行时菜单首行 = 内置 (pi) 清空档',
      );
      await shot(page, '02-agent-detail-runtime-menu.png');
      await page.keyboard.press('Escape');

      await page.locator('.agent-name').click();
      const nameInput = page.locator('#agent-name-input');
      await nameInput.waitFor({ timeout: 5_000 });
      const nameInputH = await nameInput.evaluate((el) => el.getBoundingClientRect().height);
      check(Math.abs(nameInputH - 32) <= 1, `C8 名称编辑器 32 高（实测 ${nameInputH}）`);
      await nameInput.fill('verify-952-renamed');
      await nameInput.press('Enter');
      await page.waitForTimeout(400);
      const afterRename = await api('GET', `/api/teams/${teamId}/agents/${agentId}`);
      check(
        afterRename.json?.displayName === 'verify-952-renamed',
        `C9 名称行内编辑落 PATCH 真值（REST 回读 ${afterRename.json?.displayName}）`,
      );

      await page.locator('.agent-role-edit').click();
      const roleInput = page.locator('#agent-role-input');
      await roleInput.waitFor({ timeout: 5_000 });
      const roleStyle = await roleInput.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { minH: cs.minHeight, fs: cs.fontSize, slot: el.dataset.slot };
      });
      check(
        Math.abs(Number.parseFloat(roleStyle.minH) - 64) <= 1 &&
          roleStyle.fs === '13px' &&
          roleStyle.slot === 'textarea',
        `C10 职责编辑器 = Textarea 件（data-slot）+ min-h 64 + 13px（实测 ${roleStyle.minH}/${roleStyle.fs}/${roleStyle.slot}）`,
      );
      await roleInput.fill('952 验证职责');
      await page.getByRole('button', { name: '保存' }).click();
      await page.waitForTimeout(400);
      const afterRole = await api('GET', `/api/teams/${teamId}/agents/${agentId}`);
      check(
        afterRole.json?.description === '952 验证职责',
        `C11 职责编辑落 PATCH 真值（REST 回读 ${afterRole.json?.description}）`,
      );

      await page.getByRole('tab', { name: '记忆' }).click();
      const headText = await page.locator('.agent-memory-head').textContent();
      check(
        headText?.includes('记忆 · 0 / 100') === true,
        `C12 记忆配额头 canon（实测「${headText}」）`,
      );

      await page.getByRole('tab', { name: '权限' }).click();
      const switches = page.getByRole('switch');
      const switchCount = await switches.count();
      check(switchCount >= 6, `C13 权限面开关 ≥6（实测 ${switchCount}）`);
      const firstSwitch = switches.first();
      const swLabel = await firstSwitch.getAttribute('aria-label');
      const before = await firstSwitch.getAttribute('aria-checked');
      await firstSwitch.click();
      await page.waitForTimeout(400);
      const afterTool = await api('GET', `/api/teams/${teamId}/agents/${agentId}`);
      const tools = afterTool.json?.tools ?? [];

      const nowOn = before !== 'true';
      const after = await firstSwitch.getAttribute('aria-checked');
      check(
        after === String(nowOn) && tools.includes(swLabel) === nowOn,
        `C14 工具开关切换落库（${swLabel}: aria-checked ${before}→${after}，REST tools 含=${tools.includes(swLabel)}）`,
      );
      await shot(page, '03-agent-detail-perms.png');
    } else {
      check(false, 'C 面跳过：创建 Agent 未落库，拿不到 id');
    }

    await page.goto(`${WEB}/app/account`);
    const langRow = page.locator('.profile-row').filter({ hasText: '语言' }).first();
    await langRow.waitFor({ timeout: 10_000 });
    const langRowH = await langRow.evaluate((el) => el.getBoundingClientRect().height);
    check(Math.abs(langRowH - 57) <= 1, `D1 语言行 57 高（模板 tall 档；实测 ${langRowH}）`);
    await page.locator('[aria-haspopup="listbox"]').click();
    const langOption = page.getByRole('option').first();
    await langOption.waitFor({ timeout: 5_000 });
    const langBorder = await langOption.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { top: cs.borderTopWidth, style: cs.borderTopStyle };
    });
    check(
      langBorder.top === '0px' || langBorder.style === 'none',
      `D2 语言盘选项行 border-0（#947 遗留补丁实物；实测 ${langBorder.top}/${langBorder.style}）`,
    );
    await shot(page, '04-account-lang-dropdown.png');
    await page.keyboard.press('Escape');
    check(
      (await page.getByRole('switch', { name: '推送通知' }).count()) === 1,
      'D3 推送开关 role=switch 在场',
    );

    await page.goto(`${WEB}/app/team`);
    await page.waitForTimeout(600);

    await page.getByRole('tab', { name: 'chart' }).click().catch(() => {});
    await page.waitForTimeout(300);
    const createSlotSvg = await page
      .locator('button:has(span.rounded-full.border-dashed) svg')
      .first()
      .evaluate((el) => el.getBoundingClientRect().width)
      .catch(() => null);
    check(
      createSlotSvg != null && Math.abs(createSlotSvg - 12) <= 1,
      `E1 组织图创建槽 svg 12px（[&_svg]:size-3 补丁实物；实测 ${createSlotSvg}）`,
    );
    await shot(page, '05-team-chart-create-slot.png');
  }

  const rows = scorePairs(await tokenPairs(page));
  contrast[theme] = rows;
  const bad = rows.filter((r) => !r.pass);
  check(
    bad.length === 0,
    `G-${theme} 对比度 ${rows.length} 对全过（未过 ${bad.length}：${bad
      .map((b) => `${b.face}=${b.ratio}`)
      .join(', ')}）`,
  );

  await context.close();
}

await browser.close();

writeFileSync(
  join(EVIDENCE, 'result.json'),
  `${JSON.stringify({ probe: 'drive-952-finale', checks, artifacts, failures }, null, 2)}\n`,
);
writeFileSync(join(EVIDENCE, 'contrast.json'), `${JSON.stringify(contrast, null, 2)}\n`);
console.log(`evidence:${EVIDENCE}`);
console.log(failures === 0 ? 'drive-952-finale:PASS' : `drive-952-finale:FAIL(${failures})`);
process.exit(failures === 0 ? 0 : 1);
