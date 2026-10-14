import { expect, type Locator, type Page, test } from '@playwright/test';

// #1244: registry focus skins (outline-none + focus-visible:ring-3
// ring-ring/50) sit in the utilities layer and override the #388 base
// outline. Keyboard focus on the primitives must be the global outline
// (2px solid --focus-ring, offset 2) and must not paint the 3px gray
// box-shadow. aria-invalid keeps its own destructive shadow.
//
// Failure modes this file pins:
// 1. Mouse focus that is not :focus-visible paints a UA outline.
// 2. aria-invalid loses its destructive shadow.
// 3. A focused input-group draws the outline on the inner control and
//    the shell at once, or on neither.
// 4. checkbox / switch (span roots, outside button/input) have no outline.

const AGENT =
  '/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06';
const SKILLS = '/app/resources/skills?scenario=01';
const TASKS = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-tasks&tab=tasks';
const MACHINES = '/app/resources/machines?scenario=06';
const ACCEPT = '/app?scenario=34';
const BADGES = '/app?scenario=board-tags';
const SCHEDULES = '/app/schedules?scenario=r3-92';

interface FocusInfo {
  focusVisible: boolean;
  outlineStyle: string;
  outlineWidth: string;
  outlineOffset: string;
  outlineColor: string;
  boxShadow: string;
  borderTopColor: string;
  focusRing: string;
  inputColor: string;
  ringColor: string;
}

function hexToRgb(hex: string): string {
  const match = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (match == null) return hex.trim();
  const n = Number.parseInt(match[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

async function readFocus(locator: Locator): Promise<FocusInfo> {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    const root = getComputedStyle(document.documentElement);
    return {
      focusVisible: el.matches(':focus-visible'),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineOffset: cs.outlineOffset,
      outlineColor: cs.outlineColor,
      boxShadow: cs.boxShadow,
      borderTopColor: cs.borderTopColor,
      focusRing: root.getPropertyValue('--focus-ring').trim(),
      inputColor: root.getPropertyValue('--input').trim(),
      ringColor: root.getPropertyValue('--ring').trim(),
    };
  });
}

async function focusKeyboard(locator: Locator) {
  const page = locator.page();
  await locator.focus();
  // Tab away and back so Chromium treats the focus as keyboard focus.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.waitForTimeout(350);
  const hit = await locator.evaluate(
    (el) => document.activeElement === el && el.matches(':focus-visible'),
  );
  if (!hit) {
    await locator.focus();
    await page.waitForTimeout(350);
  }
}

function expectGlobalOutline(info: FocusInfo) {
  expect(info.focusVisible).toBe(true);
  expect(info.outlineStyle).toBe('solid');
  expect(info.outlineWidth).toBe('2px');
  expect(info.outlineOffset).toBe('2px');
  expect(info.outlineColor).toBe(hexToRgb(info.focusRing));
  expect(info.boxShadow).not.toContain('0px 0px 0px 3px');
  expect(info.borderTopColor).not.toBe(hexToRgb(info.ringColor));
}

async function themed(page: Page, theme: 'dark' | 'light', url: string) {
  await page.addInitScript((value) => localStorage.setItem('pacman-theme', value), theme);
  await page.goto(url);
}

test.describe('#1244 registry focus outline', () => {
  test('input, select, and button use the global outline', async ({ page }) => {
    await themed(page, 'dark', AGENT);
    await page.getByRole('button', { name: '创建 Agent' }).click();
    const dialog = page.getByRole('dialog', { name: '创建 agent' });
    await expect(dialog).toBeVisible();

    const input = dialog.locator('#dlg-agent-name');
    await focusKeyboard(input);
    const inputInfo = await readFocus(input);
    expectGlobalOutline(inputInfo);

    const select = dialog.locator('.dlg-agent-machine-select');
    await focusKeyboard(select);
    expectGlobalOutline(await readFocus(select));

    const button = dialog.getByRole('button', { name: '关闭' });
    await focusKeyboard(button);
    expectGlobalOutline(await readFocus(button));
  });

  test('the same three controls use the global outline in light', async ({ page }) => {
    await themed(page, 'light', AGENT);
    await page.getByRole('button', { name: '创建 Agent' }).click();
    const dialog = page.getByRole('dialog', { name: '创建 agent' });
    await expect(dialog).toBeVisible();
    const input = dialog.locator('#dlg-agent-name');
    await focusKeyboard(input);
    expectGlobalOutline(await readFocus(input));
    await focusKeyboard(dialog.locator('.dlg-agent-machine-select'));
    expectGlobalOutline(await readFocus(dialog.locator('.dlg-agent-machine-select')));
    await focusKeyboard(dialog.getByRole('button', { name: '关闭' }));
    expectGlobalOutline(await readFocus(dialog.getByRole('button', { name: '关闭' })));
  });

  test('a default textarea uses the global outline in both themes', async ({ page }) => {
    for (const theme of ['dark', 'light'] as const) {
      await themed(page, theme, SKILLS);
      await page.getByTestId('resource-empty').getByRole('button', { name: '新建技能' }).click();
      const dialog = page.getByRole('dialog', { name: '新建技能' });
      await expect(dialog).toBeVisible();
      const body = dialog.locator('#dlg-skill-body');
      await focusKeyboard(body);
      expectGlobalOutline(await readFocus(body));
    }
  });

  test('clicking the name input shows the global outline, not the gray ring', async ({ page }) => {
    await themed(page, 'dark', AGENT);
    await page.getByRole('button', { name: '创建 Agent' }).click();
    const input = page.locator('#dlg-agent-name');
    await input.click();
    await page.waitForTimeout(350);
    expectGlobalOutline(await readFocus(input));
  });

  test('aria-invalid keeps a 3px destructive shadow and the global outline', async ({ page }) => {
    await themed(page, 'dark', AGENT);
    await page.getByRole('button', { name: '创建 Agent' }).click();
    const input = page.locator('#dlg-agent-name');
    await focusKeyboard(input);
    await input.evaluate((el) => el.setAttribute('aria-invalid', 'true'));
    await page.waitForTimeout(350);
    const info = await readFocus(input);
    expect(info.outlineStyle).toBe('solid');
    expect(info.outlineWidth).toBe('2px');
    expect(info.outlineColor).toBe(hexToRgb(info.focusRing));
    expect(info.boxShadow).toContain('0px 0px 0px 3px');
  });

  test('checkbox, switch, and badge use the global outline', async ({ page }) => {
    await themed(page, 'dark', ACCEPT);
    const checkbox = page.getByRole('dialog', { name: '完成任务' }).locator('[data-slot="checkbox"]');
    await expect(checkbox).toBeVisible();
    await focusKeyboard(checkbox);
    expectGlobalOutline(await readFocus(checkbox));

    await themed(page, 'dark', MACHINES);
    const sw = page.locator('[data-slot="switch"]').first();
    await expect(sw).toBeVisible();
    await focusKeyboard(sw);
    expectGlobalOutline(await readFocus(sw));

    await themed(page, 'dark', BADGES);
    const badge = page.locator('[data-slot="badge"]').first();
    await expect(badge).toBeVisible();
    await badge.evaluate((el) => {
      el.tabIndex = 0;
    });
    await focusKeyboard(badge);
    expectGlobalOutline(await readFocus(badge));
  });

  test('input-group draws the outline on the shell, not the control', async ({ page }) => {
    await themed(page, 'dark', TASKS);
    const control = page.getByRole('textbox', { name: '搜索任务' });
    await expect(control).toBeVisible();
    await focusKeyboard(control);
    const controlInfo = await readFocus(control);
    expect(controlInfo.focusVisible).toBe(true);
    expect(controlInfo.outlineStyle).toBe('none');
    expect(controlInfo.boxShadow).not.toContain('0px 0px 0px 3px');
    const shell = page.locator('[data-slot="input-group"]').first();
    const shellInfo = await readFocus(shell);
    expect(shellInfo.outlineStyle).toBe('solid');
    expect(shellInfo.outlineWidth).toBe('2px');
    expect(shellInfo.outlineOffset).toBe('2px');
    expect(shellInfo.outlineColor).toBe(hexToRgb(shellInfo.focusRing));
    expect(shellInfo.boxShadow).not.toContain('0px 0px 0px 3px');
  });

  test('a tab trigger uses the global outline', async ({ page }) => {
    await themed(page, 'dark', SCHEDULES);
    const tab = page.locator('.sched-form-freq-tab[aria-selected="true"]');
    await expect(tab).toBeVisible();
    await focusKeyboard(tab);
    expectGlobalOutline(await readFocus(tab));
  });

  test('the sidebar user button uses the global outline', async ({ page }) => {
    await themed(page, 'dark', SKILLS);
    const user = page.locator('.sidebar-user');
    await expect(user).toBeVisible();
    await focusKeyboard(user);
    const info = await readFocus(user);
    expect(info.focusVisible).toBe(true);
    expect(info.outlineStyle).toBe('solid');
    expect(info.outlineWidth).toBe('2px');
    expect(info.outlineOffset).toBe('2px');
    expect(info.outlineColor).toBe(hexToRgb(info.focusRing));
    expect(info.boxShadow).not.toContain('0px 0px 0px 3px');
  });
});
