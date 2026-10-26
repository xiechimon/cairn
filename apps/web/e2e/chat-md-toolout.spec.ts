import { expect, type Page, test } from '@playwright/test';

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=md-toolout';

const toggle = (page: Page) =>
  page.getByRole('button', { name: /跑了 2 条命令/ });

/** Computed color of a `color: var(--foreground)` probe — the "normal
 *  contrast" reference the tool output must match (and the note's dim
 *  ink must not). */
async function primaryInk(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--foreground)';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
}

test('A1: tool output is collapsed behind individual calls by default', async ({ page }) => {
  await page.goto(ROUTE);
  // the group renders collapsed — no output block on screen yet
  await expect(page.getByTestId('tool-output')).toHaveCount(0);
  // the stdout must NOT have leaked into a centered dim note either
  await expect(page.getByTestId('transcript-note').filter({ hasText: 'total 16' })).toHaveCount(0);
  await expect(
    page.getByTestId('transcript-note').filter({ hasText: 'hello from cairn' }),
  ).toHaveCount(0);

  await expect(toggle(page)).toBeVisible();
});

test('A2: expanding calls reveals one standalone block per tool output', async ({ page }) => {
  await page.goto(ROUTE);
  if ((await toggle(page).getAttribute('aria-expanded')) !== 'true') await toggle(page).click();
  for (const call of await page.getByTestId('work-call').all()) await call.click();
  const outputs = page.getByTestId('tool-output');
  await expect(outputs).toHaveCount(2);
  // verbatim stdout, whitespace preserved
  await expect(outputs.nth(0)).toContainText('total 16');
  await expect(outputs.nth(0)).toContainText('drwxr-xr-x@ 4 xmon  staff');
  await expect(outputs.nth(1)).toContainText('hello from cairn');
});

test('A3: the output block is left aligned, mono, normal contrast — not a chat-note', async ({
  page,
}) => {
  await page.goto(ROUTE);
  if ((await toggle(page).getAttribute('aria-expanded')) !== 'true') await toggle(page).click();
  for (const call of await page.getByTestId('work-call').all()) await call.click();
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

test('B3b: task list lines render as one todo card with per-state rows', async ({ page }) => {
  await page.goto(ROUTE);
  await expect(page.getByTestId('md-tasks')).toHaveCount(1);
  const tasks = page.getByTestId('md-task');
  await expect(tasks).toHaveCount(4);
  await expect(tasks.nth(0)).toHaveAttribute('data-state', 'done');
  await expect(tasks.nth(1)).toHaveAttribute('data-state', 'doing');
  await expect(tasks.nth(2)).toHaveAttribute('data-state', 'todo');
  await expect(page.getByTestId('agent-text')).not.toContainText('[ ]');
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
