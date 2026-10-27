#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ROOT = process.env.VERIFY_REPO_ROOT ? resolve(process.env.VERIFY_REPO_ROOT) : SCRIPT_ROOT;
const RUN_DIR = process.env.VERIFY_RUN_DIR ?? join(ROOT, '.claude', 'verify-run');
const ports = JSON.parse(readFileSync(join(RUN_DIR, 'ports.json'), 'utf8'));
const SERVER = `http://127.0.0.1:${ports.serverPort ?? 8795}`;
const WEB = `http://127.0.0.1:${ports.webPort ?? 5277}`;

const seed951 = JSON.parse(
  readFileSync(process.env.SEED951_JSON ?? '/tmp/951-seed.json', 'utf8'),
);
const seedReview = JSON.parse(
  readFileSync(process.env.SEED_REVIEW_JSON ?? '/tmp/951-review-seed.json', 'utf8'),
);

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const EVIDENCE =
  process.env.VERIFY_EVIDENCE_DIR ?? join(SCRIPT_ROOT, `.claude/verify-evidence/${ts}-951-detail`);
mkdirSync(EVIDENCE, { recursive: true });

const checks = [];
let failures = 0;
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null });
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
};

const jpost = async (path, body, token) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
};
const jget = async (path) => {
  const res = await fetch(`${SERVER}${path}`);
  return { status: res.status, body: await res.json() };
};

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });

const contrastRows = [];
async function measurePair(page, locate, label, kind, fgFrom = 'color') {
  const loc = typeof locate === 'string' ? page.locator(locate).first() : locate(page).first();
  if ((await loc.count()) === 0) {
    contrastRows.push({ label, kind, missing: true });
    return;
  }
  const row = await loc.evaluate((el, fgFrom) => {
    const parse = (v) => {
      const m = v.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(/[\s,]+/).filter(Boolean).map(Number);
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
      }
      const s = v.match(/color\(srgb\s+([^)]+)\)/);
      if (s) {
        const raw = s[1].split(/\s+/).filter((x) => x !== '/');
        const n = raw.map(Number);
        return {
          r: Math.round(n[0] * 255),
          g: Math.round(n[1] * 255),
          b: Math.round(n[2] * 255),
          a: s[1].includes('/') && raw.length > 3 ? n[3] : 1,
        };
      }
      const ok = v.match(/oklab\(([^)]+)\)/);
      if (ok) {
        const raw = ok[1].split(/\s+/).filter((x) => x !== '/');
        const n = raw.map(Number);
        const l_ = n[0] + 0.3963377774 * n[1] + 0.2158037573 * n[2];
        const m_ = n[0] - 0.1055613458 * n[1] - 0.0638541728 * n[2];
        const s_ = n[0] - 0.0894841775 * n[1] - 1.291485548 * n[2];
        const l = l_ ** 3;
        const m = m_ ** 3;
        const ss = s_ ** 3;
        const lin = [
          4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * ss,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * ss,
          -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * ss,
        ];
        const g = (x) => {
          const c = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
          return Math.round(Math.min(1, Math.max(0, c)) * 255);
        };
        return {
          r: g(lin[0]),
          g: g(lin[1]),
          b: g(lin[2]),
          a: ok[1].includes('/') && raw.length > 3 ? n[3] : 1,
        };
      }
      return null;
    };
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const effectiveBg = (node0) => {
      const layers = [];
      let node = node0;
      while (node != null && node !== document.documentElement) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c != null && c.a > 0) {
          layers.push(c);
          if (c.a === 1) break;
        }
        node = node.parentElement;
      }
      const root = parse(getComputedStyle(document.documentElement).backgroundColor) ?? {
        r: 30, g: 27, b: 22, a: 1,
      };
      let acc = root;
      for (let i = layers.length - 1; i >= 0; i -= 1) acc = over(layers[i], acc);
      return acc;
    };
    const lum = (c) => {
      const f = (x) => {
        const s = x / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const cs = getComputedStyle(el);
    const toHex = (c) =>
      `#${[c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
    if (fgFrom === 'background') {
      const ownRaw = parse(cs.backgroundColor);
      if (ownRaw == null) return { unparsed: cs.backgroundColor };
      const parentBg = el.parentElement != null ? effectiveBg(el.parentElement) : effectiveBg(el);
      const own = ownRaw.a < 1 ? over(ownRaw, parentBg) : ownRaw;
      const ratio =
        (Math.max(lum(own), lum(parentBg)) + 0.05) / (Math.min(lum(own), lum(parentBg)) + 0.05);
      return { fg: toHex(own), bg: toHex(parentBg), ratio: Math.round(ratio * 100) / 100 };
    }
    const fgRaw = parse(cs.color);
    if (fgRaw == null) return { unparsed: cs.color };
    const bg = effectiveBg(el);
    const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
    const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
    return { fg: toHex(fg), bg: toHex(bg), ratio: Math.round(ratio * 100) / 100 };
  }, fgFrom);
  contrastRows.push({ label, kind, ...row });
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });

  await page.goto(`${WEB}/app/team`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '创建 Agent' }).first().click();
  const agentDialog = page.getByRole('dialog', { name: '创建 agent' });
  await agentDialog.waitFor({ state: 'visible', timeout: 10_000 });

  check(
    'A1-slot-rows-visible',
    (await agentDialog.getByText('运行时', { exact: true }).count()) === 1 &&
      (await agentDialog.getByText('模型', { exact: true }).count()) === 1,
    'slot-row 纵排标签面在场（.dlg-agent-slot-row 类钩退役后）',
  );
  check(
    'A2-warn-absent',
    (await agentDialog.getByText('尚未配置模型服务商').count()) === 0,
    '有候选时告警行让位（两态互斥，warn 面本体归 fixture e2e）',
  );
  check(
    'A3-avatar-testid',
    (await agentDialog.getByTestId('agent-avatar').locator('img').count()) === 1,
    'agent-avatar testid + img 常驻（SeededAvatar keepMounted 契约）',
  );
  await agentDialog.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).catch(() => {}),
  );
  await shot(page, '01-create-agent-warn.png');
  await measurePair(page, () => agentDialog.getByText('运行时', { exact: true }), 'agent slot label primary on popover-bg', 'canon 13.09/4.5');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const started = await jpost(`/api/projects/${seed951.projectId}/builds`, {
    todoIds: [seed951.todoId],
    assignment: { plan: { agentId: seed951.agentId }, build: { agentId: seed951.agentId } },
    withPlan: true,
  });
  check('B0-build-started', started.status === 201, `POST builds → ${started.status}`);
  const buildId = started.body?.builds?.[0]?.id ?? started.body?.build?.id ?? started.body?.id ?? null;
  if (buildId == null) {

    const t = await jget(`/api/todos/${seed951.todoId}`);
    var resolvedBuildId = t.body?.latestBuildId ?? null;
  } else {
    var resolvedBuildId = buildId;
  }
  check('B0b-build-id', resolvedBuildId != null, `buildId=${resolvedBuildId}`);

  await page.goto(`${WEB}/app/todo/${seed951.todoId}`, { waitUntil: 'networkidle' });

  await page.waitForSelector('.composer-stop', { timeout: 90_000 });

  await page.click('.detail-right .doc-select-wrap .doc-pane-select');
  await page.waitForSelector('[role="menu"]', { timeout: 5000 });
  await page.locator('[role="menuitemradio"]', { hasText: '分支与 PR' }).click();
  const right = page.locator('.detail-right');
  await right.getByLabel('同步目录').waitFor({ state: 'visible', timeout: 10_000 });
  const picker = right.locator('button[aria-haspopup="listbox"]');
  check('B1-picker-live', (await picker.count()) === 1, '机器 picker 可点态在场（live 判别式）');

  const restBg = await picker.evaluate((el) => getComputedStyle(el).backgroundColor);
  await picker.hover();
  await page.waitForTimeout(350);
  const hoverBg = await picker.evaluate((el) => getComputedStyle(el).backgroundColor);
  check('B2-pill-hover-neutralized', restBg === hoverBg, `hover bg ${restBg} → ${hoverBg}（漆底恒压）`);
  await measurePair(page, () => picker, 'machine pill primary on surface (live)', 'canon 14.17/4.5');
  await measurePair(page, () => picker.locator('span').first(), 'machine dot badge-done on surface (live)', 'ui', 'background');
  await picker.click();
  await right.getByRole('listbox').waitFor({ state: 'visible', timeout: 5000 });
  const opts = await right.locator('[role="listbox"] button').count();
  check('B3-machine-menu', opts >= 1, `role=listbox 菜单开出，在线机器 ${opts} 台`);
  await shot(page, '02-branch-section-live-menu.png');
  await right.locator('[role="listbox"] button').first().click();
  await page.waitForTimeout(300);

  const sw = right.getByRole('switch', { name: '强制同步' });
  check('B4-switch-carrier', (await sw.count()) === 1, 'role=switch + aria-label 载体在场');

  const cbAll = await right.locator('input[type="checkbox"]').count();
  const cbOwnedBySwitch = await right
    .locator('input[type="checkbox"]')
    .evaluateAll((els) =>
      els.filter((el) => el.parentElement?.querySelector('[role="switch"]') != null).length,
    );
  const switchCount = await right.locator('[role="switch"]').count();
  check(
    'B4b-legacy-toggle-gone',
    (await right.locator('.dlg-toggle').count()) === 0 &&
      cbAll === cbOwnedBySwitch &&
      cbAll === switchCount,
    `手搓拨杆绝迹（隐藏 input ${cbAll} 枚与 Switch 官方件 ${switchCount} 枚 1:1 配对=${cbOwnedBySwitch}）`,
  );
  check('B4c-switch-off', (await sw.getAttribute('aria-checked')) === 'false', '初始 off');
  await sw.click();
  await page.waitForTimeout(250);
  check('B5-switch-toggles', (await sw.getAttribute('aria-checked')) === 'true', '点击翻 on（aria-checked 载体）');
  await shot(page, '03-branch-section-switch-on.png');
  await measurePair(page, () => right.getByLabel('同步目录'), 'dir box tertiary on surface (live)', 'canon tertiary 7.86/4.5');
  await measurePair(page, () => sw, 'switch track unchecked vs pane bg (§4-1 report-only)', 'report', 'background');

  await page.click('.composer-stop');
  const stopDialog = page.getByRole('dialog', { name: '停止当前这一轮？' });
  await stopDialog.waitFor({ state: 'visible', timeout: 10_000 });
  const stopChecked = await stopDialog.locator('.ui-checkbox input[type="checkbox"]').isChecked();
  const stopLabel = await stopDialog.locator('.ui-checkbox > span:last-of-type').textContent();
  check('B6-stop-default-checked', stopChecked === true, `checkbox checked=${stopChecked}`);
  check(
    'B7-stop-label',
    stopLabel === '丢弃本轮修改——方案和代码回到上一个版本',
    `label=${stopLabel}`,
  );
  await stopDialog.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).catch(() => {}),
  );
  await shot(page, '04-stop-confirm-dialog.png');
  await measurePair(page, () => stopDialog.locator('.ui-checkbox > span:last-of-type'), 'stop label primary on popover-bg', 'canon 13.09/4.5');
  await measurePair(page, () => stopDialog.getByRole('button', { name: '取消' }), 'stop cancel tertiary on popover-bg', 'canon tertiary 7.86/4.5');

  await stopDialog.getByRole('button', { name: '停止' }).click();
  await stopDialog.waitFor({ state: 'hidden', timeout: 10_000 });
  check('B8-stop-closes', true, '停止 → 弹层关闭');
  await page.waitForTimeout(1500);
  const after = await jget(`/api/todos/${seed951.todoId}`);
  check(
    'B9-phase-fallback',
    after.body?.phase === 'todo' || after.body?.phase === 'failed',
    `stop 后 phase=${after.body?.phase}（gate 回落）`,
  );

  await page.goto(`${WEB}/app/todo/${seedReview.todoId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.composer-tool[aria-label="AI 审核"]', { timeout: 15_000 });
  await page.click('.composer-tool[aria-label="AI 审核"]');
  const reviewDialog = page.getByRole('dialog', { name: 'AI 审核' });
  await reviewDialog.waitFor({ state: 'visible', timeout: 10_000 });
  const options = reviewDialog.getByRole('option');
  check('C1-review-rows', (await options.count()) >= 1, `role=option 行 ${(await options.count())} 条`);
  await reviewDialog.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)).catch(() => {}),
  );
  await shot(page, '05-review-dialog.png');
  await options.first().click();
  await page.waitForTimeout(200);
  check(
    'C2-row-selected',
    (await options.first().getAttribute('aria-selected')) === 'true',
    '选中行 aria-selected 载体',
  );
  await shot(page, '06-review-row-selected.png');
  await measurePair(page, () => options.first(), 'review row primary on surface (live)', 'canon 14.17/4.5');
  await measurePair(page, () => options.first().locator('span').nth(1).locator('span').first(), 'review row name primary on surface', 'canon 14.17/4.5');
  await measurePair(page, () => reviewDialog.getByRole('textbox'), 'focus textarea primary on surface (live)', 'canon 14.17/4.5');
  await measurePair(page, () => reviewDialog.getByRole('button', { name: '开始审核' }), 'review start on-accent on card-button', 'canon 8.24/4.5');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const mech = await page.evaluate(() => {
    const retired = [
      '.dlg-accept', '.dlg-accept-footer', '.dlg-accept-cancel', '.dlg-accept-done',
      '.dlg-accept-label', '.dlg-accept-block', '.dlg-accept-reject',
      '.dlg-reset', '.dlg-reset-stale', '.dlg-reset-lead', '.dlg-reset-list', '.dlg-reset-kept',
      '.dlg-token-total', '.dlg-token-num', '.dlg-token-unit', '.dlg-token-model',
      '.dlg-token-row', '.dlg-token-label', '.dlg-token-value',
      '.dlg-branch-body', '.dlg-branch-box', '.dlg-branch-row', '.dlg-branch-label',
      '.dlg-branch-value', '.dlg-copy', '.dlg-machine', '.dlg-machine-dot', '.dlg-dir',
      '.dlg-pr-link', '.dlg-force', '.dlg-force-text', '.dlg-force-desc',
      '.dlg-toggle', '.dlg-toggle-knob', '.dlg-sync',
      '.dlg-history', '.dlg-history-row', '.dlg-history-glyph', '.dlg-history-ring',
      '.dlg-history-line', '.dlg-history-label', '.dlg-history-chip', '.dlg-history-meta',
      '.review-body', '.review-search', '.review-search-input', '.review-agent-list',
      '.review-agent-row', '.review-agent-avatar', '.review-agent-text', '.review-agent-name',
      '.review-agent-model', '.review-empty', '.review-notice', '.review-notice-title',
      '.review-notice-body', '.review-focus-row', '.review-focus-input', '.review-start',
      '.dlg-agent-avatar', '.dlg-agent-warn', '.dlg-agent-configure', '.dlg-agent-slot-row',
      '.dlg-provider-authrow', '.dlg-provider-authlabel', '.dlg-provider-list',
      '.dlg-provider-preset', '.dlg-provider-custom', '.dlg-provider-badge',
      '.dlg-provider-note', '.dlg-provider-oauth-error', '.dlg-provider-back',
      '.dlg-enroll', '.dlg-enroll-lead', '.dlg-enroll-desc', '.dlg-enroll-label',
      '.dlg-enroll-cmd', '.dlg-enroll-copy', '.dlg-enroll-toggle', '.dlg-enroll-apikey',
      '.dlg-enroll-keylink', '.dlg-enroll-browserlink',
    ];
    const hits = {};
    let overlaysCssSeen = false;
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (sheet.ownerNode?.textContent?.includes('dlg-token-total')) overlaysCssSeen = true;
      const walk = (list) => {
        for (const r of list) {
          if (r.cssRules != null) {
            walk(r.cssRules);
            continue;
          }
          if (r.selectorText == null) continue;
          for (const sel of retired) {
            const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`${escaped}(?![\\w-])`).test(r.selectorText)) {
              hits[sel] = (hits[sel] ?? 0) + 1;
            }
          }
        }
      };
      walk(rules);
    }
    return { hits, overlaysCssSeen };
  });
  const hitList = Object.entries(mech.hits);
  check(
    'D1-retired-selectors-zero-rules',
    hitList.length === 0,
    hitList.length === 0
      ? `${79} 个退役选择器在 live 运行时零 CSS 规则`
      : `残规则: ${JSON.stringify(hitList)}`,
  );
  check('D2-overlays-css-absent', mech.overlaysCssSeen === false, 'overlays.css 源文本不再进任何样式表');

  const contrastMd = [
    '# #951 live-only 面对比度实测（drive-951-detail，渲染对）',
    '',
    'floor 口径同 contrast-951.md（canon 槽对 / text 4.5 / ui 3.0 / report 只报数）。',
    '',
    '| face | fg | bg | ratio | kind | 判定 |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  let contrastFail = 0;
  for (const row of contrastRows) {
    if (row.missing === true || row.unparsed != null) {
      contrastMd.push(`| ${row.label} | — | — | — | ${row.kind} | MISSING |`);
      contrastFail += 1;
      continue;
    }
    const floor =
      row.kind === 'report'
        ? null
        : row.kind.startsWith('canon')
          ? Number(row.kind.match(/\/(\d+(?:\.\d+)?)$/)?.[1] ?? 4.5)
          : row.kind === 'ui'
            ? 3
            : 4.5;
    if (floor == null) {
      contrastMd.push(`| ${row.label} | ${row.fg} | ${row.bg} | ${row.ratio} | ${row.kind} | REPORT |`);
      continue;
    }
    const pass = row.ratio >= floor;
    if (!pass) contrastFail += 1;
    contrastMd.push(
      `| ${row.label} | ${row.fg} | ${row.bg} | ${row.ratio} | ${row.kind} | ${pass ? 'PASS' : 'FAIL'} |`,
    );
  }
  check('C3-live-contrast', contrastFail === 0, `${contrastRows.length} 对，FAIL ${contrastFail}`);
  writeFileSync(join(EVIDENCE, 'contrast-live-951.json'), JSON.stringify(contrastRows, null, 1));
  writeFileSync(join(EVIDENCE, 'contrast-live-951.md'), `${contrastMd.join('\n')}\n`);
  writeFileSync(join(EVIDENCE, 'result.json'), JSON.stringify({ checks, failures }, null, 1));
  process.stdout.write(`\nevidence: ${EVIDENCE}\nchecks=${checks.length} failures=${failures}\n`);
  await page.close();
} finally {
  await browser.close();
}
process.exit(failures > 0 ? 1 : 0);
