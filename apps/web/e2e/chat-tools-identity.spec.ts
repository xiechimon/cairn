import { expect, type Page, test } from '@playwright/test';

// Issue #933: the collapsed tool-call group used to be a zero-context bare
// pill — [复制 | 完成 Ns ›] with no glyph, no label — reading as a stray
// button when it lands above the first agent message, and its copy button
// copied content the screen did not show yet (the pills + outputs only
// exist once expanded). The collapsed row now carries the group's identity
// (terminal glyph + 工具过程 label, the #615 过程 word family) and the copy
// affordance only exists in the expanded state, where what it copies is on
// screen. Each test pins one failure way:
//   I1 collapsed row names itself — glyph + label, not a bare pill
//   I2 collapsed row offers no copy; expanding brings it back
//   I3 the copy still puts pills + outputs on the clipboard (expanded only)
//   I4 expand/collapse interaction and the #470 geometry fence are untouched
//   I5 the identity row draws no rule and keeps the transcript's air
//
// #945/#910 重钉：detail.css 退役——组 toggle = role=button+「工具过程」
// 文案一级；action 行 = msg-actions testid（无 role 结构容器，二级）；
// 复制 = role=button+文案；pill = tool-pill testid；收起 = role=button+
// 文案；行内 label/elapsed 用文本载体（不再钉类名）。

const COLLAPSED = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=md-toolout';
const EXPANDED = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=28';

const toggle = (page: Page) => page.getByRole('button', { name: /工具过程/ });
const toolsRow = (page: Page) =>
  page.getByTestId('msg-actions').filter({ has: page.locator('button[aria-expanded]') });

async function readClipboard(page: Page): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  return page.evaluate(() => navigator.clipboard.readText());
}

test('I1: the collapsed group names itself — terminal glyph + 工具过程 label', async ({
  page,
}) => {
  await page.goto(COLLAPSED);
  const expander = toggle(page);
  await expect(expander).toBeVisible();
  // the identity glyph rides inside the expander, ahead of the elapsed tail
  await expect(expander.locator('svg').first()).toBeVisible();
  const label = expander.getByText('工具过程');
  await expect(label).toHaveText('工具过程');
  await expect(label).toBeVisible();
  // the label reads before the elapsed tail, so the row opens with identity
  const order = await expander.evaluate((el) => {
    const spans = [...el.querySelectorAll('span')];
    const label = spans.find((s) => s.textContent?.includes('工具过程'));
    const elapsed = spans.find((s) => /完成/.test(s.textContent ?? ''));
    if (label == null || elapsed == null) return null;
    return label.getBoundingClientRect().left < elapsed.getBoundingClientRect().left;
  });
  expect(order).toBe(true);
});

test('I2: collapsed offers no copy — the affordance lives in the expanded state', async ({
  page,
}) => {
  await page.goto(COLLAPSED);
  // collapsed: nothing to copy that the screen shows, so no copy button
  await expect(toolsRow(page).getByRole('button', { name: '复制' })).toHaveCount(0);
  // expanding brings the copy back beside the group header
  await toggle(page).click();
  await expect(page.getByTestId('tool-pill')).toHaveCount(2);
  await expect(toolsRow(page).getByRole('button', { name: '复制' })).toHaveCount(1);
  // collapsing removes it again — the rule rides the state, not the mount
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect(toolsRow(page).getByRole('button', { name: '复制' })).toHaveCount(0);
});

test('I3: expanded copy still puts pills and outputs on the clipboard', async ({ page }) => {
  await page.goto(COLLAPSED);
  await readClipboard(page);
  await toggle(page).click();
  await toolsRow(page).getByRole('button', { name: '复制' }).click();
  const clip = await readClipboard(page);
  expect(clip).toContain('bash ls -la');
  expect(clip).toContain('total 16');
  expect(clip).toContain('hello from pacman');
});

test('I4: expand/collapse interaction and the #470 row geometry are untouched', async ({
  page,
}) => {
  await page.goto(EXPANDED);
  const expander = toggle(page);
  await expect(expander).toHaveAttribute('aria-expanded', 'true');
  // the identity label rides both states — the header is the group's name
  await expect(expander.getByText('工具过程')).toHaveText('工具过程');
  await expander.click();
  await expect(page.getByTestId('tool-pill')).toHaveCount(0);
  await expect(expander).toHaveAttribute('aria-expanded', 'false');
  await expander.click();
  await expect(page.getByTestId('tool-pill')).toHaveCount(2);
  // #470 fence: the row keeps its 32px inset under the agent text column and
  // the 16px pitch — the identity glyph must not grow the row
  const geo = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="msg-actions"]:has(button[aria-expanded])',
    )!;
    const cs = getComputedStyle(el);
    return { padLeft: cs.paddingLeft, height: Math.round(el.getBoundingClientRect().height) };
  });
  expect(geo.padLeft).toBe('32px');
  expect(geo.height).toBeLessThanOrEqual(16);
});

test('I5: the identity row draws no rule — the transcript boundary stays air', async ({
  page,
}) => {
  await page.goto(COLLAPSED);
  // scoped to the action-row family: the md sample's code fence carries its
  // own box border by design (#469), the turn boundary must not
  const ruled = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="msg-actions"], [data-testid="msg-actions"] *',
      ),
    ]
      .filter((el) => {
        const cs = getComputedStyle(el);
        const top = Number.parseFloat(cs.borderTopWidth) || 0;
        const bot = Number.parseFloat(cs.borderBottomWidth) || 0;
        return (top > 0 || bot > 0) && el.getBoundingClientRect().height > 0;
      })
      .map((el) => el.className),
  );
  expect(ruled).toEqual([]);
});
