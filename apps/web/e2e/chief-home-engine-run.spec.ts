import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { settleTransitions } from './helpers.js';

const open = (page: Page, state: string) =>
  page.goto(`/app?scenario=home-c-engine&thread=home-c-engine-${state}&player`);
const tail = (page: Page) => page.getByTestId('engine-run');
const menuItem = async (page: Page, name: string) => {
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
  return page.getByRole('menuitem', { name });
};
const transcript = (page: Page) => page.getByTestId('transcript-col');
const lastSteps = (page: Page) => page.getByTestId('work-block').last().getByTestId('work-call');
const planStates = (page: Page) =>
  page
    .getByTestId('agent-todo')
    .last()
    .getByTestId('md-task')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-state')));

const STATES = [
  { state: 'running', data: 'running', phase: 'building' },
  { state: 'waiting', data: 'waiting', phase: 'needs_input' },
  { state: 'finished', data: 'finished', phase: 'done' },
  { state: 'failed', data: 'failed', phase: 'failed' },
  { state: 'unknown', data: 'running', phase: 'building' },
  { state: 'long', data: 'finished', phase: 'done' },
];

for (const { state, data, phase } of STATES) {
  test(`the ${state} run is the thread's own conversation and the head agrees`, async ({
    page,
  }) => {
    await open(page, state);
    await expect(tail(page)).toHaveAttribute('data-state', data);
    await expect(page.getByTestId('side-chat')).toHaveAttribute('data-phase', phase);
    await expect(page.getByTestId('engine-card')).toHaveCount(0);
    await expect(transcript(page).getByTestId('work-block').last()).toBeVisible();
  });
}

test('a running run shows its plan and steps, with its time so far in the usage popover', async ({ page }) => {
  await open(page, 'running');
  expect(await planStates(page)).toEqual(['done', 'done', 'doing', 'todo']);
  await expect(page.getByTestId('work-spinner')).toBeVisible();
  await page.getByTestId('thread-usage-ring').click();
  const usage = page.getByTestId('thread-usage');
  await expect(usage).toContainText('时长');
  await expect(usage).not.toContainText('模型档位');
  await expect(usage).not.toContainText('要改一个文件并跑测试');
  await page.keyboard.press('Escape');
  await expect(await menuItem(page, '接管')).toBeVisible();
});

test('a finished run keeps time and cost in the usage popover and offers no takeover', async ({ page }) => {
  await open(page, 'finished');
  expect(await planStates(page)).toEqual(['done', 'done', 'done', 'done']);
  await expect(page.getByTestId('engine-question')).toHaveCount(0);
  await expect(transcript(page)).toContainText('已允许这一次');
  await page.getByTestId('thread-usage-ring').click();
  await expect(page.getByTestId('thread-usage')).toContainText('4m 12s');
  await expect(page.getByTestId('thread-usage')).toContainText('$0.21');
});

test('a failed run opens the failed command with its output', async ({ page }) => {
  await open(page, 'failed');
  const failed = lastSteps(page).last();
  await expect(failed).toHaveAttribute('aria-expanded', 'true');
  await expect(failed).toContainText('pnpm test:upload');
  await expect(page.getByTestId('tool-output')).toContainText('Tests  1 failed | 30 passed (31)');
  await expect(await menuItem(page, '原始输出')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '接管' })).toHaveCount(0);
});

test('the raw output fills the panel at its end and back returns to the conversation', async ({
  page,
}) => {
  await open(page, 'long');
  await (await menuItem(page, '原始输出')).click();
  const raw = page.getByTestId('engine-raw');
  await expect(raw).toContainText('● Bash(pnpm test)');
  await expect(transcript(page)).toHaveCount(0);
  const box = await raw.evaluate((el) => ({
    scrolls: el.scrollHeight > el.clientHeight,
    fromEnd: el.scrollHeight - el.scrollTop - el.clientHeight,
    mono: getComputedStyle(el).fontFamily,
  }));
  expect(box.scrolls).toBe(true);
  expect(box.fromEnd).toBeLessThanOrEqual(1);
  expect(box.mono.toLowerCase()).toContain('mono');
  await page.getByTestId('side-chat-back').click();
  await expect(transcript(page)).toBeVisible();
  await (await menuItem(page, '原始输出')).click();
  await expect(raw).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(transcript(page)).toBeVisible();
  await expect(page.getByTestId('side-chat')).toBeVisible();
});

test('a long step list folds its earlier steps behind one row', async ({ page }) => {
  await open(page, 'long');
  const earlier = page.getByTestId('work-earlier');
  await expect(earlier).toHaveText('之前的 18 步');
  await expect(lastSteps(page)).toHaveCount(5);
  await earlier.click();
  await expect(earlier).toHaveAttribute('aria-expanded', 'true');
  await expect(lastSteps(page)).toHaveCount(23);
  await open(page, 'running');
  await expect(page.getByTestId('work-earlier')).toHaveCount(0);
});

test('the fixture driver stays off the page unless the address asks for it', async ({ page }) => {
  await page.goto('/app?scenario=home-c-engine&thread=home-c-engine-running');
  await expect(tail(page)).toHaveAttribute('data-state', 'running');
  await expect(page.getByTestId('engine-player')).toHaveCount(0);
});

test('an unknown event names its type and opens its raw payload', async ({ page }) => {
  await open(page, 'unknown');
  const row = lastSteps(page).filter({ hasText: 'context_compaction' });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.getByTestId('tool-output')).toContainText('"before_tokens": 148200');
});

test('allowing the question advances the run to its end', async ({ page }) => {
  await open(page, 'waiting');
  const question = page.getByTestId('engine-question');
  await expect(question.getByRole('button')).toHaveText(['允许这一次', '拒绝']);
  await expect(page.getByTestId('engine-player').getByRole('button', { name: '下一步' })).toBeDisabled();
  await question.getByRole('button', { name: '允许这一次' }).click();
  await expect(question).toHaveCount(0);
  await expect(transcript(page)).toContainText('已允许这一次');
  await expect(tail(page)).toHaveAttribute('data-state', 'running');
  await expect(page.getByTestId('side-chat')).toHaveAttribute('data-phase', 'building');
  await page.getByTestId('engine-player').getByRole('button', { name: '下一步' }).click();
  await expect(tail(page)).toHaveAttribute('data-state', 'finished');
  expect(await planStates(page)).toEqual(['done', 'done', 'done', 'done']);
  await expect(page.getByTestId('engine-player')).toContainText('事件 8 / 8');
});

test('refusing the question ends the run without the refused command', async ({ page }) => {
  await open(page, 'waiting');
  await page.getByTestId('engine-question').getByRole('button', { name: '拒绝' }).click();
  await expect(transcript(page)).toContainText('已拒绝');
  await expect(tail(page)).toHaveAttribute('data-state', 'finished');
  await expect(transcript(page)).toContainText('不跑完整上传测试');
  await expect(transcript(page)).not.toContainText('pnpm test:upload');
  expect(await planStates(page)).toEqual(['done', 'done', 'todo', 'todo']);
});

test('takeover from the menu asks first, marks the run as taken over and hands back', async ({
  page,
}) => {
  await open(page, 'waiting');
  await (await menuItem(page, '接管')).click();
  const dialog = page.getByRole('dialog', { name: '接管这次运行' });
  await expect(dialog).toContainText('终端还没有接入');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(tail(page)).toHaveAttribute('data-state', 'waiting');
  await (await menuItem(page, '接管')).click();
  await dialog.getByTestId('engine-take-over-confirm').click();
  await expect(tail(page)).toHaveAttribute('data-state', 'taken_over');
  await expect(page.getByTestId('engine-question').getByRole('button')).toHaveCount(0);
  await (await menuItem(page, '交还')).click();
  await expect(tail(page)).toHaveAttribute('data-state', 'waiting');
  await expect(page.getByTestId('engine-question').getByRole('button')).toHaveCount(2);
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
  await expect(tail(page)).toHaveAttribute('data-state', 'waiting');
});

test('a thread without an engine run shows no engine run and no driver', async ({ page }) => {
  await page.goto('/app?scenario=home-c-engine&thread=home-c-working-c');
  await expect(page.getByTestId('side-chat')).toBeVisible();
  await expect(page.getByTestId('live-row')).toBeVisible();
  await expect(tail(page)).toHaveCount(0);
  await expect(page.getByTestId('engine-player')).toHaveCount(0);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const state of ['waiting', 'long']) {
    test(`the ${state} run fits the full-screen task view`, async ({ page }) => {
      await open(page, state);
        const fits = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(fits).toBe(true);
    });
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe finds nothing on the waiting run (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'waiting');
    await expect(tail(page)).toBeVisible();
    await settleTransitions(page);
    const { violations } = await new AxeBuilder({ page })
      .include('.side-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  });
}
