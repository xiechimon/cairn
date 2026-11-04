#!/usr/bin/env node
// verify probe — configuration smoke + interaction-contract pins for the
// #1009 A1 prototype (chat-primitive fitting: the chief message stream refitted
// with the shadcn MessageScroller / Message / Bubble / Marker five-piece set),
// fixture face.
//
// How to run (fixture stack must already be up):
//   cd apps/web && pnpm exec vite build --mode fixture
//   pnpm exec vite preview --host 127.0.0.1 --port ${E2E_PORT:-8403} --strictPort &
//   E2E_PORT=8403 node docs/verify/1009/drive-1009-a1-smoke.mjs
//
// Failure-mode-first list (A1 face enumeration, one assertion group per line):
//  F1 structural flip breaks the carrier: chief-body/chief-stream testids must
//     move with the primitives to Viewport/Content (the overflowY:auto face =
//     the carrier pinned by F-R6/R8) → S1
//  F2 neutralization failure: Item's [content-visibility:auto] not pinned back
//     to visible (off-screen rows skip layout, probe/e2e drifts with scroll
//     phase), Content not flipped to block+gap-0 (double row spacing) → S2
//  F3 Bubble skin out of control: user rows must land on the --secondary slot
//     (equal to the old BUBBLE_CLS), zero border (F-R16 44px pill canon),
//     14px/24px rhythm; robot rows ghost-tier bare text (bg transparent, zero
//     padding) → S3
//  F4 Marker face drift: note rows centered 12px, machine-name underline
//     retained → S4
//  F5 hero/gate moved out of the scroll area breaking the face: the 111 face
//     keeps examples in place with zero stream rows, composer draft face #860
//     grow law (120px cap, the XMON-102 fixed track already superseded by #860)
//     → S5
//  F6 scroll-law regressions: opening lands at the bottom
//     (defaultScrollPosition=end) → S6; jump-to-latest float-on-upscroll /
//     click-to-bottom / hide-at-bottom (#991 Q6 carried in with the primitives)
//     → S7; reopen lands at the bottom (display:none loses the scroll position
//     — the criterion inverts, left to a HITL ruling) → S8
//  F7 row-carrier conservation: chief-msg union-selector counts, chief-msg-col/
//     foot/tools, copy/restore button aria faces unchanged (the "behavior
//     semantics do not move" criterion of the re-pin ledger) → S9
//  F8 id-through face: the fixture capture shape has source-less message ids →
//     Item carries no messageId (the live-face id pin belongs to e2e live-mock,
//     the F-R21/#742 face) → S10
//
// Evidence lands in this directory: a1-*.png + result-a1-fixture-smoke.json
// (measured raw values, human-review face).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.E2E_PORT ?? '8403';
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1440, height: 900 };

const results = [];
let failures = 0;
function check(group, name, actual, expected) {
  const ok =
    typeof expected === 'function'
      ? expected(actual)
      : JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  results.push({
    group,
    name,
    actual,
    expected: typeof expected === 'function' ? '(predicate)' : expected,
    ok,
  });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${group}] ${name} — actual=${JSON.stringify(actual)}`);
}

async function shot(page, file) {
  await page.screenshot({ path: join(SCRIPT_DIR, file) });
}

const drawer = (page) => page.locator('.chief-drawer');
const body = (page) => page.getByTestId('chief-body');

/** Entry fade+scale settled predicate (ADR 0013 D7; same as A0) — prerequisite for geometry sampling. */
async function settled(page) {
  await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

mkdirSync(SCRIPT_DIR, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });

// ——— S1/S2/S3/S4/S9/S10: thread capture face (scenario 114, 2 msg + 2 note) ———
await page.goto(`${BASE}/app?scenario=114`);
await settled(page);
check('S1 结构', 'scroller 四件套 data-slot 在位', await page.evaluate(() => ({
  root: document.querySelectorAll('.chief-drawer [data-slot=message-scroller]').length,
  viewport: document.querySelectorAll('[data-slot=message-scroller-viewport]').length,
  content: document.querySelectorAll('[data-slot=message-scroller-content]').length,
  items: document.querySelectorAll('[data-slot=message-scroller-item]').length,
})), { root: 1, viewport: 1, content: 1, items: 4 });
check(
  'S1 结构',
  'chief-body = Viewport（overflowY auto 载体随迁，F-R6/R8）',
  await body(page).evaluate((el) => ({
    slot: el.getAttribute('data-slot'),
    overflowY: getComputedStyle(el).overflowY,
  })),
  { slot: 'message-scroller-viewport', overflowY: 'auto' },
);
check(
  'S1 结构',
  'chief-stream = Content（block 中和，行距留行 margin）',
  await page.getByTestId('chief-stream').evaluate((el) => ({
    slot: el.getAttribute('data-slot'),
    display: getComputedStyle(el).display,
    rowGap: getComputedStyle(el).rowGap,
  })),
  { slot: 'message-scroller-content', display: 'block', rowGap: '0px' },
);
check(
  'S2 中和',
  'Item content-visibility 钉回 visible（探针/e2e 确定性）',
  await page
    .locator('[data-slot=message-scroller-item]')
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).contentVisibility)),
  ['visible', 'visible', 'visible', 'visible'],
);
const bubbleFaces = await page.evaluate(() => {
  const user = document.querySelector('[data-testid=chief-bubble]');
  const robot = document.querySelectorAll('[data-slot=bubble-content]')[1];
  const cs = (el) => getComputedStyle(el);
  const token = getComputedStyle(document.documentElement).getPropertyValue('--secondary').trim();
  return {
    userBg: cs(user).backgroundColor,
    userBorder: cs(user).borderTopWidth,
    userFont: cs(user).fontSize,
    userLeading: cs(user).lineHeight,
    userRadius: cs(user).borderTopLeftRadius,
    userPad: `${cs(user).paddingTop}/${cs(user).paddingLeft}`,
    token,
    robotBg: cs(robot).backgroundColor,
    robotPad: cs(robot).paddingTop,
  };
});
check('S3 Bubble 皮', 'user 行底 = --secondary 槽（原 BUBBLE_CLS 等值）', bubbleFaces.userBg, (v) => {
  // normalize rgb and compare against the token pair (the token is hex)
  const hex = bubbleFaces.token;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return false;
  const want = `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})`;
  return v === want;
});
check('S3 Bubble 皮', 'user 行零边框（F-R16 44px 药丸 canon 前提）', bubbleFaces.userBorder, '0px');
check('S3 Bubble 皮', 'user 行节奏 14px/24px + 10/12 内垫', [
  bubbleFaces.userFont,
  bubbleFaces.userLeading,
  bubbleFaces.userPad,
], ['14px', '24px', '10px/12px']);
check('S3 Bubble 皮', 'robot 行 ghost 档裸文本（bg 透明 + 零 padding）', [
  bubbleFaces.robotBg,
  bubbleFaces.robotPad,
], ['rgba(0, 0, 0, 0)', '0px']);
check(
  'S4 Marker',
  'note 行 = Marker 原语，居中 12px，机器名下划线在位',
  await page.evaluate(() => {
    const ms = [...document.querySelectorAll('[data-slot=marker]')];
    const cs = getComputedStyle(ms[0]);
    return {
      count: ms.length,
      justify: cs.justifyContent,
      font: cs.fontSize,
      underline: document.querySelectorAll('[data-slot=marker] span.underline').length,
    };
  }),
  { count: 2, justify: 'center', font: '12px', underline: 1 },
);
check(
  'S9 载体守恒',
  'chief-msg 联合计数 + col/foot/tools + 复制/恢复钮',
  await page.evaluate(() => ({
    msgs: document.querySelectorAll('.chief-msg, [data-testid=chief-msg]').length,
    cols: document.querySelectorAll('[data-testid=chief-msg-col]').length,
    foot: document.querySelectorAll('[data-testid=chief-msg-foot]').length,
    tools: document.querySelectorAll('[data-testid=chief-msg-tools]').length,
    copy: document.querySelectorAll('[aria-label=复制]').length,
    rewind: document.querySelectorAll('[aria-label=恢复到此处]').length,
  })),
  { msgs: 2, cols: 2, foot: 1, tools: 1, copy: 2, rewind: 1 },
);
check(
  'S10 id 贯通',
  'fixture 捕获形 Item 无 messageId（live 面 id 归 e2e live-mock pin）',
  await page
    .locator('[data-slot=message-scroller-item]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-message-id'))),
  [null, null, null, null],
);
await shot(page, 'a1-01-thread-114.png');

// ——— S6 open-lands-at-bottom + S7 jump-to-latest + S8 D6 scroll retention ———
// Carrier face = chief-md (overflows by 117px): the 114 face overflows only
// 19px < scrollEdgeThreshold 80, the "near bottom" judgment always holds and the
// jump button is never active (the threshold law at work, not a broken link) —
// the jump face must be evidenced on a face whose overflow exceeds the
// threshold. The dicebear stub follows the e2e recipe (guard against external
// network hangs).
await page.route('**/api.dicebear.com/**', (route) =>
  route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#888"/></svg>',
  }),
);
await page.goto(`${BASE}/app?scenario=chief-md`);
await settled(page);
const atBottom = () =>
  body(page).evaluate(
    (el) => Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 4,
  );
check(
  'S6 滚动律',
  '面溢出前提（scrollHeight > clientHeight）',
  await body(page).evaluate((el) => el.scrollHeight - el.clientHeight > 80),
  true,
);
check('S6 滚动律', '打开即落底（defaultScrollPosition=end）', await atBottom(), true);
await body(page).evaluate((el) => el.scrollTo({ top: 0 }));
await page.waitForTimeout(400);
const jump = page.locator('[data-slot=message-scroller-button][data-direction=end]');
check('S7 jump', '上翻后 jump-to-latest 浮出（data-active=true）', await jump.getAttribute('data-active'), 'true');
await shot(page, 'a1-02-jump-button.png');
await jump.click();
await page.waitForTimeout(700);
check('S7 jump', '点击后落底', await atBottom(), true);
check(
  'S7 jump',
  '落底后按钮退场（data-active=false）',
  await jump.getAttribute('data-active'),
  'false',
);
await body(page).evaluate((el) => el.scrollTo({ top: 0 }));
await page.waitForTimeout(300);
await page.getByRole('button', { name: '最小化' }).click();
await page.waitForTimeout(600);
await page.keyboard.press('Meta+j');
await settled(page);
// S8 criterion inversion (the A1 measured ruling point): Base UI keepMounted's
// closed state = the hidden attribute = display:none — the browser discards the
// scroll position, so D6's "scroll survival" is physically unreachable on the
// minimize face (same in the A0 period, just not evidenced then; the Multica
// original shape is opacity + resident inert without display:none, which is what
// truly preserves scroll). The A1 provider lands at
// defaultScrollPosition=end on reopen = the chat-face universal law (consistent
// with the old dock era's "open lands at bottom" behavior) — this check pins
// that factual criterion; "reopen-lands-at-bottom vs true scroll retention
// (needs a resident-inert carrier swap)" is left to a HITL live ruling.
check('S8 重开落底', '最小化重开 = 落底看最新（chat 通行律；滚动位随 display:none 丢弃）', await atBottom(), true);
await shot(page, 'a1-03-reopen-bottom.png');

// ——— S5: hero face (111) ———
await page.goto(`${BASE}/app?scenario=111`);
await settled(page);
check('S5 hero', 'examples 在位、流零行', await page.evaluate(() => ({
  examples: document.querySelectorAll('[data-testid=chief-examples] button').length,
  items: document.querySelectorAll('[data-slot=message-scroller-item]').length,
})), { examples: 4, items: 0 });
check(
  'S5 hero',
  'composer 草稿面 = #860 grow 律顶格（XMON-102 固定轨已被取代；盒内滚动保留）',
  await page.getByTestId('chief-composer-input').evaluate((el) => ({
    h: getComputedStyle(el).height,
    ov: getComputedStyle(el).overflowY,
  })),
  { h: '120px', ov: 'auto' },
);
await shot(page, 'a1-04-hero-111.png');
// S5b: the empty-composer face (114) = the base-track measured values — the
// readings of these two checks are the source of the pinned values for the
// XMON-102 re-pin (grow semantics) (live-review ruling 3: "pin whatever the
// screenshot shows"; the spec comment references the S5/S5b rows of this json
// + the a1-04/a1-01 screenshots).
await page.goto(`${BASE}/app?scenario=114`);
await settled(page);
check(
  'S5b 空面',
  'composer 空草稿面 = 3 行基座轨（读数以本行为准，非理论常数）',
  await page.getByTestId('chief-composer-input').evaluate((el) => ({
    h: getComputedStyle(el).height,
    ov: getComputedStyle(el).overflowY,
  })),
  { h: '60px', ov: 'auto' },
);

await browser.close();
writeFileSync(
  join(SCRIPT_DIR, 'result-a1-fixture-smoke.json'),
  `${JSON.stringify({ viewport: VIEWPORT, results, failures }, null, 2)}\n`,
);
console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES'} — ${results.length - failures}/${results.length}`);
process.exit(failures === 0 ? 0 : 1);
