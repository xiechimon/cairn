import { expect, test } from '@playwright/test';

test('thread review diffs remain available after project files retirement', async ({ page }) => {
  await page.goto('/app?scenario=home-c&thread=home-c-review');
  await page.getByTestId('side-chat-changes-toggle').click();
  await expect(page.getByTestId('side-chat-changes-toggle')).toContainText('README.md');
  await expect(page.getByTestId('side-chat-changes-body').locator('[data-kind]').first()).toBeVisible();
});

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
