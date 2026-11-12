import { expect, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('a failed turn says so in a plain sentence, keeps the raw text in a tooltip and retries the last message', async ({
  page,
}) => {
  const sent: string[] = [];
  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: [
        { id: 'm1', role: 'user', content: 'Check the repo', createdAt: 10 },
        {
          id: 'm2',
          role: 'system',
          content: JSON.stringify({
            kind: 'chief_turn_error',
            message: 'chief agent not bound (503) {"code":"E_UNBOUND"}',
          }),
          createdAt: 11,
        },
      ],
    },
    (path, route, json) => {
      if (path === `/api/conversations/${THREAD.id}/messages` && route.request().method() === 'POST') {
        sent.push((route.request().postDataJSON() as { content: string }).content);
        return json({ thread: THREAD }, 201);
      }
      return undefined;
    },
  );
  await page.goto('/app');
  const row = page.getByTestId('chief-turn-error');
  await expect(row).toHaveText('The Coordinator did not finish this turn.');
  await expect(page.getByRole('alert').filter({ has: row })).toHaveAttribute('title', /E_UNBOUND/);
  await expect(page.getByTestId('chief-stream')).not.toContainText('E_UNBOUND');
  await page.getByTestId('chief-turn-retry').click();
  await expect.poll(() => sent).toEqual(['Check the repo']);
});

test('only the latest failed turn offers retry once the owner has sent another message', async ({
  page,
}) => {
  const failure = (id: string, createdAt: number) => ({
    id,
    role: 'system',
    content: JSON.stringify({ kind: 'chief_turn_error', message: 'provider timeout' }),
    createdAt,
  });
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'm1', role: 'user', content: 'Check the repo', createdAt: 10 },
      failure('m2', 11),
      { id: 'm3', role: 'user', content: 'Open the pull request', createdAt: 12 },
      failure('m4', 13),
    ],
  });
  await page.goto('/app');
  await expect(page.getByTestId('chief-turn-error')).toHaveCount(2);
  const alerts = page.getByRole('alert').filter({ has: page.getByTestId('chief-turn-error') });
  await expect(alerts.first().getByTestId('chief-turn-retry')).toHaveCount(0);
  await expect(alerts.last().getByTestId('chief-turn-retry')).toBeVisible();
});
