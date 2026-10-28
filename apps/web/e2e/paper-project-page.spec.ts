import { expect, type Locator, type Page, test } from '@playwright/test';

const PROJ = '/app/project/ZAQczKCu0MOAzC1ZqcFlX';
const TASKS = `${PROJ}?scenario=prj-tasks`;
const EMPTY = `${PROJ}?scenario=r2-24b&tab=tasks`;
const LOCAL_FILES = `${PROJ}?scenario=prj-local-files`;

test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

function setTheme(page: Page, theme: 'light' | 'dark') {
  return page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
}

function resolveColor(page: Page, value: string) {
  return page.evaluate((v) => {
    const probe = document.createElement('span');
    probe.style.color = v;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, value);
}

function resolveBackground(page: Page, value: string) {
  return page.evaluate((v) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = v;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, value);
}

async function radiusCard(page: Page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--radius-card').trim(),
  );
}

function css(locator: Locator, prop: string) {
  return locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

for (const theme of ['light', 'dark'] as const) {
  test(`tasks: reading column, one card of 52px rows with status and meta (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await page.goto(TASKS);

    const col = page.getByTestId('page-col');
    await expect(col, 'T1').toBeVisible();
    expect((await col.boundingBox())?.width, 'T1').toBe(768);

    const list = page.locator('.prj-task-list');
    await expect(list, 'T2').toHaveClass(/settings-card/);
    await expect(list, 'T2').toHaveCSS('border-top-left-radius', await radiusCard(page));
    const rows = list.getByTestId('task-row');
    await expect(rows).toHaveCount(2);
    const faces = await rows.evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        return {
          h: el.getBoundingClientRect().height,
          bg: cs.backgroundColor,
          top: cs.borderTopWidth,
          bottom: cs.borderBottomWidth,
        };
      }),
    );
    expect(
      faces.map((f) => f.h),
      'T2',
    ).toEqual([52, 52]);
    expect(
      faces.map((f) => f.bg),
      'T2: rows carry no fill',
    ).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
    expect(
      faces.map((f) => [f.top, f.bottom]),
      'T2',
    ).toEqual([
      ['0px', '1px'],
      ['0px', '0px'],
    ]);

    const accent = await resolveColor(page, 'var(--card-button)');
    const ink3 = await resolveColor(page, 'var(--text-tertiary)');
    const ink = await resolveColor(page, 'var(--foreground)');
    await expect(rows.locator('[aria-hidden="true"].border-input'), 'T3').toHaveCount(0);
    const reviewStatus = rows.nth(0).getByTestId('task-status');
    await expect(reviewStatus, 'T3').toHaveText('审核');
    await expect(reviewStatus.locator('svg'), 'T3').toHaveCount(1);
    await expect(reviewStatus, 'T3').toHaveCSS('color', accent);
    const doneStatus = rows.nth(1).getByTestId('task-status');
    await expect(doneStatus, 'T3').toHaveText('已完成');
    await expect(doneStatus.locator('svg'), 'T3').toHaveCount(1);
    await expect(doneStatus, 'T3').toHaveCSS('color', ink3);

    const title = rows.nth(0).getByRole('link');
    await expect(title, 'T4').toHaveCSS('font-size', '13.5px');
    await expect(title, 'T4').toHaveCSS('color', ink);
    const meta = rows.nth(0).getByTestId('task-meta');
    await expect(meta, 'T4').toHaveText(/^#1 · .+前$/);
    await expect(meta, 'T4').toHaveCSS('font-size', '12px');
    await expect(meta, 'T4').toHaveCSS('color', ink3);

    await expect(rows.nth(1).getByRole('link'), 'T5').toHaveCSS('color', ink3);

    await page.locator('.prj-tasks-view-btn').nth(1).click();
    const card = page.getByTestId('task-card').first();
    await expect(card, 'G1').toHaveCSS('border-top-left-radius', await radiusCard(page));
    await expect(card.getByTestId('task-status'), 'G1').toHaveText('审核');
  });

  test(`tasks: empty state is the shared EmptyState (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    await page.goto(EMPTY);

    const empty = page.locator('.empty-state');
    await expect(empty.getByRole('heading', { name: '暂无内容' }), 'E1').toBeVisible();
    const media = empty.locator('[data-slot="empty-icon"]');
    await expect(media, 'E1').toHaveCount(1);
    expect(await css(media, 'background-color'), 'E1: no tinted tile').toBe('rgba(0, 0, 0, 0)');
    const create = empty.getByRole('button', { name: '新建任务' });
    await expect(create, 'E1').toHaveCount(1);
    expect((await create.boundingBox())?.height, 'E1').toBe(32);
    await expect(create, 'E1').toHaveCSS('border-top-left-radius', '8px');
  });

  test(`files: bleed body, picker face on the selected file, type scale (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await page.goto(LOCAL_FILES);

    await expect(page.getByTestId('page-col'), 'T1: 文件 keeps the bleed').toHaveCount(0);

    const placeholder = page.getByText('请选择一个文件查看');
    await expect(placeholder, 'F3').toHaveCSS('font-size', '13.5px');
    await expect(placeholder, 'F3').toHaveCSS('color', await resolveColor(page, 'var(--text-tertiary)'));

    const file = page.locator('[data-tree-entry="file"]', { hasText: 'README.md' });
    await file.click();
    await expect(file).toHaveAttribute('aria-current', 'true');
    await page.mouse.move(0, 0);
    await expect(file, 'F1').toHaveCSS('background-color', await resolveBackground(page, 'var(--card)'));
    await expect(file, 'F1: 1px ring').toHaveCSS('box-shadow', /0px 0px 0px 1px/);

    await page.locator('.prj-files-seg-tab', { hasText: '历史' }).click();
    const commit = page.locator('[data-history-entry="commit"]').first();
    await expect(commit.getByTestId('history-message'), 'F2').toHaveCSS('font-size', '13.5px');
    await expect(commit.getByTestId('history-meta'), 'F2').toHaveCSS('font-size', '12px');
    await commit.click();
    await expect(page.locator('[data-commit-detail="message"]'), 'F2').toHaveCSS(
      'font-size',
      '13.5px',
    );
    await expect(page.locator('[data-commit-detail="meta"]'), 'F2').toHaveCSS('font-size', '12px');
  });
}
