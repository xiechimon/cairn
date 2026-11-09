import { expect, test } from '@playwright/test';

test('thread review diffs remain available after project history retirement', async ({ page }) => {
  await page.goto('/app?scenario=home-c&thread=home-c-review');
  await page.getByTestId('side-chat-changes').click();
  const diff = page.getByTestId('side-chat-changes-view');
  await expect(diff.locator('.doc-file-row')).toContainText('README.md');
  await expect(diff.getByTestId('doc-pane')).toBeVisible();
});

for (const scenario of ['r2-24', 'prj-local-files']) {
  test(`project history is retired while file selection and tasks still work: ${scenario}`, async ({ page }) => {
    const commitRequests: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/projects\/[^/]+\/commits/.test(request.url())) commitRequests.push(request.url());
    });
    await page.goto(`/app/project/ZAQczKCu0MOAzC1ZqcFlX/files?scenario=${scenario}`);
    await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: '历史', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-history-entry], [data-commit-detail]')).toHaveCount(0);
    await page.getByRole('button', { name: 'README.md', exact: true }).click();
    await expect(page.getByText('请选择一个文件查看')).toHaveCount(0);
    await page.getByRole('banner').getByRole('tab', { name: '任务', exact: true }).click();
    await expect(page.getByTestId('task-row')).toHaveCount(2);
    expect(commitRequests).toEqual([]);
  });
}
