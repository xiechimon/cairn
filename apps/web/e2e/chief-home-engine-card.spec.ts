import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { settleTransitions } from './helpers.js';

const open = (page: Page, state: string) =>
  page.goto(`/app?scenario=home-c-engine&thread=home-c-engine-${state}&player`);
const card = (page: Page) => page.getByTestId('engine-card');
const planStates = (page: Page) =>
  page
    .getByTestId('engine-plan')
    .getByTestId('md-task')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-state')));

const STATES = [
  { state: 'running', data: 'running', word: '运行中', phase: 'building' },
  { state: 'waiting', data: 'waiting', word: '等你输入', phase: 'needs_input' },
  { state: 'finished', data: 'finished', word: '已完成', phase: 'done' },
  { state: 'failed', data: 'failed', word: '失败', phase: 'failed' },
  { state: 'unknown', data: 'running', word: '运行中', phase: 'building' },
  { state: 'long', data: 'finished', word: '已完成', phase: 'done' },
];

for (const { state, data, word, phase } of STATES) {
  test(`the ${state} fixture renders its engine card and the thread head agrees`, async ({
    page,
  }) => {
    await open(page, state);
    await expect(card(page)).toHaveAttribute('data-state', data);
    await expect(page.getByTestId('engine-state')).toHaveText(word);
    await expect(page.getByTestId('side-chat')).toHaveAttribute('data-phase', phase);
    await expect(
      page.getByTestId('engine-events').locator(':scope > *').last(),
    ).toBeInViewport({ ratio: 1 });
    await expect(card(page).locator('[data-trace-card]')).toHaveCount(0);
  });
}

test('a running card shows the plan, the typing bubble and the reason for its model', async ({
  page,
}) => {
  await open(page, 'running');
  expect(await planStates(page)).toEqual(['done', 'done', 'doing', 'todo']);
  await expect(page.getByTestId('engine-typing')).toBeVisible();
  await expect(page.getByTestId('engine-choice')).toHaveText(
    '中档模型 · 中等强度 · 要改一个文件并跑测试',
  );
  await expect(page.getByTestId('engine-diff')).toHaveCount(0);
  await page.getByTestId('engine-edit').getByRole('button').click();
  await expect(page.getByTestId('engine-diff').locator('[data-kind="add"]')).toHaveCount(3);
  await expect(page.getByTestId('engine-take-over')).toBeVisible();
});

test('a finished card carries time and cost and offers no takeover', async ({ page }) => {
  await open(page, 'finished');
  await expect(page.getByTestId('engine-choice')).toContainText('4m 12s · $0.21 · 中档模型');
  expect(await planStates(page)).toEqual(['done', 'done', 'done', 'done']);
  await expect(page.getByTestId('engine-typing')).toHaveCount(0);
  await expect(page.getByTestId('engine-take-over')).toHaveCount(0);
  await expect(page.getByTestId('engine-question')).toHaveAttribute('data-answer', 'allowed');
});

test('a failed card opens the failed command with its output', async ({ page }) => {
  await open(page, 'failed');
  await expect(card(page).locator('[data-trace-command]')).toContainText('pnpm test:upload');
  await expect(card(page)).toContainText('exit 1');
  await expect(card(page)).toContainText('Tests  1 failed | 30 passed (31)');
  await expect(page.getByTestId('engine-take-over')).toHaveCount(0);
});

test('the view switch shows the raw output scrolled to its end and returns to the conversation', async ({
  page,
}) => {
  await open(page, 'long');
  await page.getByTestId('engine-view-raw').click();
  const raw = page.getByTestId('engine-raw');
  await expect(raw).toContainText('● Bash(pnpm test)');
  await expect(page.getByTestId('engine-events')).toHaveCount(0);
  const box = await raw.evaluate((el) => ({
    scrolls: el.scrollHeight > el.clientHeight,
    fromEnd: el.scrollHeight - el.scrollTop - el.clientHeight,
    mono: getComputedStyle(el).fontFamily,
  }));
  expect(box.scrolls).toBe(true);
  expect(box.fromEnd).toBeLessThanOrEqual(1);
  expect(box.mono.toLowerCase()).toContain('mono');
  await page.getByTestId('engine-view-chat').click();
  await expect(page.getByTestId('engine-events')).toBeVisible();
});

test('a long run folds its earlier steps behind one row', async ({ page }) => {
  await open(page, 'long');
  const earlier = page.getByTestId('engine-earlier');
  const blocks = page.getByTestId('engine-events').locator(':scope > *');
  await expect(earlier).toHaveText('之前的 20 步');
  await expect(blocks).toHaveCount(6);
  await earlier.click();
  await expect(earlier).toHaveAttribute('aria-expanded', 'true');
  await expect(blocks).toHaveCount(26);
  await open(page, 'running');
  await expect(page.getByTestId('engine-earlier')).toHaveCount(0);
});

test('the fixture driver stays off the page unless the address asks for it', async ({ page }) => {
  await page.goto('/app?scenario=home-c-engine&thread=home-c-engine-running');
  await expect(card(page)).toBeVisible();
  await expect(page.getByTestId('engine-player')).toHaveCount(0);
});

test('an unknown event names its type and opens its raw payload', async ({ page }) => {
  await open(page, 'unknown');
  const row = page.getByTestId('engine-unknown');
  await expect(row).toContainText('未识别的事件');
  await expect(row).toContainText('context_compaction');
  await expect(page.getByTestId('engine-unknown-payload')).toHaveCount(0);
  await row.getByRole('button').click();
  await expect(page.getByTestId('engine-unknown-payload')).toContainText('"before_tokens": 148200');
  await expect(page.getByTestId('engine-unknown-payload')).toBeInViewport();
});

test('allowing the question advances the run to its end', async ({ page }) => {
  await open(page, 'waiting');
  const question = page.getByTestId('engine-question');
  await expect(question.getByRole('button')).toHaveText(['允许这一次', '拒绝', '接管']);
  await expect(page.getByTestId('engine-player').getByRole('button', { name: '下一步' })).toBeDisabled();
  await question.getByRole('button', { name: '允许这一次' }).click();
  await expect(question).toHaveAttribute('data-answer', 'allowed');
  await expect(question).toContainText('已允许这一次');
  await expect(question.getByRole('button')).toHaveCount(0);
  await expect(card(page)).toHaveAttribute('data-state', 'running');
  await expect(page.getByTestId('side-chat')).toHaveAttribute('data-phase', 'building');
  await page.getByTestId('engine-player').getByRole('button', { name: '下一步' }).click();
  await expect(card(page)).toHaveAttribute('data-state', 'finished');
  expect(await planStates(page)).toEqual(['done', 'done', 'done', 'done']);
  await expect(page.getByTestId('engine-player')).toContainText('事件 8 / 8');
});

test('refusing the question ends the run without the refused command', async ({ page }) => {
  await open(page, 'waiting');
  await page.getByTestId('engine-question').getByRole('button', { name: '拒绝' }).click();
  await expect(page.getByTestId('engine-question')).toContainText('已拒绝');
  await expect(card(page)).toHaveAttribute('data-state', 'finished');
  await expect(card(page)).toContainText('不跑完整上传测试');
  await expect(card(page)).not.toContainText('pnpm test:upload');
  expect(await planStates(page)).toEqual(['done', 'done', 'todo', 'todo']);
});

test('takeover asks first, flips the card to taken over and hands back', async ({ page }) => {
  await open(page, 'waiting');
  await page.getByTestId('engine-take-over').click();
  const dialog = page.getByRole('dialog', { name: '接管这次运行' });
  await expect(dialog).toContainText('终端还没有接入');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(card(page)).toHaveAttribute('data-state', 'waiting');
  await page.getByTestId('engine-question').getByRole('button', { name: '接管' }).click();
  await dialog.getByTestId('engine-take-over-confirm').click();
  await expect(card(page)).toHaveAttribute('data-state', 'taken_over');
  await expect(page.getByTestId('engine-state')).toHaveText('你已接管');
  await expect(page.getByTestId('engine-question').getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('engine-take-over')).toHaveCount(0);
  await page.getByTestId('engine-hand-back').click();
  await expect(card(page)).toHaveAttribute('data-state', 'waiting');
  await expect(page.getByTestId('engine-question').getByRole('button')).toHaveCount(3);
});

test('the fixture driver steps, plays on a timer and restarts', async ({ page }) => {
  await page.clock.install();
  await open(page, 'running');
  const player = page.getByTestId('engine-player');
  await expect(player).toContainText('事件 4 / 8');
  await player.getByRole('button', { name: '重来' }).click();
  await expect(player).toContainText('事件 1 / 8');
  expect(await planStates(page)).toEqual(['doing', 'todo', 'todo', 'todo']);
  await player.getByRole('button', { name: '下一步' }).click();
  expect(await planStates(page)).toEqual(['done', 'doing', 'todo', 'todo']);
  await player.getByRole('button', { name: '自动播放' }).click();
  await page.clock.runFor(1500);
  await expect(player).toContainText('事件 3 / 8');
  await page.clock.runFor(6000);
  await expect(player).toContainText('事件 6 / 8');
  await expect(card(page)).toHaveAttribute('data-state', 'waiting');
});

test('a thread without an engine run shows no engine card and no driver', async ({ page }) => {
  await page.goto('/app?scenario=home-c-engine&thread=home-c-working-c');
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await expect(page.getByTestId('live-row')).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByTestId('engine-player')).toHaveCount(0);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const state of ['waiting', 'long']) {
    test(`the ${state} card fits the full-screen task view`, async ({ page }) => {
      await open(page, state);
      await expect(card(page)).toBeInViewport({ ratio: 1 });
      const fit = await card(page).evaluate((el) => {
        const box = el.getBoundingClientRect();
        const inside = [...el.querySelectorAll('[data-segmented="track"], button')].every(
          (node) => {
            const rect = node.getBoundingClientRect();
            return rect.left >= box.left && rect.right <= box.right + 0.5;
          },
        );
        return {
          page: document.documentElement.scrollWidth <= window.innerWidth,
          card: box.left >= 0 && box.right <= window.innerWidth,
          inside,
        };
      });
      expect(fit).toEqual({ page: true, card: true, inside: true });
    });
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe finds nothing on the waiting card (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'waiting');
    await expect(card(page)).toBeVisible();
    await settleTransitions(page);
    const { violations } = await new AxeBuilder({ page })
      .include('.side-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  });
}
