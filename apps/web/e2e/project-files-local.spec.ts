import { expect, test } from '@playwright/test';

// #1030（推翻 spec 12「Files tab 对 local 项目隐藏/禁用」的 out-of-scope）：
// local 项目 Files tab 开闸——读面走 server 目录解析分支（requireRepoReadDir
// 直读 localPath 工作树）。fixture 面 scenario=prj-local-files
// （project.repoKind='local'、projectTab='files'、branch='trunk'——local
// 仓默认分支任意，非恒 main）。失败方式钉扎：
// 1. 开闸失守回禁用 — files tab 钮必须可点、FilesPane 渲染（分支 chip +
//    历史 seg 钮 + 文件行），旧 disable 占位文案必须退役；
// 2. 查看器/历史空转 — 文件行点击 → viewer 出 fixture 内容；历史 seg →
//    提交行（分支 chip 值 = fixture branch）；
// 3. 单腿 tab — 任务 tab 必须可点且往返（开闸不等于把任务面关掉）；
// 4. 对照面：hosted 项目（r2-24）files tab 照常（零回归）。
// 不可达降级面（tree 404 + reason 分译文案）走 server vitest（project-local
// .test.ts F2/F3/F4）+ verify-cairn live 面——fixture 模式下 tree query 恒
// disabled（live=false），e2e 钉不到，不在本文件演。
// #946/#910 载体：topbar tab = banner scope 的 role=tab（与 pane 内 seg 钮
// 的 button 角色分离）；文件行 = role=button+文件名精确名；任务行 =
// task-row testid。

const LOCAL = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-local-files';
const HOSTED = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24';
const OLD_DISABLE_LINE = '本地仓库项目暂不支持在线浏览文件';
const LOCAL_README_LINE = '本地仓库：用户本机既有 git 工作树仓，Files tab 直读工作树 HEAD。';

test('local 项目：files tab 开闸，FilesPane 渲染（分支 chip/文件行/历史 seg）', async ({
  page,
}) => {
  await page.goto(LOCAL);
  const filesTab = page.getByRole('banner').getByRole('tab', { name: '文件' });
  await expect(filesTab).toBeEnabled();
  // 分支 chip = fixture branch（trunk），非硬编码 main
  await expect(page.getByText('trunk', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '历史', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
  await expect(page.getByText('请选择一个文件查看')).toBeVisible();
  // 旧 disable 占位文案退役（含 tab 钮 disabled 态）
  await expect(page.getByText(OLD_DISABLE_LINE)).toHaveCount(0);
});

test('local 项目：文件点击 → 查看器内容；历史 seg → 提交行', async ({ page }) => {
  await page.goto(LOCAL);
  const row = page.getByRole('button', { name: 'README.md', exact: true });
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText(LOCAL_README_LINE)).toBeVisible();
  await page.getByRole('tab', { name: '历史', exact: true }).click();
  await expect(page.getByText('init local-repo')).toBeVisible();
  await expect(page.getByText('local-user')).toBeVisible();
});

test('local 项目：任务 tab 可点且往返', async ({ page }) => {
  await page.goto(LOCAL);
  const banner = page.getByRole('banner');
  await banner.getByRole('tab', { name: '任务' }).click();
  await expect(page.getByTestId('task-row')).toHaveCount(2);
  await banner.getByRole('tab', { name: '文件' }).click();
  await expect(page.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
});

test('对照面：hosted 项目 files tab 照常（r2-24）', async ({ page }) => {
  await page.goto(HOSTED);
  const filesTab = page.getByRole('banner').getByRole('tab', { name: '文件' });
  await expect(filesTab).toBeEnabled();
  await expect(page.getByRole('tab', { name: '历史', exact: true })).toBeVisible();
  await expect(page.getByText(OLD_DISABLE_LINE)).toHaveCount(0);
});
