import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`team attribution toggles persist independently in ${theme}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
    let coAuthorTrailer = true;
    let requestInstructorReview = false;
    const team = () => ({ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null, coAuthorTrailer, requestInstructorReview });
    await page.route('**/api/user/me', (route) => route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null } }));
    await page.route('**/api/projects?*', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/todos?*', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/teams', (route) => route.fulfill({ json: [team()] }));
    await page.route('**/api/teams/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const body = route.request().postDataJSON();
      if (body.coAuthorTrailer !== undefined) coAuthorTrailer = body.coAuthorTrailer;
      if (body.requestInstructorReview !== undefined) requestInstructorReview = body.requestInstructorReview;
      await route.fulfill({ json: team() });
    });
    await page.goto('/app/account');
    const trailer = page.getByRole('switch', { name: '人工共同作者署名' });
    const review = page.getByRole('switch', { name: '邀请任务发起人审阅' });
    await expect(trailer).toHaveAttribute('aria-checked', 'true');
    await expect(review).toHaveAttribute('aria-checked', 'false');
    await trailer.click();
    await expect(trailer).toHaveAttribute('aria-checked', 'false');
    await expect(review).toHaveAttribute('aria-checked', 'false');
    await review.click();
    await expect(review).toHaveAttribute('aria-checked', 'true');
    await page.reload();
    await expect(trailer).toHaveAttribute('aria-checked', 'false');
    await expect(review).toHaveAttribute('aria-checked', 'true');
  });
}
