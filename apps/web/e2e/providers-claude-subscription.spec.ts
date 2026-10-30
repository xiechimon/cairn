import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const TOKEN = `sk-ant-oat01-${'e'.repeat(64)}`;

for (const locale of ['zh', 'en'] as const) {
test(`connects, verifies and deletes a subscription (${locale})`, async ({ page }) => {
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
  await page.goto('/app/resources/providers');
  await page.getByTestId('add-claude-subscription').click();
  const dialog = page.getByRole('dialog', { name: 'Add Claude subscription' });
  await expect(dialog).toContainText('claude setup-token');
  await dialog.getByTestId('subscription-label').fill('Personal Claude');
  await expect(dialog.getByTestId('subscription-token')).toHaveAttribute('type', 'password');
  await dialog.getByTestId('subscription-token').fill(TOKEN);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const row = page.locator('[data-connection-kind="claude-subscription"]');
  await expect(row).toContainText('Personal Claude');
  await expect(page.locator('body')).not.toContainText(TOKEN);
  await row.getByTestId('verify-claude-subscription').click();
  await expect(row.getByRole('status')).toHaveText('Verified');
  await page.screenshot({ path: `/tmp/b1-subscription-before-delete-${locale}.png`, fullPage: true });
  await row.getByTestId('delete-claude-subscription').click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Personal Claude');
  await confirm.getByRole('button', { name: locale === 'zh' ? '取消' : 'Cancel', exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByTestId('delete-claude-subscription').click();
  await confirm.getByRole('button', { name: locale === 'zh' ? '删除' : 'Delete', exact: true }).click();
  await expect(row.getByRole('alert')).toHaveText(locale === 'zh' ? '删除 Claude 订阅连接失败，请重试。' : 'Could not delete the Claude subscription. Try again.');
  await row.getByTestId('delete-claude-subscription').click();
  await confirm.getByRole('button', { name: locale === 'zh' ? '删除' : 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.screenshot({ path: `/tmp/b1-subscription-after-delete-${locale}.png`, fullPage: true });
});

}
