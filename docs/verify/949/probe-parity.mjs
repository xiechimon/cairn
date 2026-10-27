#!/usr/bin/env node
// #949 overlays/ equivalence-migration parity probe: collects computed-style
// and geometry ground truth for three faces (⌘K search panel / chip popover /
// plan dropdown) on the same fixture-stack shape, once before (origin/main) and
// once after (migration branch), and diffs out the equivalent faces from the
// expected-drift faces (chip mini 14px → StatusChip sm 16px is the spec/22 §5.2
// canon growth, not a regression). Selector policy: this script is a mechanism
// probe (not an e2e pin), so class/data-slot locating is allowed — when the old
// class names disappear after the migration, the script switches carrier in the
// after version.
//
// Usage (run from the repo root; @playwright/test resolves in-tree):
//   node docs/verify/949/probe-parity.mjs --url http://localhost:8405 --out /tmp/probe-949-before.json
// Exit code: 0 = collection done (the values themselves carry no assertions; a human reviews the diff).

import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const argOf = (name) => args[args.indexOf(name) + 1];
const BASE = argOf('--url') ?? 'http://localhost:8405';
const OUT = argOf('--out') ?? '/tmp/probe-parity.json';
// The e2e pin condition is dark (playwright.config colorScheme:'dark') —
// parity collects both themes: --scheme dark|light (default light, matching the
// first collection round).
const SCHEME = args.includes('--scheme') ? argOf('--scheme') : 'light';
// On the after stack the old class names are retired: the carrier selectors
// switch via --carrier after (the equivalence judgment face is the computed
// value, not the selector itself).
const AFTER = args.includes('--carrier') && argOf('--carrier') === 'after';

const BOARD = `${BASE}/app?scenario=01`;
const DETAIL19 = `${BASE}/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=19`;
const DETAIL27 = `${BASE}/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27`;

/** Selector group for panel/rows/popover — before uses class names, after uses semantic/data carriers. */
const SEL = AFTER
  ? {
      panel: '[role="dialog"][aria-label="搜索"]',
      inputRowInput: '[role="dialog"][aria-label="搜索"] input',
      // Structural locating (probe-only, not the spec carrier): panel children =
      // input row + list; result-row children = four spans icon/main/time/chip;
      // popover children = head/title/divider/section×2/divider/button.
      inputRow: '[role="dialog"][aria-label="搜索"] > div:nth-of-type(1)',
      navRow: '[role="dialog"][aria-label="搜索"] [data-row-kind="nav"]',
      todoRow: '[role="dialog"][aria-label="搜索"] [data-row-kind="todo"]',
      chip: '[role="dialog"][aria-label="搜索"] [data-row-kind="todo"] [data-tone]',
      rowTime: '[role="dialog"][aria-label="搜索"] [data-row-kind="todo"] > span:nth-of-type(3)',
      rowTitle:
        '[role="dialog"][aria-label="搜索"] [data-row-kind="todo"] > span:nth-of-type(2) > span:nth-of-type(1)',
      rowSub:
        '[role="dialog"][aria-label="搜索"] [data-row-kind="todo"] > span:nth-of-type(2) > span:nth-of-type(2)',
      rowIcon: '[role="dialog"][aria-label="搜索"] [data-row-kind="todo"] > span:nth-of-type(1)',
      empty: '[role="dialog"][aria-label="搜索"] > div:nth-of-type(2)',
      popover: '[role="dialog"][aria-label="任务分配"]',
      popHead: '[role="dialog"][aria-label="任务分配"] > div:nth-of-type(1)',
      popAvatar: '[role="dialog"][aria-label="任务分配"] > div:nth-of-type(1) > span:nth-of-type(1)',
      popProject: '[role="dialog"][aria-label="任务分配"] > div:nth-of-type(1) > span:nth-of-type(2)',
      popSeq: '[role="dialog"][aria-label="任务分配"] > div:nth-of-type(1) > span:nth-of-type(3)',
      popTitle: '[role="dialog"][aria-label="任务分配"] > div:nth-of-type(2)',
      popDivider: '[role="dialog"][aria-label="任务分配"] > div:nth-of-type(3)',
      popSectionSel: '[role="dialog"][aria-label="任务分配"] [data-selected]',
      popLabel: '[role="dialog"][aria-label="任务分配"] > div:nth-of-type(4) > div:nth-of-type(1)',
      popRowOwner: '[role="dialog"][aria-label="任务分配"] > div:nth-of-type(4) > div:nth-of-type(2)',
      popRowAgent: '[role="dialog"][aria-label="任务分配"] [data-selected] > div:nth-of-type(2)',
      popCheck:
        '[role="dialog"][aria-label="任务分配"] [data-selected] > div:nth-of-type(2) > span:last-of-type',
      popEdit: '[role="dialog"][aria-label="任务分配"] > button',
      chipWrap: '[data-testid="chip-chevron"]', // special case: the probe takes parentElement²
      chevron: '[data-testid="chip-chevron"]',
      menuContent: '[role="menu"][aria-label="面板视图"]',
      menuRow: '[role="menuitemradio"]',
      menuIndicator: '[data-slot="dropdown-menu-radio-item-indicator"]',
      docSelect: '.doc-select-wrap .doc-pane-select',
      pill: '[aria-current="page"]',
    }
  : {
      panel: '.search-panel',
      inputRowInput: '.search-input-row input',
      inputRow: '.search-input-row',
      navRow: '.search-panel .search-row',
      todoRow: '.search-row--todo',
      chip: '.search-row-chip',
      rowTime: '.search-row-time',
      rowTitle: '.search-row-title',
      rowSub: '.search-row-sub',
      rowIcon: '.search-row-icon',
      empty: '.search-empty',
      popover: '.chip-popover',
      popHead: '.chip-popover-head',
      popAvatar: '.chip-popover-avatar',
      popProject: '.chip-popover-project',
      popSeq: '.chip-popover-seq',
      popTitle: '.chip-popover-title',
      popDivider: '.chip-popover-divider',
      popSectionSel: '.chip-popover-section--selected',
      popLabel: '.chip-popover-label',
      popRowOwner: '.chip-popover-section:not(.chip-popover-section--selected) .chip-popover-row',
      popRowAgent: '.chip-popover-section--selected .chip-popover-row',
      popCheck: '.chip-popover-check',
      popEdit: '.chip-popover-edit',
      chipWrap: '.detail-chipwrap',
      chevron: '.detail-chip-chevron',
      menuContent: '.plan-dropdown',
      menuRow: '.plan-dropdown-row',
      menuIndicator: '.plan-dropdown [data-slot="dropdown-menu-radio-item-indicator"]',
      docSelect: '.doc-select-wrap .doc-pane-select',
      pill: '.sidebar-row--selected',
    };

const out = {};

const cs = (page, selector, props, pseudo = '') =>
  page.evaluate(
    ({ selector, props, pseudo }) => {
      const el = document.querySelector(selector);
      if (el == null) return { MISSING: selector };
      const style = getComputedStyle(el, pseudo || null);
      const values = {};
      for (const p of props) values[p] = style[p];
      return values;
    },
    { selector, props, pseudo },
  );

const box = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el == null) return { MISSING: sel };
    const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  }, selector);

const hoverBg = async (page, selector, settleMs = 250) => {
  const loc = page.locator(selector).first();
  await loc.hover();
  await page.waitForTimeout(settleMs);
  return loc.evaluate((el) => getComputedStyle(el).backgroundColor);
};

async function openPanel(page) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Meta+k');
    const opened = await page
      .locator(SEL.panel)
      .waitFor({ state: 'visible', timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  throw new Error('panel never opened');
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 732 },
  colorScheme: SCHEME,
});
const page = await context.newPage();

// —— Face S: ⌘K search panel (board scenario 01) —————————————————————————
await page.goto(BOARD);
await page.locator('.sidebar-row, .rail-row').first().waitFor({ state: 'visible', timeout: 15000 });
// Sidebar always-lit pill (before: class carrier; after: aria-current) — the resting state with the panel closed
out.pillRest = {
  before: await cs(page, SEL.pill, ['backgroundColor', 'color'], '::before'),
  row: await cs(page, SEL.pill, ['color']),
};
await openPanel(page);
await page.waitForTimeout(400); // let the entry settle
out.panel = {
  box: await box(page, SEL.panel),
  style: await cs(page, SEL.panel, [
    'backgroundColor', 'borderRadius', 'boxShadow', 'transformOrigin', 'zIndex',
    'position', 'top', 'left', 'width', 'height', 'transform', 'scale',
    'transitionProperty', 'transitionDuration', 'transitionTimingFunction',
    'display', 'flexDirection', 'overflow',
  ]),
};
out.pillDimmed = {
  before: await cs(page, SEL.pill, ['backgroundColor', 'color'], '::before'),
  row: await cs(page, SEL.pill, ['color']),
  rootMarker: await page.evaluate(() => 'searchOpen' in document.documentElement.dataset),
};
out.scrim = await page.evaluate(() => {
  const el = document.elementFromPoint(20, 20);
  if (el == null) return { MISSING: 'scrim' };
  const s = getComputedStyle(el);
  return { backgroundColor: s.backgroundColor, zIndex: s.zIndex, position: s.position, tag: el.tagName };
});
out.inputRow = {
  box: await box(page, SEL.inputRow),
  style: await cs(page, SEL.inputRow, [
    'height', 'borderBottomWidth', 'borderBottomColor', 'color', 'paddingLeft',
    'paddingRight', 'gap', 'display', 'alignItems', 'flex',
  ]),
};
const navRow0 = page.locator(SEL.navRow).first();
out.navRowRest = {
  box: await box(page, `${SEL.navRow}`),
  style: await cs(page, SEL.navRow, [
    'backgroundColor', 'color', 'fontSize', 'lineHeight', 'height', 'borderRadius',
    'paddingLeft', 'paddingRight', 'gap', 'margin', 'width', 'borderStyle',
    'textAlign', 'cursor', 'transitionProperty', 'transitionDuration', 'whiteSpace', 'fontWeight',
  ]),
};
out.navRowHover = await hoverBg(page, SEL.navRow);
// Keyboard cursor takeover: ArrowDown → row0 selected; hovering row1 must not highlight it in kbd state
await page.locator(SEL.inputRowInput).focus();
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(120);
out.kbdSelected = {
  row0: await cs(page, `${SEL.navRow}`, ['backgroundColor']),
  panelDataKbd: await page.evaluate(
    (sel) => document.querySelector(sel)?.hasAttribute('data-kbd') ?? null,
    SEL.panel,
  ),
  selectedCarrier: AFTER
    ? await page.evaluate(
        (sel) => document.querySelector(sel)?.hasAttribute('data-selected') ?? null,
        SEL.navRow,
      )
    : await page.evaluate(
        (sel) => document.querySelector(sel)?.className.includes('search-row--selected') ?? null,
        SEL.navRow,
      ),
};
out.kbdHoverSuppressed = await hoverBg(page, `${SEL.navRow}:nth-of-type(2)`);
// Result rows (the fixture probe-task pair)
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await openPanel(page);
await page.keyboard.type('r3 lifecycle probe');
await page.locator(SEL.todoRow).first().waitFor({ state: 'visible', timeout: 5000 });
await page.waitForTimeout(200);
out.todoRow = {
  box: await box(page, SEL.todoRow),
  style: await cs(page, SEL.todoRow, ['gap', 'paddingLeft', 'height', 'backgroundColor', 'color']),
};
out.chip = {
  box: await box(page, SEL.chip),
  style: await cs(page, SEL.chip, [
    'backgroundColor', 'color', 'fontSize', 'height', 'borderRadius',
    'paddingLeft', 'paddingRight', 'fontWeight', 'marginLeft', 'flex',
  ]),
};
out.rowTime = await cs(page, SEL.rowTime, ['color', 'fontSize', 'lineHeight']);
out.rowTitle = await cs(page, SEL.rowTitle, ['color', 'fontSize', 'lineHeight']);
out.rowSub = await cs(page, SEL.rowSub, ['color', 'fontSize', 'lineHeight']);
out.rowIcon = {
  box: await box(page, SEL.rowIcon),
  style: await cs(page, SEL.rowIcon, ['backgroundColor', 'color', 'borderRadius']),
};
out.todoRowHover = await hoverBg(page, SEL.todoRow);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
out.pillRestored = { before: await cs(page, SEL.pill, ['backgroundColor'], '::before') };

// —— Face P: chip popover (detail scenario 19, frozen open) ————————————————————
await page.goto(DETAIL19);
await page.locator(SEL.popover).waitFor({ state: 'visible', timeout: 15000 });
await page.waitForTimeout(300);
out.popover = {
  box: await box(page, SEL.popover),
  style: await cs(page, SEL.popover, [
    'position', 'left', 'top', 'width', 'height', 'backgroundColor', 'borderTopWidth',
    'borderTopColor', 'borderTopStyle', 'borderRadius', 'boxShadow', 'padding',
    'zIndex', 'transformOrigin', 'textAlign', 'display', 'flexDirection',
  ]),
  arrow: await cs(page, SEL.popover, ['clipPath', 'backgroundColor', 'width', 'height', 'top', 'left'], '::before'),
};
out.chipWrap = AFTER
  ? await page.evaluate((sel) => {
      const wrap = document.querySelector(sel)?.parentElement?.parentElement;
      if (wrap == null) return { MISSING: 'chipWrap' };
      const s = getComputedStyle(wrap);
      return { position: s.position, display: s.display, alignItems: s.alignItems };
    }, SEL.chipWrap)
  : await cs(page, SEL.chipWrap, ['position', 'display', 'alignItems']);
out.chevron = {
  box: await box(page, SEL.chevron),
  style: await cs(page, SEL.chevron, ['color', 'marginLeft', 'display', 'flex']),
};
out.popHead = {
  style: await cs(page, SEL.popHead, ['display', 'gap', 'paddingTop', 'alignItems']),
};
out.popAvatar = {
  box: await box(page, SEL.popAvatar),
  style: await cs(page, SEL.popAvatar, ['backgroundColor', 'color', 'fontSize', 'borderRadius', 'fontWeight']),
};
out.popProject = await cs(page, SEL.popProject, ['color', 'fontSize', 'lineHeight']);
out.popSeq = await cs(page, SEL.popSeq, ['color', 'fontSize', 'lineHeight']);
out.popTitle = {
  style: await cs(page, SEL.popTitle, ['padding', 'fontSize', 'lineHeight', 'color']),
};
out.popDivider = {
  box: await box(page, SEL.popDivider),
  style: await cs(page, SEL.popDivider, ['backgroundColor', 'height']),
};
out.popSectionSel = await cs(page, SEL.popSectionSel, ['backgroundColor', 'paddingTop']);
out.popLabel = await cs(page, SEL.popLabel, ['fontSize', 'lineHeight', 'fontWeight', 'color', 'padding']);
out.popRow = {
  box: await box(page, SEL.popRowOwner),
  style: await cs(page, SEL.popRowOwner, ['height', 'gap', 'paddingRight', 'fontSize', 'lineHeight', 'color', 'display', 'alignItems']),
  img: await cs(page, `${SEL.popRowOwner} img`, ['width', 'height', 'borderRadius']),
};
out.popRowHover = await hoverBg(page, SEL.popRowOwner);
out.popCheck = await cs(page, SEL.popCheck, ['color', 'marginLeft', 'display']);
out.popEdit = {
  box: await box(page, SEL.popEdit),
  rest: await cs(page, SEL.popEdit, [
    'backgroundColor', 'color', 'fontSize', 'lineHeight', 'gap', 'padding',
    'borderStyle', 'display', 'alignItems', 'flex', 'textAlign', 'cursor', 'fontWeight',
  ]),
};
out.popEditHover = {
  bg: await hoverBg(page, SEL.popEdit),
  color: await cs(page, SEL.popEdit, ['color']),
};
out.catcher = await page.evaluate(() => {
  const el = document.elementFromPoint(400, 600);
  if (el == null) return { MISSING: 'catcher' };
  const s = getComputedStyle(el);
  return {
    tag: el.tagName, zIndex: s.zIndex, position: s.position, backgroundColor: s.backgroundColor,
    cursor: s.cursor, tabIndex: el.tabIndex, ariaHidden: el.getAttribute('aria-hidden'),
  };
});

// —— Face D: plan dropdown (detail scenario 27) ————————————————————————————
await page.goto(DETAIL27);
await page.locator(SEL.docSelect).first().waitFor({ state: 'visible', timeout: 15000 });
await page.locator(SEL.docSelect).first().click();
await page.locator(SEL.menuContent).waitFor({ state: 'visible', timeout: 5000 });
await page.waitForTimeout(300);
out.menuContent = {
  box: await box(page, SEL.menuContent),
  style: await cs(page, SEL.menuContent, [
    'backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderTopStyle', 'borderRadius',
    'boxShadow', 'padding', 'minWidth', 'width', 'position', 'transformOrigin', 'display',
    'flexDirection',
  ]),
  arrow: await cs(page, SEL.menuContent, ['clipPath', 'backgroundColor', 'width', 'height', 'top', 'right'], '::before'),
  positionerZ: await page.evaluate(
    (sel) => getComputedStyle(document.querySelector(sel)?.parentElement ?? document.body).zIndex,
    SEL.menuContent,
  ),
};
out.menuRowChecked = {
  box: await box(page, SEL.menuRow),
  style: await cs(page, SEL.menuRow, [
    'height', 'paddingLeft', 'paddingRight', 'borderRadius', 'fontSize', 'lineHeight',
    'color', 'backgroundColor', 'width', 'textAlign', 'cursor', 'display', 'alignItems',
  ]),
};
out.menuIndicator = await cs(page, SEL.menuIndicator, ['color']);
// Keyboard focus row (Base UI roving focus: ArrowDown moves focus once the face is open)
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(150);
out.menuRowFocus = await cs(page, SEL.menuRow, ['outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset', 'backgroundColor']);
// Hover highlight faces (unselected row + selected row)
const rows = page.locator(SEL.menuRow);
const rowCount = await rows.count();
out.menuRowHoverUnchecked = await hoverBg(page, `${SEL.menuRow}:nth-child(${rowCount})`);
out.menuRowHoverChecked = await hoverBg(page, SEL.menuRow);

await browser.close();
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`probe dump written: ${OUT} (${Object.keys(out).length} faces)`);
