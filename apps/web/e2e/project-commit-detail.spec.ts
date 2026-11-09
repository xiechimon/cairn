import { expect, test } from '@playwright/test';

test('thread review diffs remain available after project files retirement', async ({ page }) => {
  await page.goto('/app?scenario=home-c&thread=home-c-review');
  await page.getByTestId('side-chat-changes').click();
  const diff = page.getByTestId('side-chat-changes-view');
  await expect(diff.locator('.doc-file-row')).toContainText('README.md');
  await expect(diff.getByTestId('doc-pane')).toBeVisible();
});

for (const scenario of ['r2-24', 'prj-local-tasks']) {
  test(`project tasks make no browsing requests: ${scenario}`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/projects\/[^/]+\/(tree|file|commits)(?:[/?]|$)/.test(request.url())) requests.push(request.url());
    });
    await page.goto(`/app/project/ZAQczKCu0MOAzC1ZqcFlX/tasks?scenario=${scenario}`);
    await expect(page.getByTestId('task-row')).toHaveCount(2);
    await expect(page.getByRole('tab', { name: '文件', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '历史', exact: true })).toHaveCount(0);
    expect(requests).toEqual([]);
  });
}

for (const query of ['', '?tab=files', '?tab=tasks']) {
  test(`old files entry exits to the home: ${query || 'no query'}`, async ({ page }) => {
    const requests: string[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 500, json: { error: 'unavailable' } }));
    page.on('request', (request) => {
      if (/\/api\/projects\/[^/]+\/(tree|file|commits)(?:[/?]|$)/.test(request.url())) requests.push(request.url());
    });
    await page.goto(`/app/project/retired/files${query}`);
    await expect(page).toHaveURL('/app');
    await expect(page.locator('.prj-files, [data-tree-entry]')).toHaveCount(0);
    expect(requests).toEqual([]);
  });
}
