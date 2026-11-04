import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const TOKEN = `sk-ant-oat01-${'e'.repeat(64)}`;

for (const locale of ['zh', 'en'] as const) {
test(`connects, verifies and deletes a subscription on the model routing page (${locale})`, async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('cairn.locale', value), locale);
  let rejectDelete = true;
  const connections: { id: string; kind: string; label: string; expiresAt: number | null; createdAt: number }[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/claude-subscriptions') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        expect(body.token).toBe(TOKEN);
        const connection = { id: 'subscription-1', kind: 'claude-subscription', label: body.label, expiresAt: body.expiresAt, createdAt: Date.now() };
        connections.push(connection);
        return json(connection, 201);
      }
      return json(connections);
    }
    if (path === '/api/teams/t1/claude-subscriptions/subscription-1/verify') return json({ ok: true });
    if (path === '/api/teams/t1/claude-subscriptions/subscription-1' && route.request().method() === 'DELETE') {
      if (rejectDelete) { rejectDelete = false; return json({ error: 'unavailable' }, 503); }
      connections.splice(0);
      return route.fulfill({ status: 204 });
    }
  });
  await page.goto('/app/resources/model-routing');
  await expect(page).toHaveURL(/\/app\/settings\/routing/);

  await page.getByRole('button', { name: locale === 'zh' ? '添加 Claude 账户' : 'Add a Claude account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Claude subscription' });
  await expect(dialog).toContainText('claude setup-token');
  await dialog.getByTestId('subscription-label').fill('Personal Claude');
  await expect(dialog.getByTestId('subscription-token')).toHaveAttribute('type', 'password');
  await dialog.getByTestId('subscription-token').fill(TOKEN);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.locator('[data-account-id="subscription-1"]');
  await expect(row).toContainText('Personal Claude');
  await expect(page.locator('body')).not.toContainText(TOKEN);

  await row.getByTestId('account-more').click();
  await page.getByRole('menuitem', { name: locale === 'zh' ? /验证/ : /Verify/ }).click();
  await expect(page.getByText(locale === 'zh' ? '「Personal Claude」验证通过' : 'Personal Claude verified')).toBeVisible();
  await page.screenshot({ path: `/tmp/b1-subscription-before-delete-${locale}.png`, fullPage: true });

  const remove = locale === 'zh' ? '移除' : 'Remove';
  await row.getByTestId('account-more').click();
  await page.getByRole('menuitem', { name: new RegExp(remove) }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Personal Claude');
  await confirm.getByRole('button', { name: locale === 'zh' ? '取消' : 'Cancel', exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByTestId('account-more').click();
  await page.getByRole('menuitem', { name: new RegExp(remove) }).click();
  await confirm.getByRole('button', { name: remove, exact: true }).click();
  await expect(page.getByText(locale === 'zh' ? '移除失败，请重试。' : 'Could not remove. Try again.')).toBeVisible();
  await row.getByTestId('account-more').click();
  await page.getByRole('menuitem', { name: new RegExp(remove) }).click();
  await confirm.getByRole('button', { name: remove, exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.screenshot({ path: `/tmp/b1-subscription-after-delete-${locale}.png`, fullPage: true });
});

}
