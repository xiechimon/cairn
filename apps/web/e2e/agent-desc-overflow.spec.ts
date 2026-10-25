import { expect, test } from '@playwright/test';
import { stubNotification } from './helpers.js';

const TEAM_LONG = '/app/team?scenario=team-long-role';
const DETAIL_LONG = '/app/resources/agents/r3-builder?scenario=agent-detail-long-role';

test('team card: card scrollHeight = clientHeight (no overflow)', async ({ page }) => {
  await page.goto(TEAM_LONG);
  const card = page.getByTestId('team-agent-card');
  await expect(card).toBeVisible();
  const geom = await card.evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
    scrollW: el.scrollWidth,
    clientW: el.clientWidth,
  }));
  expect(geom.scrollH).toBeLessThanOrEqual(geom.clientH);
  expect(geom.scrollW).toBeLessThanOrEqual(geom.clientW);
});

test('team card: long duties stay off the card, only name and one meta line inside', async ({ page }) => {
  await page.goto(TEAM_LONG);
  const card = page.getByTestId('team-agent-card');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('team-agent-meta')).toBeVisible();
  const text = (await card.textContent()) ?? '';
  expect(text.length).toBeLessThan(100);
  const h = await card.evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeLessThanOrEqual(64);
});

test('detail page: long duties do not break the line width, label column does not wrap vertically', async ({ page }) => {
  await page.goto(DETAIL_LONG);
  const detail = page.locator('.agent-detail');
  await expect(detail).toBeVisible();

  const roleText = detail.locator('.agent-role-text');
  await expect(roleText).toBeVisible();

  const textGeom = await roleText.evaluate((el) => ({
    scrollW: el.scrollWidth,
    clientW: el.clientWidth,
  }));
  expect(textGeom.scrollW).toBeLessThanOrEqual(textGeom.clientW + 1);

  const label = detail.locator('.agent-field-label').filter({ hasText: '职责' });
  const labelGeom = await label.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { w: rect.width };
  });
  expect(labelGeom.w).toBeGreaterThanOrEqual(28);
});

test('detail page: display mode trims + collapses consecutive blank lines (3+ newlines → 2)', async ({ page }) => {
  await page.goto(DETAIL_LONG);
  const roleText = page.locator('.agent-role-text');
  const text = await roleText.textContent();
  expect(text).not.toBeNull();

  expect(text!).not.toMatch(/\n{3,}/);

  expect(text!).not.toMatch(/^\s/);

  expect(text!).not.toMatch(/\s$/);
});

test('detail page: display mode preserves author line breaks (single newlines between paragraphs kept)', async ({ page }) => {
  await page.goto(DETAIL_LONG);
  const roleText = page.locator('.agent-role-text');
  const text = await roleText.textContent();

  expect(text!).toContain('\n');

  expect(text!.length).toBeGreaterThan(200);
});

test('account page: push notification row (auto tier) value slot shrinks without regression', async ({ page }) => {

  await stubNotification(page, 'denied', 'denied');
  await page.goto('/app/account?scenario=13-notify-denied');
  const card = page.locator('.account-card');
  await expect(card).toBeVisible();

  const notifSwitch = page.getByRole('switch', { name: '推送通知' });
  await expect(notifSwitch).toBeVisible();

  await notifSwitch.click();
  const hint = card.locator('.account-notify-blocked');
  await expect(hint).toBeVisible();

  const row = card.locator('.settings-row').last();
  const geom = await row.evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
    scrollW: el.scrollWidth,
    clientW: el.clientWidth,
  }));
  expect(geom.scrollH).toBeLessThanOrEqual(geom.clientH);
  expect(geom.scrollW).toBeLessThanOrEqual(geom.clientW);
});