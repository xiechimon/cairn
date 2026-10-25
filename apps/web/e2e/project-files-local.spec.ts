import { expect, test } from '@playwright/test';

const LOCAL = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-local-files';
const HOSTED = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24';
const OLD_DISABLE_LINE = '本地仓库项目暂不支持在线浏览文件';
const LOCAL_README_LINE = '本地仓库：用户本机既有 git 工作树仓，Files tab 直读工作树 HEAD。';

test('local project: files tab ungated, FilesPane renders (branch chip/file rows/history seg)', async ({
  page,
}) => {
  await page.goto(LOCAL);
  const filesTab = page.getByRole('banner').getByRole('tab', { name: '文件' });
  await expect(filesTab).toBeEnabled();

  await expect(page.getByText('trunk', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '历史', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
  await expect(page.getByText('请选择一个文件查看')).toBeVisible();

  await expect(page.getByText(OLD_DISABLE_LINE)).toHaveCount(0);
});

test('local project: file click → viewer content; history seg → commit rows', async ({ page }) => {
  await page.goto(LOCAL);
  const row = page.getByRole('button', { name: 'README.md', exact: true });
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText(LOCAL_README_LINE)).toBeVisible();
  await page.getByRole('tab', { name: '历史', exact: true }).click();
  await expect(page.getByText('init local-repo')).toBeVisible();
  await expect(page.getByText('local-user')).toBeVisible();
});

test('local project: tasks tab clickable and round-trips', async ({ page }) => {
  await page.goto(LOCAL);
  const banner = page.getByRole('banner');
  await banner.getByRole('tab', { name: '任务' }).click();
  await expect(page.getByTestId('task-row')).toHaveCount(2);
  await banner.getByRole('tab', { name: '文件' }).click();
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
});

test('contrast face: hosted project files tab works as usual (r2-24)', async ({ page }) => {
  await page.goto(HOSTED);
  const filesTab = page.getByRole('banner').getByRole('tab', { name: '文件' });
  await expect(filesTab).toBeEnabled();
  await expect(page.getByRole('tab', { name: '历史', exact: true })).toBeVisible();
  await expect(page.getByText(OLD_DISABLE_LINE)).toHaveCount(0);
});
