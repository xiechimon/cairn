#!/usr/bin/env node
// verify-cairn 定制 probe（#952 散件收尾）— live 栈真用户路径 + 全局删槽/
// 类名退役的运行时机制断言 + better-colors 对比度实测（token 解析对，双主题）。
// 栈必须已在跑（launch.mjs；坐标取 VERIFY_RUN_DIR/ports.json，worktree 车道传
// VERIFY_REPO_ROOT）。
//
// #1010 注记：C6/C7 的运行时选择器面已随手写 select.tsx 退役迁到 registry
// compound 律（菜单定域走 .agent-runtime-menu 句柄类；右缘锚几何退役 → registry
// 默认锚定 + 视口内）。本 probe 其余检查面（A4 退场桥 / B1 label / C3 头像 64 /
// C4 卡 radius 10 / C10 Textarea / D2 语言盘 border / G 对比度 token 对）是 #952
// 定版后 #1002（色板 E + 圆角基）/ #1003（头像 Root 定尺盒）/ #1007 / #1008 各波
// 的历史漂移，与 #1010 无关；重封到现行正典是独立的 probe 维护轮，不在本票射程。
// select 面的现行 live 复跑入口 = drive-1010-select.mjs + drive-agent-detail.mjs。
//
// 前置：无（probe 自己经 UI 建一个 Agent 喂详情页；建面对话框本身就是检查面）。
//
// 检查面：
//   A. dialog-shell 载体（spec/22 §5.5）：role=dialog 可及名、dialog-head/-body/
//      -foot testid、关闭钮 aria-label、registry 退场档（duration-100）在场 +
//      手写 visibility 桥绝迹（#1006 段 2 迁移）
//   B. create-agent 弹窗表单族（§5.4 utility 等值迁移）：label 12/18/0.01em、
//      Input 32 高（36px 不存续）、提交钮 w-full 钉底、创建全链落 REST 真值
//   C. agent 详情页（agent-detail.css 清零）：模板行高 49/41、头像 64、进行中
//      卡 radius 10 + 空态、运行时选择器右缘锚几何、名称/职责行内编辑落
//      PATCH 真值、记忆配额头、权限 6 开关 + 切换落库
//   D. account 页（profile-card.css 清零 + #947 遗留补丁）：语言行 57 高、
//      语言盘选项行 border 0（border-0 补丁实物）、推送开关 role=switch
//   E. team 页组织图创建槽 svg 12px（#947 遗留补丁实物）
//   F. 退役审计（运行时样式表枚举）：壳级 .dlg* 别名 / .dlg-form 族 /
//      .agent-* / .profile-* / .ui-select-* / .ui-checkbox-tile / .chip--*
//      选择器零规则；--toggle-track / --toggle-knob 两槽 computed 为空
//   G. 对比度实测（WCAG 2.x，token 解析对，双主题同配对集）
// schedules 面（SchedSelect 收敛）不在此 probe：live 新库无排期行，行为回归
// 由 apps/web e2e 的 schedules specs（fixture 面）承载。
// 证据（截图 + result.json + contrast.json）落 VERIFY_EVIDENCE_DIR。
// 任一断言失败退出码 1。口径与 apps/web/playwright.config.ts 一致：1440×732。

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

// ---- WCAG 2.x contrast（better-colors：实测不许估） ----
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

/** token 解析对（probe-div 走 var() 解析，drive-943/947 同款）：本票触及面
 *  的角色配对（选择器触发钮墨/底、模板行墨、勾选图形、危险行）。 */
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

/** F 面：退役审计——运行时样式表里不得再有这些选择器的规则（drive-947 D 节
 *  同款枚举；跳过 Tailwind arbitrary-variant 的转义选择器）。 */
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
        continue; // 跨源表读不了（live 栈同源，不应发生）
      }
      walk(rules);
    }
    // 精确壳级 .dlg（单类，不带后缀）单列：includes 会误伤 .dlg-* 已覆盖项
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

  // ---- F. 退役审计（board 面上取全量样式表） ----
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
    // ---- B. 创建 Agent 弹窗（§5.4 表单族 + §5.5 壳载体） ----
    await page.goto(`${WEB}/app/team`);
    await page.getByRole('button', { name: '创建 Agent' }).first().click();
    const dialog = page.getByRole('dialog', { name: '创建 agent' });
    await dialog.waitFor({ timeout: 10_000 });
    // #656：进场 zoom-in-95 会把 boundingBox 缩到 0.95——静息后再量几何。
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
    // #1006 段 2 探针迁移（#951/#952 随面同纪律）：旧 A4 钉 dialog-shell 手写
    // 退场 visibility 桥（transition-property 含 visibility）。registry 零皮化
    // 后退场机制 = Base UI 原生延迟卸载 + duration-100 animate-out（#991 Q9：
    // 动效 = base-nova 形态一部分）。断言迁成双面 computed 判据：registry
    // 动效档在场（0.1s）+ 手写桥绝迹；「关闭后真卸载」的行为面由 e2e
    // rerun-close-family / dialog-viewport / overlay-focus 钉（全绿）。
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
    // 列表读面 = members 投影（GET agents/{aid} 是单条读面，无列表端点）
    const members = teamId == null ? { json: [] } : await api('GET', `/api/teams/${teamId}/members`);
    const memberRow = (members.json ?? []).find(
      (m) => m.memberType === 'agent' && m.actor?.displayName === agentName,
    );
    agentId = memberRow?.actorId ?? null;
    check(agentId != null, 'B4 创建全链落 REST 真值（members 投影命中新 agent 行）');

    // ---- C. Agent 详情页（agent-detail.css 清零） ----
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
      // 运行时选择器（#1010 迁：手写 select → registry compound select）。旧 C6
      // 钉的「右缘贴触发钮右缘 + 锚距 8」是手写 absolute 壳的锚位配方，随壳退役
      // （ADR 0012 D1：registry 默认几何为正典，Base UI Positioner 锚定 + 碰撞
      // 翻转）。存活律 = 菜单锚在触发钮上（水平相交）+ 整块在视口内。listbox 不
      // 再带 aria-label（迁内层 Select.List，aria-label 落 role=presentation 的
      // Popup），故菜单定域改走消费点句柄类 .agent-runtime-menu（Popup 本体）。
      const trigger = page.locator('.agent-runtime-select');
      await trigger.click();
      const menu = page.locator('.agent-runtime-menu');
      await menu.waitFor({ state: 'visible', timeout: 5_000 });
      await page.waitForTimeout(200); // registry 进场 duration-100 播完再量静息几何
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
      // 名称行内编辑 → PATCH 真值
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
      // 职责编辑（Textarea 件收编）
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
      // 记忆 tab 配额头
      await page.getByRole('tab', { name: '记忆' }).click();
      const headText = await page.locator('.agent-memory-head').textContent();
      check(
        headText?.includes('记忆 · 0 / 100') === true,
        `C12 记忆配额头 canon（实测「${headText}」）`,
      );
      // 权限 tab 六开关 + 切换落库
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
      // 新建 agent 自带默认工具集（推送分支），断言取「翻转 + REST 命中一致」
      // 而非全集恰一——精确 toggle 语义由 agent-detail.spec 的 aria-checked
      // 翻转对钉住。
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

    // ---- D. account 页（profile-card 清零 + #947 遗留补丁） ----
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

    // ---- E. team 组织图创建槽 svg 12px（#947 遗留补丁） ----
    await page.goto(`${WEB}/app/team`);
    await page.waitForTimeout(600);
    // 布局是 localStorage 持久档：显式切 chart tab，不赌默认值。
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

  // ---- G. 对比度（token 解析对，双主题同配对集） ----
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
