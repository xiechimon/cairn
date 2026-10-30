import { expect, type Locator, type Page, test } from '@playwright/test';
import { settleTransitions } from './helpers.js';

const AGENT =
  '/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06';
const SKILLS = '/app/resources/skills?scenario=01';
const TASKS = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-tasks&tab=tasks';
const AGENT_PERMS = '/app/resources/agents/r3-builder?scenario=agent-detail';
const ACCEPT = '/app?scenario=34';

const BADGES = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=57f';
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
  primaryColor: string;
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
      primaryColor: root.getPropertyValue('--primary').trim(),
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
  // Focus starts 150ms outline / box-shadow transitions; read only after
  // they settle (#1427).
  await settleTransitions(page);
  const hit = await locator.evaluate(
    (el) => document.activeElement === el && el.matches(':focus-visible'),
  );
  if (!hit) {
    await locator.focus();
    await settleTransitions(page);
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

function expectFieldRing(info: FocusInfo) {
  expect(info.focusVisible).toBe(true);
  expect(info.outlineStyle).toBe('none');
  expect(info.borderTopColor).toBe(hexToRgb(info.focusRing));
  expect(info.boxShadow).toContain('0px 0px 0px 3px');
}

async function themed(page: Page, theme: 'dark' | 'light', url: string) {
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
  await page.goto(url);
}

test.describe('#1244 registry focus: outline on buttons, field ring on text fields', () => {
  test('input and select wear the field ring; the button keeps the global outline', async ({
    page,
  }) => {
    await themed(page, 'dark', AGENT);
    await page.getByRole('button', { name: '创建 Agent' }).click();
    const dialog = page.getByRole('dialog', { name: '创建 agent' });
    await expect(dialog).toBeVisible();

    const input = dialog.locator('#dlg-agent-name');
    await focusKeyboard(input);
    expectFieldRing(await readFocus(input));

    const select = dialog.locator('.dlg-agent-machine-select');
    await focusKeyboard(select);
    expectFieldRing(await readFocus(select));

    const button = dialog.getByRole('button', { name: '关闭' });
    await focusKeyboard(button);
    expectGlobalOutline(await readFocus(button));
  });

  test('the same three controls in light', async ({ page }) => {
    await themed(page, 'light', AGENT);
    await page.getByRole('button', { name: '创建 Agent' }).click();
    const dialog = page.getByRole('dialog', { name: '创建 agent' });
    await expect(dialog).toBeVisible();
    const input = dialog.locator('#dlg-agent-name');
    await focusKeyboard(input);
    expectFieldRing(await readFocus(input));
    await focusKeyboard(dialog.locator('.dlg-agent-machine-select'));
    expectFieldRing(await readFocus(dialog.locator('.dlg-agent-machine-select')));
    await focusKeyboard(dialog.getByRole('button', { name: '关闭' }));
    expectGlobalOutline(await readFocus(dialog.getByRole('button', { name: '关闭' })));
  });

  test('a default textarea wears the field ring in both themes', async ({ page }) => {
    for (const theme of ['dark', 'light'] as const) {
      await themed(page, theme, SKILLS);
      await page.getByTestId('resource-empty').getByRole('button', { name: '新建技能' }).click();
      const dialog = page.getByRole('dialog', { name: '新建技能' });
      await expect(dialog).toBeVisible();
      const body = dialog.locator('#dlg-skill-body');
      await focusKeyboard(body);
      expectFieldRing(await readFocus(body));
    }
  });

  test('clicking the name input shows the field ring, not the gray ring', async ({ page }) => {
    await themed(page, 'dark', AGENT);
    await page.getByRole('button', { name: '创建 Agent' }).click();
    const input = page.locator('#dlg-agent-name');
    await input.click();
    await settleTransitions(page);
    expectFieldRing(await readFocus(input));
  });

  test('aria-invalid keeps a 3px destructive shadow and the global outline', async ({ page }) => {
    await themed(page, 'dark', AGENT);
    await page.getByRole('button', { name: '创建 Agent' }).click();
    const input = page.locator('#dlg-agent-name');
    await focusKeyboard(input);
    await input.evaluate((el) => el.setAttribute('aria-invalid', 'true'));
    await settleTransitions(page);
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
    const checked = await readFocus(checkbox);
    expectGlobalOutline(checked);
    expect(checked.borderTopColor).toBe(hexToRgb(checked.primaryColor));

    await checkbox.click();
    await focusKeyboard(checkbox);
    const unchecked = await readFocus(checkbox);
    expectGlobalOutline(unchecked);
    expect(unchecked.borderTopColor).toBe(hexToRgb(unchecked.inputColor));

    await themed(page, 'dark', AGENT_PERMS);
    await page.locator('.agent-detail .agent-tab').nth(2).click();
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

  test('input-group draws the field ring on the shell, not the control', async ({ page }) => {
    await themed(page, 'dark', TASKS);
    const control = page.getByRole('textbox', { name: '搜索任务' });
    await expect(control).toBeVisible();
    await focusKeyboard(control);
    const controlInfo = await readFocus(control);
    expect(controlInfo.focusVisible).toBe(true);
    expect(controlInfo.outlineStyle).toBe('none');
    expect(controlInfo.boxShadow).not.toContain('0px 0px 0px 3px');
    const shell = page.locator('[data-slot="input-group"]').first();
    expectFieldRing({ ...(await readFocus(shell)), focusVisible: true });
  });

  // Segmented options sit 2px apart, so their keyboard ring is drawn inside
  // the option box (offset -2) instead of the global outset outline.
  test('a segmented option draws the focus ring inset', async ({ page }) => {
    await themed(page, 'dark', SCHEDULES);
    const option = page.locator('.sched-form-freq-tab[aria-checked="true"]');
    await expect(option).toBeVisible();
    await focusKeyboard(option);
    const info = await readFocus(option);
    expect(info.focusVisible).toBe(true);
    expect(info.outlineStyle).toBe('solid');
    expect(info.outlineWidth).toBe('2px');
    expect(info.outlineOffset).toBe('-2px');
    expect(info.outlineColor).toBe(hexToRgb(info.focusRing));
    expect(info.boxShadow).not.toContain('0px 0px 0px 3px');
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
