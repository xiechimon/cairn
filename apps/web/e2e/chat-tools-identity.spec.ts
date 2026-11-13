import { expect, type Page, test } from '@playwright/test';
import { copyFromRowTools } from './helpers.js';

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=md-toolout';
const summary = (page: Page) => page.getByTestId('work-summary');
const block = (page: Page) => page.getByTestId('work-block');

async function readClipboard(page: Page): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  return page.evaluate(() => navigator.clipboard.readText());
}

test('I1: the summary is one quiet row: a 16px state glyph, the work in the secondary ink and a 16px chevron that turns when open', async ({ page }) => {
  await page.goto(ROUTE);
  await expect(summary(page).locator('[data-trace-summary]')).toHaveText('跑了 2 条命令');
  await expect(summary(page)).not.toContainText('19s');
  await expect(summary(page)).toHaveAttribute('data-trace-state', 'done');
  const face = () =>
    summary(page).evaluate((button) => {
      const token = (value: string, property: 'color' | 'backgroundColor') => {
        const probe = document.createElement('div');
        probe.style[property] = value;
        document.body.append(probe);
        const computed = getComputedStyle(probe)[property];
        probe.remove();
        return computed;
      };
      const glyph = button.querySelector('svg[data-glyph]')!;
      const chevron = button.querySelector('svg[data-trace-triangle]')!;
      const text = button.querySelector('[data-trace-summary]')!;
      const box = (el: Element) => el.getBoundingClientRect();
      const style = getComputedStyle(text);
      return {
        height: Math.round(box(button).height),
        glyph: `${glyph.getAttribute('data-glyph')} ${box(glyph).width}x${box(glyph).height}`,
        chevron: `${chevron.getAttribute('data-trace-triangle')} ${chevron.clientWidth}x${chevron.clientHeight} ${getComputedStyle(chevron).rotate}`,
        order: box(glyph).right <= box(text).left && box(text).right <= box(chevron).left,
        gaps: [Math.round(box(text).left - box(glyph).right), Math.round(box(chevron).left - box(text).right)],
        type: `${style.fontSize}/${style.lineHeight}/${style.fontWeight}`,
        secondaryInk: style.color === token('var(--text-secondary)', 'color'),
        glyphInk: getComputedStyle(glyph).color === token('var(--text-tertiary)', 'color'),
        fill:
          getComputedStyle(button).backgroundColor === token('var(--menu-hover)', 'backgroundColor')
            ? 'hover'
            : getComputedStyle(button).backgroundColor,
        svgs: button.querySelectorAll('svg').length,
      };
    });
  const open = {
    height: 28,
    glyph: 'done 16x16',
    chevron: 'open 16x16 90deg',
    order: true,
    gaps: [8, 8],
    type: '14px/20px/400',
    secondaryInk: true,
    glyphInk: true,
    fill: 'rgba(0, 0, 0, 0)',
    svgs: 2,
  };
  await page.mouse.move(0, 0);
  expect(await face()).toEqual(open);
  await summary(page).hover();
  expect(await face()).toEqual({ ...open, fill: 'hover' });
  await summary(page).click();
  await page.mouse.move(0, 0);
  expect(await face()).toEqual({ ...open, chevron: 'closed 16x16 none' });
});

test('I2: work activity has no copy action in either disclosure state', async ({ page }) => {
  await page.goto(ROUTE);
  await expect(summary(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(block(page).getByRole('button', { name: '复制', exact: true })).toHaveCount(0);
  await summary(page).click();
  await expect(page.getByTestId('work-call')).toHaveCount(0);
  await expect(block(page).getByRole('button', { name: '复制', exact: true })).toHaveCount(0);
  await summary(page).click();
  await expect(page.getByTestId('work-call')).toHaveCount(2);
});

test('I3: assistant message copy stays available', async ({ page }) => {
  await page.goto(ROUTE);
  await readClipboard(page);
  const block = page
    .locator('[data-row="agent"] [data-slot="reply-block"]')
    .filter({ has: page.locator('h2') })
    .first();
  const heading = await block.locator('h2').innerText();
  await copyFromRowTools(page, block);
  expect(await readClipboard(page)).toContain(`## ${heading}`);
});

test('I4: call rows sit flush in a hairline card at 36px', async ({ page }) => {
  await page.goto(ROUTE);
  const geometry = await block(page).evaluate((el) => {
    const row = el.querySelector('[data-testid="work-call"]')!;
    return { inset: getComputedStyle(el).paddingLeft, height: row.getBoundingClientRect().height };
  });
  expect(geometry.inset).toBe('0px');
  expect(geometry.height).toBe(36);
});

test('I5: work summaries keep the transcript boundary free of horizontal rules', async ({ page }) => {
  await page.goto(ROUTE);
  const borders = await summary(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.borderTopWidth, style.borderBottomWidth];
  });
  expect(borders).toEqual(['0px', '0px']);
});
