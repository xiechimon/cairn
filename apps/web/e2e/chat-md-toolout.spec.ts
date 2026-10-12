import { expect, test } from '@playwright/test';

// Issue #469: the chat column renders two things the flat `.chat-para` /
// `.chat-note` path could not — (A) a tool call's stdout as its own
// left-aligned mono block tied to the tool group, and (B) an agent reply's
// block markdown (heading / ordered+unordered nested lists / code fence)
// with inline `.chat-code` chips preserved. Each test pins one failure way
// of the rework:
//   A1 tool output stays collapsed behind the group toggle (not flattened
//      into a centered dim note)
//   A2 expanded output is a standalone block per tool call, verbatim stdout
//   A3 output block is left aligned, mono, normal contrast (not a note)
//   B1 heading renders as a heading element, not literal `##`
//   B2 ordered list renders ordinals; unordered renders bullets
//   B3 nested list items indent past their parent
//   B4 code fence renders as a mono block, no literal ``` leak
//   B5 inline code keeps the existing mono chip
//   B6 no raw markdown syntax survives as literal prose
//
// #945/#910 重钉：detail.css 退役——工具输出 = tool-output testid、note =
// transcript-note、组 toggle = role=button+「工具过程」文案、md 列表项 =
// md-item-ordered / md-item-bullet testid（零 CSS 结构钩转二级载体）、
// 序号 = md-ordinal、围栏 = md-code、标题 = role=heading、agent 文本 =
// agent-text、inline code chip = agent-text 域内 <code> 元素（一级元素
// 载体，类名别名残留 DOM 至终账票）。

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=md-toolout';

const toggle = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /工具过程/ });

/** Computed color of a `color: var(--foreground)` probe — the "normal
 *  contrast" reference the tool output must match (and the note's dim
 *  ink must not). */
async function primaryInk(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--foreground)';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
}

test('A1: tool output is collapsed behind the group toggle by default', async ({ page }) => {
  await page.goto(ROUTE);
  // the group renders collapsed — no output block on screen yet
  await expect(page.getByTestId('tool-output')).toHaveCount(0);
  // the stdout must NOT have leaked into a centered dim note either
  await expect(page.getByTestId('transcript-note').filter({ hasText: 'total 16' })).toHaveCount(0);
  await expect(
    page.getByTestId('transcript-note').filter({ hasText: 'hello from pacman' }),
  ).toHaveCount(0);
  // the collapsible tool group toggle (完成 Ns ▸ row) is present
  await expect(toggle(page)).toBeVisible();
});

test('A2: expanding the group reveals one disclosure row per call; each output opens from its own row', async ({ page }) => {
  await page.goto(ROUTE);
  await toggle(page).click();
  // 2026-10-12 dsh 对齐（#1268 批）：组展开后 = 逐调用 disclosure 行
  // （dsh GenericCommandCard 同族），输出块不再整组平铺——每行的输出
  // 由该行自己的 chevron 展开。
  const rows = page.getByTestId('tool-pill');
  await expect(rows).toHaveCount(2);
  await rows.nth(0).click();
  await rows.nth(1).click();
  const outputs = page.getByTestId('tool-output');
  await expect(outputs).toHaveCount(2);
  // verbatim stdout, whitespace preserved
  await expect(outputs.nth(0)).toContainText('total 16');
  await expect(outputs.nth(0)).toContainText('drwxr-xr-x@ 4 xmon  staff');
  await expect(outputs.nth(1)).toContainText('hello from pacman');
});

test('A3: the output block is left aligned, mono, normal contrast — not a chat-note', async ({
  page,
}) => {
  await page.goto(ROUTE);
  await toggle(page).click();
  // 逐调用 disclosure 行（2026-10-12 dsh 对齐）：输出块由所在行展开。
  await page.getByTestId('tool-pill').first().click();
  const ink = await primaryInk(page);
  const box = await page.getByTestId('tool-output').first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      textAlign: cs.textAlign,
      fontFamily: cs.fontFamily,
      color: cs.color,
      inNote: el.closest('[data-testid="transcript-note"]') !== null,
    };
  });
  expect(box.textAlign === 'left' || box.textAlign === 'start').toBe(true);
  expect(box.fontFamily.toLowerCase()).toContain('mono');
  expect(box.color).toBe(ink);
  expect(box.inNote).toBe(false);
});

test('B1: a markdown heading renders as a heading element, not literal ##', async ({ page }) => {
  await page.goto(ROUTE);
  const head = page.getByTestId('agent-text').getByRole('heading').first();
  await expect(head).toBeVisible();
  await expect(head).toContainText('检查结果');
  // `##` maps to an <h2>
  expect(await head.evaluate((el) => el.tagName)).toBe('H2');
  // the raw marker never survives as text
  await expect(
    page.getByTestId('agent-text').filter({ hasText: '## 检查结果' }),
  ).toHaveCount(0);
});

test('B2: ordered list renders ordinals and unordered list renders bullets', async ({ page }) => {
  await page.goto(ROUTE);
  const ordered = page.getByTestId('md-item-ordered');
  await expect(ordered).toHaveCount(2);
  await expect(ordered.first()).toContainText('第一步：确认目录');
  await expect(ordered.nth(1)).toContainText('第二步：打印问候');
  // the ordinal marker is rendered, not the literal `1.` from source
  await expect(ordered.first().getByTestId('md-ordinal')).toContainText('1.');

  const bullets = page.getByTestId('md-item-bullet');
  // 子项 A / 子项 B (nested under step 1) + 顶层要点 + 嵌套要点
  await expect(bullets).toHaveCount(4);
  await expect(page.getByTestId('md-item-bullet').filter({ hasText: '顶层要点' })).toHaveCount(1);
});

test('B3: nested list items indent past their parent', async ({ page }) => {
  await page.goto(ROUTE);
  const parentLeft = await page
    .getByTestId('md-item-ordered')
    .filter({ hasText: '第一步' })
    .first()
    .evaluate((el) => el.getBoundingClientRect().left);
  const nestedLeft = await page
    .getByTestId('md-item-bullet')
    .filter({ hasText: '子项 A' })
    .first()
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(nestedLeft).toBeGreaterThan(parentLeft);
});

test('B4: a code fence renders as a mono block with no literal ``` leak', async ({ page }) => {
  await page.goto(ROUTE);
  const code = page.getByTestId('md-code').first();
  await expect(code).toBeVisible();
  await expect(code).toContainText('total 16');
  await expect(code).toContainText('drwxr-xr-x  4 xmon  staff  128');
  const family = await code.evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
  expect(family).toContain('mono');
  // the fence markers are syntax, never content
  await expect(page.getByTestId('agent-text').filter({ hasText: '```' })).toHaveCount(0);
});

test('B5: inline code keeps the existing mono chip', async ({ page }) => {
  await page.goto(ROUTE);
  const chip = page.getByTestId('agent-text').locator('code', { hasText: 'ls -la' });
  await expect(chip).toHaveCount(1);
  const family = await chip.first().evaluate((el) => getComputedStyle(el).fontFamily.toLowerCase());
  expect(family).toContain('mono');
});

test('B6: no raw markdown syntax survives as literal prose', async ({ page }) => {
  await page.goto(ROUTE);
  const text = page.getByTestId('agent-text').first();
  await expect(text).not.toContainText('## 检查结果');
  await expect(text).not.toContainText('1. 第一步');
  await expect(text).not.toContainText('- 顶层要点');
});
