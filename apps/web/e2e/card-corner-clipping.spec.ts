import { expect, type Locator, type Page, test } from '@playwright/test';
import { mockLive, PROJECT, TASK, THREAD } from './chief-home-mock';

interface CornerReport {
  cornerShape: string;
  clippedSides: string[];
}

async function cornerReport(locator: Locator): Promise<CornerReport> {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    const cornerShape = cs.getPropertyValue('corner-shape').trim();
    const layers =
      cs.boxShadow === 'none'
        ? []
        : cs.boxShadow.split(/,(?![^(]*\))/).map((layer) => layer.trim());
    const hasOuterRing = layers.some((layer) => {
      if (/\binset\b/.test(layer)) return false;
      const lengths = layer.replace(/^(?:rgba?|oklch|lab|lch|color)\([^)]*\)\s*/i, '').trim().split(/\s+/);
      const spread = Number.parseFloat(lengths[3] ?? '0');
      const blur = Number.parseFloat(lengths[2] ?? '0');
      return spread > 0 || blur > 0;
    });
    const clippedSides: string[] = [];
    if (hasOuterRing) {
      const rect = el.getBoundingClientRect();
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const pcs = getComputedStyle(parent);
        const pr = parent.getBoundingClientRect();
        if (pcs.overflowX !== 'visible') {
          if (rect.left - pr.left < 0.9) clippedSides.push(`left(${parent.tagName})`);
          if (pr.right - rect.right < 0.9) clippedSides.push(`right(${parent.tagName})`);
        }
        if (pcs.overflowY !== 'visible') {
          if (rect.top - pr.top < 0.9) clippedSides.push(`top(${parent.tagName})`);
          if (pr.bottom - rect.bottom < 0.9) clippedSides.push(`bottom(${parent.tagName})`);
        }
        parent = parent.parentElement;
      }
    }
    return { cornerShape, clippedSides };
  });
}

async function expectCleanCorners(locator: Locator, label: string) {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const report = await cornerReport(locator);
  expect(
    report.cornerShape === '' || report.cornerShape === 'round' || report.cornerShape === 'superellipse(1)',
    `${label} must use standard circular corners, got "${report.cornerShape}"`,
  ).toBe(true);
  expect(report.clippedSides, `${label} outer ring clipped by overflow ancestor`).toEqual([]);
}

async function setupBannerAndArtifact(page: Page) {
  const now = Date.now();
  await mockLive(page, { threads: [THREAD], messages: [], todos: [TASK], projects: [PROJECT] }, (path, route, json) => {
    if (path === '/api/teams/t1/antigravity-subscriptions') {
      return json([
        {
          id: 'ag-1',
          kind: 'antigravity-subscription',
          label: 'main-ag',
          hasToken: true,
          expiresAt: now - 3_600_000,
          enabled: true,
          createdAt: 1,
        },
      ]);
    }
    if (path === '/api/attachments/att-1.png') {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          'base64',
        ),
      });
    }
    return undefined;
  });
}

test('home login banner and artifact tab corners are neither skewed nor clipped by overflow ancestors', async ({
  page,
}) => {
  await setupBannerAndArtifact(page);
  await page.goto('/app?artifact=att-1.png&artifactName=pasted-image-1.png');
  await expectCleanCorners(page.getByTestId('antigravity-login-banner'), 'antigravity-login-banner');
  await expectCleanCorners(page.getByTestId('artifact-tab').first(), 'artifact-tab');
  await expectCleanCorners(page.locator('.chief-composer'), 'chief-composer');
});

test('common cards on home panels and settings have unclipped circular corners', async ({ page }) => {
  await page.goto('/app?scenario=home-c-machines&pane=machines');
  await expectCleanCorners(page.locator('[data-slot="list-card"]').first(), 'machines ListCard');
  await page.goto('/app/settings/account?scenario=01');
  await expectCleanCorners(page.locator('.settings-card').first(), 'SettingsCard');
});
