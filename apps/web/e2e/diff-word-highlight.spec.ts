import { expect, test } from '@playwright/test';

// Issue #1101 acceptance: the review-pane diff view's two defects —
// ① rows painted their add/del bg only to viewport width, so scrolling a
// long line right ran onto bare background; ② no word-level highlight
// inside paired del/add lines.
// 钉死的失败方式:
// 1. 底色仍只画到视口宽 — 每个行盒/hunk 头/文件行的宽度必须等于滚动容器的
//    scrollWidth（hunk 面与「显示完整文件」面同契约）;
// 2. 行号列/hunk 头/文件行没跟着撑宽 → 与行内容错位（同一宽度断言全族覆盖）;
// 3. 配对误触发 — add-only 的 hunk（27b 探针面）必须零词级 span;
// 4. 单词对没高亮或高亮过宽 — del/add 两侧各恰一个 [data-word] span，
//    文本 = 变化词本身;
// 5. 不等长 run 未按 min(m,n) 配对 — 落单 del 行无词级 span;
// 6. marker 行隔断 adjacency（r8 72 形）→ 词级高亮丢失;
// 7. 超限静默降级 — capped 行必须带 data-word="capped" + 非空 title，
//    且内部零词级 span;
// 8. 嵌套 span 吃掉空白 — 行文本 span 的 textContent 与 fixture 逐字节一致;
// 9. 明暗单模缺色 — 词级底色双模非透明且与整行底色可区分;
// 10. plan-diff 面（第二消费面，scenario 72 的真 del/add 对）漏接词级 span。
//
// 载体裁定沿 #945/#910：状态走 data 属性（data-word），皮肤走 token
// utilities，不新增结构类名。

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=diff-word-stress';
const SCROLLER = '[data-testid="doc-pane"] > div.overflow-y-auto';

/** The pane must actually overflow horizontally, else every width pin below
 *  would pass vacuously — this is the anti-false-green guard. */
async function expectHScroll(page: import('@playwright/test').Page): Promise<number> {
  const scroller = page.locator(SCROLLER);
  const scrollWidth = await scroller.evaluate((el) => el.scrollWidth);
  const clientWidth = await scroller.evaluate((el) => el.clientWidth);
  expect(scrollWidth).toBeGreaterThan(clientWidth + 50);
  return scrollWidth;
}

test('长行产生横向滚动,且每个行盒/hunk 头/文件行都撑满滚动宽(hunk 面)', async ({ page }) => {
  await page.goto(ROUTE);
  const scrollWidth = await expectHScroll(page);
  const widths = await page
    .locator(`${SCROLLER} [data-kind]`)
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(widths.length).toBeGreaterThan(0);
  for (const w of widths) {
    expect(w).toBeGreaterThanOrEqual(scrollWidth - 1);
    expect(w).toBeLessThanOrEqual(scrollWidth + 1);
  }
  // hunk 头与文件行同契约——不撑宽就会与行内容错位
  const head = await page.locator('.diff-hunk-head').first().boundingBox();
  expect(head?.width).toBeGreaterThanOrEqual(scrollWidth - 1);
  const fileRow = await page.locator('.doc-file-row').first().boundingBox();
  expect(fileRow?.width).toBeGreaterThanOrEqual(scrollWidth - 1);
});

test('「显示完整文件」面的行同样撑满滚动宽', async ({ page }) => {
  await page.goto(ROUTE);
  await page.getByRole('button', { name: '显示完整文件' }).click();
  const scrollWidth = await expectHScroll(page);
  const widths = await page
    .getByTestId('diff-full')
    .locator('[data-kind]')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(widths.length).toBeGreaterThan(0);
  for (const w of widths) {
    expect(w).toBeGreaterThanOrEqual(scrollWidth - 1);
  }
});

test('单词对只把变化的词标深:两侧各恰一个词级 span,文本=变化词', async ({ page }) => {
  await page.goto(ROUTE);
  const addRow = page.locator('[data-kind="add"]', { hasText: 'timeoutMs = 5000' });
  await expect(addRow.locator('[data-word="add"]')).toHaveCount(1);
  await expect(addRow.locator('[data-word="add"]')).toHaveText('5000');
  const delRow = page.locator('[data-kind="del"]', { hasText: 'timeoutMs = 3000' });
  await expect(delRow.locator('[data-word="del"]')).toHaveCount(1);
  await expect(delRow.locator('[data-word="del"]')).toHaveText('3000');
});

test('不等长 run 按 min(m,n) 配对,落单 del 保持整行高亮零词级 span', async ({ page }) => {
  await page.goto(ROUTE);
  const pairedDel = page.locator('[data-kind="del"]', { hasText: 'keepAlpha' });
  await expect(pairedDel.locator('[data-word="del"]')).toHaveText('true');
  const pairedAdd = page.locator('[data-kind="add"]', { hasText: 'keepAlpha' });
  await expect(pairedAdd.locator('[data-word="add"]')).toHaveText('false');
  const surplusDel = page.locator('[data-kind="del"]', { hasText: 'keepBeta' });
  await expect(surplusDel.locator('[data-word]')).toHaveCount(0);
});

test('marker 行不隔断配对(r8 72 形):长行对照常出词级 span', async ({ page }) => {
  await page.goto(ROUTE);
  const longDel = page.locator('[data-kind="del"]', { hasText: 'renderDashboard' });
  await expect(longDel.locator('[data-word="del"]')).toHaveCount(1);
  await expect(longDel.locator('[data-word="del"]')).toHaveText('100');
  const longAdd = page.locator('[data-kind="add"]', { hasText: 'renderDashboard' });
  await expect(longAdd.locator('[data-word="add"]')).toHaveCount(1);
  await expect(longAdd.locator('[data-word="add"]')).toHaveText('200');
});

test('超限对退回整行高亮且不静默:data-word=capped + 非空 title,零词级 span', async ({ page }) => {
  await page.goto(ROUTE);
  for (const kind of ['add', 'del'] as const) {
    const row = page.locator(`[data-kind="${kind}"]`, { hasText: 'const mega' });
    await expect(row).toHaveAttribute('data-word', 'capped');
    const title = await row.getAttribute('title');
    expect(title?.length ?? 0).toBeGreaterThan(0);
    await expect(row.locator(`[data-word="${kind}"]`)).toHaveCount(0);
  }
});

test('词级 span 不吃空白:行文本与 fixture 逐字节一致', async ({ page }) => {
  await page.goto(ROUTE);
  const addRow = page.locator('[data-kind="add"]', { hasText: 'timeoutMs = 5000' });
  // 行内第 4 个 span = 文本位(oldNo, newNo, sign, text)
  await expect(addRow.locator('span').nth(3)).toHaveText(
    'const timeoutMs = 5000; // retry window',
  );
});

test('add-only hunk 零词级 span(27b 回归面,配对不误触发)', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27b');
  await expect(page.locator('[data-kind="add"]')).toHaveCount(1);
  await expect(page.locator('[data-word]')).toHaveCount(0);
});

test('plan-diff 面同路径接词级 span(scenario 72 的真 del/add 对)', async ({ page }) => {
  await page.goto('/app/todo/r8-15?scenario=72');
  await expect(page.locator('[data-word="add"]').first()).toBeVisible();
  await expect(page.locator('[data-word="del"]').first()).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`词级底色骑比整行底色更深的 token,非透明且可区分(${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto(ROUTE);
    for (const kind of ['add', 'del'] as const) {
      const row = page.locator(`[data-kind="${kind}"]`, { hasText: 'timeoutMs' });
      const rowBg = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
      const wordBg = await row
        .locator(`[data-word="${kind}"]`)
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(wordBg).not.toBe('rgba(0, 0, 0, 0)');
      expect(wordBg).not.toBe(rowBg);
    }
  });
}
