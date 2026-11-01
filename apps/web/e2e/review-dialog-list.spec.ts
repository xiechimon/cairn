import { expect, test } from '@playwright/test';

async function openReview(page: import('@playwright/test').Page) {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=review-dialog-choice');
  const dialog = page.locator('[role="dialog"][aria-label="AI 审核"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('reviewers and the three-perspective run share one list with a check on the pick', async ({
  page,
}) => {
  const dialog = await openReview(page);
  const options = dialog.getByRole('option');
  await expect(options).toHaveCount(3);
  const reviewer = options.filter({ hasText: /^reviewer/ });
  await expect(reviewer).toHaveAttribute('aria-selected', 'true');
  await expect(reviewer).toContainText(/Other vendor|其他厂商/);
  await expect(options.filter({ hasText: /^builder/ })).toContainText(
    /same vendor as the plan author|与方案作者同厂商/,
  );
  await expect(dialog.getByPlaceholder('搜索 Agent…')).toHaveCount(0);
});

test('picking the same-vendor agent explains why it is not independent, picking three runs swaps the action', async ({
  page,
}) => {
  const dialog = await openReview(page);
  await dialog.getByRole('option').filter({ hasText: /^builder/ }).click();
  await expect(dialog.getByRole('status')).toBeVisible();
  await dialog.getByTestId('review-fanout-toggle').click();
  await expect(dialog.getByTestId('review-fanout-toggle')).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /three|三视角/ })).toBeVisible();
});
