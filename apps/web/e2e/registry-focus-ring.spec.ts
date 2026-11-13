import { expect, type Locator, type Page, test } from '@playwright/test';
import { settleTransitions } from './helpers.js';

const SKILLS = '/app/resources/skills?scenario=01';
const TASKS = '/app/project/ZAQczKCu0MOAzC1ZqcFlX/tasks?scenario=prj-tasks';
const ROUTING_POLICIES = '/app/settings/work-routing?scenario=routing-settings';
const ACCEPT = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=34';

const BADGES = '/design.html';
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
  expect(info.outlineOffset).toBe('0px');
  expect(info.outlineColor).toBe(hexToRgb(info.focusRing));
  expect(info.boxShadow).not.toContain('0px 0px 0px 3px');
  expect(info.borderTopColor).not.toBe(hexToRgb(info.ringColor));
}

function expectFieldRing(info: FocusInfo) {
  expect(info.focusVisible).toBe(true);
  expect(info.outlineStyle).toBe('none');
  expect(info.borderTopColor).toBe(hexToRgb(info.focusRing));
  expect(info.boxShadow).toBe('none');
}

async function themed(page: Page, theme: 'dark' | 'light', url: string) {
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
  await page.goto(url);
}

async function openSkillDialog(page: Page, theme: 'dark' | 'light') {
  await themed(page, theme, SKILLS);
  await page.getByTestId('resource-empty').getByRole('button', { name: '新建技能' }).click();
  const dialog = page.getByRole('dialog', { name: '新建技能' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('#1244 registry focus: outline on buttons, field ring on text fields', () => {
  test('input wears the field ring; the button keeps the global outline', async ({ page }) => {
    const dialog = await openSkillDialog(page, 'dark');

    const input = dialog.locator('#dlg-skill-name');
    await focusKeyboard(input);
    expectFieldRing(await readFocus(input));

    const button = dialog.getByRole('button', { name: '关闭' });
    await focusKeyboard(button);
    expectGlobalOutline(await readFocus(button));
  });

  test('the same controls in light', async ({ page }) => {
    const dialog = await openSkillDialog(page, 'light');
    const input = dialog.locator('#dlg-skill-name');
    await focusKeyboard(input);
    expectFieldRing(await readFocus(input));
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
    const dialog = await openSkillDialog(page, 'dark');
    const input = dialog.locator('#dlg-skill-name');
    await input.click();
    await settleTransitions(page);
    expectFieldRing(await readFocus(input));
  });

  test('aria-invalid focus draws only a destructive border, no outline or halo', async ({
    page,
  }) => {
    const dialog = await openSkillDialog(page, 'dark');
    const input = dialog.locator('#dlg-skill-name');
    await focusKeyboard(input);
    await input.evaluate((el) => el.setAttribute('aria-invalid', 'true'));
    await settleTransitions(page);
    const info = await readFocus(input);
    const destructive = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--destructive)';
      document.body.append(probe);
      const out = getComputedStyle(probe).color;
      probe.remove();
      return out;
    });
    expect(info.outlineStyle).toBe('none');
    expect(info.borderTopColor).toBe(destructive);
    expect(info.boxShadow).toBe('none');
  });

  test('checkbox, switch, and badge use the global outline', async ({ page }) => {
    await themed(page, 'dark', ACCEPT);
    await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
    await page.getByRole('menuitem', { name: '完成' }).click();
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

    await themed(page, 'dark', ROUTING_POLICIES);
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

  test('a segmented option draws the focus ring inset', async ({ page }) => {
    await themed(page, 'dark', SCHEDULES);
    const option = page.getByRole('radiogroup', { name: '频率' }).getByRole('radio', { checked: true });
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

  test('the sidebar settings link uses the global outline', async ({ page }) => {
    await themed(page, 'dark', '/app/schedules?scenario=01');
    const user = page.getByTestId('sidebar-settings');
    await expect(user).toBeVisible();
    await focusKeyboard(user);
    const info = await readFocus(user);
    expect(info.focusVisible).toBe(true);
    expect(info.outlineStyle).toBe('solid');
    expect(info.outlineWidth).toBe('2px');
    expect(info.outlineOffset).toBe('0px');
    expect(info.outlineColor).toBe(hexToRgb(info.focusRing));
    expect(info.boxShadow).not.toContain('0px 0px 0px 3px');
  });
});
