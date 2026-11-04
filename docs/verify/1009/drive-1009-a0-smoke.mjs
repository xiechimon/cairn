#!/usr/bin/env node
// verify probe — configuration smoke + interaction-contract pins for the #1009
// A0 prototype (ADR 0013 shell-shape inversion: right-docked vertical panel →
// Multica-style floating window), fixture face; premortem guardrail 1 = "five-
// route configuration smoke: one window-open screenshot per route + boundingBox
// assertions".
//
// How to run (fixture stack must already be up):
//   cd apps/web && pnpm exec vite build --mode fixture
//   pnpm exec vite preview --host 127.0.0.1 --port ${E2E_PORT:-8403} --strictPort &
//   E2E_PORT=8403 node docs/verify/1009/drive-1009-a0-smoke.mjs
//
// Failure-mode-first list (ADR 0013 premortem + A0 face enumeration, one
// assertion group per line):
//  F1 mount-lift breaks the five shells: window overlaps sidebar / clipped by a
//     shell / lands in the wrong containing block → S2/S3 per-route
//     boundingBox (380x600 @ right/bottom 8, viewport 1440x732) + no-sidebar-
//     overlap assertion
//  F2 resident inert breaks the contract: after close the window must be "in
//     the DOM but invisible and inert" → S4; Escape never closes the panel
//     (D3, collapses only inner popovers) → S5; ⌘J opens and closes (#468) → S5
//  F3 state retention: minimize keeps the draft (D6) → S6; resident across
//     routes without remounting (D6) → S7
//  F4 yield-retirement residue: content column width unchanged across window
//     open/close (D1: overlay yields nothing) → S8; detail RightPane coexists
//     with the window (D7 inversion of mutual exclusion) → S8e
//  F5 fixture determinism: scenario capture shape opens the window (111) with
//     the same geometry → S9; the fixture face never writes
//     pacman.chief-open (persistence is live-face-only) → S11
//  F6 suppressed routes grow no new face: agent-detail / machine-authorize have
//     zero FAB and zero window → S10
//  F7 close model: the Minimize button (Minus, no X) is the only button-face
//     collapse → S4; settings-view content swap keeps the carrier (D9: board
//     gear → swap, window collapsed) → S12
//  F8 FAB exclusion and geometry: no FAB rendered while the window is open
//     (D4) → S2; 40px perfect circle @ 8px inset, same corner as the window →
//     S1; detail-family unreadOnly gate (#443 retained) → S8e
//  F9 z-order law: window/FAB ride the new --z-floating rung (15), the active
//     layer always stacks above it (#688) → S13
//
// Evidence lands in this directory: screenshots + result.json (all measured raw
// values, human-review face).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.E2E_PORT ?? '8403';
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1440, height: 732 };
// ADR 0013 D2 (Multica original values): window 380x600 @ right/bottom 8; D4: FAB 40 @ 8.
const WIN = { w: 380, h: 600, inset: 8 };
const FAB = { size: 40, inset: 8 };

const results = [];
let failures = 0;
function check(group, name, actual, expected) {
  const ok =
    typeof expected === 'function' ? expected(actual) : JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  results.push({ group, name, actual, expected: typeof expected === 'function' ? '(predicate)' : expected, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${group}] ${name} — actual=${JSON.stringify(actual)}`);
}

async function shot(page, file) {
  await page.screenshot({ path: join(SCRIPT_DIR, file) });
}

/** Mode-gate fact (api/mode.ts): the fixture face = a URL carrying ?scenario=;
 *  a bare URL on the fixture build's preview is likewise the live face (the API
 *  answers empty) — D5's open-state persistence takes effect on the live face
 *  (writes localStorage), so storage must be cleared between bare-URL segments,
 *  otherwise a window opened in the previous segment reopens automatically on
 *  the next segment's load (exactly the behavior S11 pins head-on). */
async function gotoClean(page, url) {
  await page
    .evaluate(() => {
      try {
        localStorage.removeItem('pacman.chief-open');
      } catch {}
    })
    .catch(() => {});
  await page.goto(url, { waitUntil: 'networkidle' });
}
const storedOpen = (page) => page.evaluate(() => localStorage.getItem('pacman.chief-open'));

const windowBox = (page) => page.locator('.chief-drawer').boundingBox();
const fabBox = (page) => page.locator('.chief-fab').boundingBox();
const fab = (page) => page.getByRole('button', { name: '总管', exact: true });
const win = (page) => page.locator('.chief-drawer');

async function openWindow(page) {
  await fab(page).click();
  await settleWindow(page);
}

/** Wait for the window to be truly open and the entry animation (fade+zoom
 *  0.95→1, --dur-overlay 200ms) to settle — boundingBox includes the transform,
 *  so measuring mid-animation reads the scaled value. */
async function settleWindow(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.chief-drawer');
    return el != null && !el.hasAttribute('hidden') && el.getBoundingClientRect().width > 0;
  });
  await page.waitForTimeout(400);
}

async function main() {
  mkdirSync(SCRIPT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'dark' });
  const page = await ctx.newPage();

  // ---- S1 board FAB geometry (D4: 40px perfect circle, 8px from the content area's right/bottom) ----
  await gotoClean(page, `${BASE}/app`);
  await fab(page).waitFor({ state: 'visible' });
  let box = await fabBox(page);
  check('S1', 'fab size 40x40', { w: box.width, h: box.height }, { w: FAB.size, h: FAB.size });
  check('S1', 'fab right inset 8', VIEWPORT.width - (box.x + box.width), FAB.inset);
  check('S1', 'fab bottom inset 8', VIEWPORT.height - (box.y + box.height), FAB.inset);
  const fabRadius = await fab(page).evaluate((el) => getComputedStyle(el).borderRadius);
  // rounded-full computes to 50% serialized as a huge px value (browser serialization shape): >= half the width counts as a perfect circle
  check('S1', 'fab round (radius >= half size)', fabRadius, (r) => Number.parseFloat(r) >= FAB.size / 2);
  await shot(page, '01-board-fab-closed.png');

  // ---- S2 window-open geometry/skin (D2 Multica original values) + S2b FAB exclusion (D4) ----
  await openWindow(page);
  box = await windowBox(page);
  check('S2', 'window 380x600', { w: box.width, h: box.height }, { w: WIN.w, h: WIN.h });
  check('S2', 'window right inset 8', VIEWPORT.width - (box.x + box.width), WIN.inset);
  check('S2', 'window bottom inset 8', VIEWPORT.height - (box.y + box.height), WIN.inset);
  const skin = await win(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      position: cs.position,
      radius: cs.borderRadius,
      z: cs.zIndex,
      shadow: cs.boxShadow,
      bg: cs.backgroundColor,
      backdrop: cs.backdropFilter,
    };
  });
  check('S2', 'window position fixed（角落锚定，D10）', skin.position, 'fixed');
  check('S2', 'window radius 12px（D2）', skin.radius, '12px');
  check('S2', 'window z = --z-floating 15（D10 新 rung）', skin.z, '15');
  check(
    'S2',
    'window shadow = edge-ring + floating-shadow 双层（D2）',
    skin.shadow,
    (s) => s.includes('inset') && s.split(/,(?![^(]*\))/).length >= 3,
  );
  check('S2', 'window bg 不透明非玻璃（D2）', { bg: skin.bg, backdrop: skin.backdrop }, (v) => {
    // rgb( with three components = opaque; only rgba( with four components needs an alpha check
    const m = /^rgba?\(([^)]+)\)$/.exec(v.bg);
    if (m == null) return false;
    const parts = m[1].split(',').map((s) => Number.parseFloat(s.trim()));
    const opaque = parts.length === 3 || parts[3] === 1;
    return opaque && (v.backdrop === 'none' || v.backdrop === '');
  });
  check('S2b', 'FAB hidden while window open (D4 exclusion)', await fab(page).isVisible(), false);

  // ---- S3 no sidebar overlap (D2 containing block = the content area right of the sidebar) ----
  const sidebar = await page.locator('.board-sidebar').boundingBox();
  check('S3', 'window never overlaps sidebar', box.x >= sidebar.x + sidebar.width, true);
  await shot(page, '02-board-window-open.png');

  // ---- S13 z-order law (#688: the active face always stacks above the resident window) ----
  // Carrier note: the floating window is itself a Base UI Dialog (an aside with
  // role=dialog) — locate the new-task dialog as "the role=dialog that is not
  // .chief-drawer".
  const taskDialog = page.locator('[role="dialog"]:not(.chief-drawer)').first();
  await page.evaluate(() => document.activeElement?.blur()); // C is a bare key: leave the composer first (input-state guard law)
  await page.keyboard.press('c'); // new-task dialog (C bare key, board-global)
  await taskDialog.waitFor({ state: 'visible' });
  const dialogZ = await taskDialog.evaluate((el) => {
    let node = el;
    let z = 0;
    while (node != null && node !== document.body) {
      const cs = getComputedStyle(node);
      if (cs.zIndex !== 'auto') z = Math.max(z, Number.parseInt(cs.zIndex, 10));
      node = node.parentElement;
    }
    return z;
  });
  check('S13', 'new-task dialog z (panel-low 21 ladder) > window z (15)', dialogZ > 15, true);
  await shot(page, '03-board-dialog-over-window.png');
  await page.keyboard.press('Escape');
  await taskDialog.waitFor({ state: 'hidden' });
  check('S13b', 'window survives the dialog Esc（D3：Esc 只收它自己的层）', await win(page).isVisible(), true);

  // ---- S4 minimize (D3/D6: Minus button, no X; closed = in the DOM but hidden/inert) ----
  const minimize = win(page).getByRole('button', { name: '最小化' });
  check('S4', 'Minimize 钮在位（无 X：关闭 aria 钮不存在）', {
    minimize: await minimize.isVisible(),
    closeX: await win(page).getByRole('button', { name: '关闭' }).count(),
  }, { minimize: true, closeX: 0 });
  await minimize.click();
  await win(page).waitFor({ state: 'hidden' });
  check('S4', 'minimized window stays in DOM（D6 常驻，count=1）', await win(page).count(), 1);
  check('S4', 'minimized window hidden from a11y tree', await win(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    return el.hasAttribute('hidden') || cs.display === 'none' || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert');
  }), true);
  check('S4', 'FAB back after minimize（互斥反转）', await fab(page).isVisible(), true);
  await shot(page, '04-board-minimized.png');

  // ---- S5 Escape never closes (D3) + ⌘J toggle (#468 retained) ----
  await page.keyboard.press('Meta+j');
  await settleWindow(page);
  check('S5', '⌘J opens', await win(page).isVisible(), true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400); // headroom for the exit animation (--dur-overlay 200ms)
  check('S5', 'Escape never closes the window（D3）', await win(page).isVisible(), true);
  await page.keyboard.press('Meta+j');
  await win(page).waitFor({ state: 'hidden' });
  check('S5', '⌘J toggles shut (minimize semantics)', await fab(page).isVisible(), true);

  // ---- S6 draft retention (D6: minimize does not destroy) ----
  await openWindow(page);
  const composer = page.getByTestId('chief-composer-input');
  await composer.fill('draft-probe-a0');
  await win(page).getByRole('button', { name: '最小化' }).click();
  await win(page).waitFor({ state: 'hidden' });
  await openWindow(page);
  check('S6', 'draft survives minimize', await composer.inputValue(), 'draft-probe-a0');

  // ---- S7 resident across routes (D6: no remount on route switch, window and draft both survive) ----
  await page.getByRole('link', { name: '定时', exact: true }).first().click();
  await page.waitForURL('**/app/schedules**');
  check('S7', 'window still open after route switch', await win(page).isVisible(), true);
  check('S7', 'draft survives route switch', await composer.inputValue(), 'draft-probe-a0');
  await shot(page, '05-schedules-window-open.png');

  // ---- S8 yield retirement (D1: window open/close does not change the content column width) + four shell configs ----
  const shells = [
    { name: 'schedules', url: '/app/schedules?scenario=r3-93', col: '.page-main-col', shot: '06-schedules-shell.png' },
    { name: 'skills', url: '/app/resources/skills', col: '.res-main-col', shot: '07-skills-shell.png' },
    { name: 'team', url: '/app/team', col: '.secondary-main-col', shot: '08-team-shell.png' },
  ];
  for (const s of shells) {
    await gotoClean(page, `${BASE}${s.url}`);
    const col = page.locator(s.col).first();
    await col.waitFor({ state: 'visible' });
    const before = await col.boundingBox();
    await openWindow(page);
    const after = await col.boundingBox();
    check('S8', `${s.name}: content column width unchanged (no yield)`, { before: before.width, after: after.width }, (v) => v.before === v.after);
    const wbox = await windowBox(page);
    check('S8', `${s.name}: window geometry 380x600@8`, { w: wbox.width, h: wbox.height, right: VIEWPORT.width - (wbox.x + wbox.width), bottom: VIEWPORT.height - (wbox.y + wbox.height) }, { w: 380, h: 600, right: 8, bottom: 8 });
    await shot(page, s.shot);
  }

  // ---- S8b board column widths (#1035: the two states retire with yield retirement → single state, zero drift) ----
  await gotoClean(page, `${BASE}/app`);
  const scroller = page.getByTestId('board-scroller');
  const trackWidths = () =>
    scroller.evaluate((el) =>
      getComputedStyle(el).gridTemplateColumns.split(' ').map((v) => Math.round(Number.parseFloat(v))),
    );
  const colsBefore = await trackWidths();
  await openWindow(page);
  const colsAfter = await trackWidths();
  check('S8b', 'board column tracks identical with window open (yield retired)', { colsBefore, colsAfter }, (v) => JSON.stringify(v.colsBefore) === JSON.stringify(v.colsAfter));

  // ---- S8e detail: RightPane coexists with the window (D7 inversion of mutual exclusion) + unreadOnly FAB (#443) ----
  await page.goto(`${BASE}/app/todo/16?scenario=detail-unread`, { waitUntil: 'networkidle' });
  await fab(page).waitFor({ state: 'visible' });
  const fabBadge = await page.locator('.fab-badge').textContent().catch(() => null);
  check('S8e', 'detail FAB gated on unread, badge = 3 (#443 retained)', fabBadge?.trim(), '3');
  await openWindow(page);
  check('S8e', 'detail RightPane coexists with open window (exclusion retired)', await page.locator('.detail-right').isVisible(), true);
  const dbox = await windowBox(page);
  check('S8e', 'detail window geometry 380x600@8', { w: dbox.width, h: dbox.height }, { w: 380, h: 600 });
  await shot(page, '09-detail-window-rightpane.png');

  // ---- S9 fixture capture shape (scenario view=drawer opens itself with zero clicks) ----
  // 111 = chiefReady (hero examples face); 114 = chiefThread (thread message-stream face).
  await page.goto(`${BASE}/app?scenario=111`, { waitUntil: 'networkidle' });
  await settleWindow(page);
  const fbox = await windowBox(page);
  check('S9', 'fixture capture shape: window open from scenario, 380x600', { w: fbox.width, h: fbox.height }, { w: 380, h: 600 });
  check('S9', 'fixture 111 hero examples carrier present', await page.getByTestId('chief-examples').isVisible(), true);
  await shot(page, '10-fixture-111-hero.png');
  await page.goto(`${BASE}/app?scenario=114`, { waitUntil: 'networkidle' });
  await settleWindow(page);
  check('S9', 'fixture 114 stream carrier present', await page.getByTestId('chief-stream').isVisible(), true);
  const tbox = await windowBox(page);
  check('S9', 'fixture 114 window geometry 380x600', { w: tbox.width, h: tbox.height }, { w: 380, h: 600 });
  await shot(page, '10b-fixture-114-thread.png');

  // ---- S10 suppressed routes (coverage = current state: agent-detail / machine-authorize have no chief face) ----
  for (const url of ['/app/resources/agents/r3-builder?scenario=agent-detail', '/app/machines/authorize']) {
    await gotoClean(page, `${BASE}${url}`);
    await page.waitForTimeout(200);
    check('S10', `${url}: no FAB, no window`, { fab: await page.locator('.chief-fab').count(), win: await win(page).count() }, { fab: 0, win: 0 });
  }
  await shot(page, '11-agent-detail-suppressed.png');

  // ---- S11 open-state persistence, two-face semantics (D5 live face persists + default closed; F5 fixture face zero read/write) ----
  // Live face (a bare URL on preview is live mode, the API answers empty — the mode.ts gate fact):
  await gotoClean(page, `${BASE}/app`);
  check('S11', 'live face default = closed（never pops uninvited）', {
    fab: await fab(page).isVisible(),
    winVisible: await win(page).isVisible(),
  }, { fab: true, winVisible: false });
  await openWindow(page);
  check('S11', 'live face writes pacman.chief-open=1 on open', await storedOpen(page), '1');
  await shot(page, '13-live-window-open.png');
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' });
  await settleWindow(page);
  check('S11', 'reload restores the persisted open state (D5, 0004 D9 inversion)', await win(page).isVisible(), true);
  await win(page).getByRole('button', { name: '最小化' }).click();
  await win(page).waitFor({ state: 'hidden' });
  check('S11', 'minimize writes pacman.chief-open=0', await storedOpen(page), '0');
  // Fixture face (?scenario=) zero read/write — collection determinism:
  await page.evaluate(() => localStorage.removeItem('pacman.chief-open'));
  await page.goto(`${BASE}/app?scenario=111`, { waitUntil: 'networkidle' });
  await settleWindow(page);
  check('S11', 'fixture face reads nothing: scenario view decides, storage untouched', await storedOpen(page), null);
  await page.goto(`${BASE}/app/schedules?scenario=r3-93`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  check('S11', 'fixture face writes nothing', await storedOpen(page), null);

  // ---- S12 board gear → settings-view content swap (D9 carrier unchanged) ----
  await page.goto(`${BASE}/app?scenario=111`, { waitUntil: 'networkidle' });
  await settleWindow(page);
  await win(page).getByRole('button', { name: '总管设置' }).click();
  await page.getByRole('heading', { name: '总管设置' }).waitFor({ state: 'visible' });
  check('S12', 'gear swaps board content to settings view', await page.getByRole('heading', { name: '总管设置' }).isVisible(), true);
  await win(page).waitFor({ state: 'hidden' }); // wait for the exit animation (--dur-overlay) to finish before hidden settles
  check('S12', 'settings swap closes the window (three states, one value)', await win(page).isVisible(), false);
  await shot(page, '12-board-settings-swap.png');

  await browser.close();
  writeFileSync(
    join(SCRIPT_DIR, 'result-a0-fixture-smoke.json'),
    `${JSON.stringify({ viewport: VIEWPORT, base: BASE, failures, results }, null, 2)}\n`,
  );
  console.log(`\n${failures === 0 ? 'ALL PASS' : `FAILURES: ${failures}`} (${results.length} checks) — result-a0-fixture-smoke.json`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  writeFileSync(join(SCRIPT_DIR, 'result-a0-fixture-smoke.json'), `${JSON.stringify({ error: String(err), failures: failures + 1, results }, null, 2)}\n`);
  process.exit(2);
});
