import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

const AGENT_TAB = '/app?scenario=101';

const settingsView = (page: Page) => page.getByRole('heading', { name: 'Coordinator 设置' });

test('back button works: click returns to the home conversation (#811)', async ({ page }) => {
  await page.goto(AGENT_TAB);
  await expect(settingsView(page)).toBeVisible();
  await page.getByRole('button', { name: '返回' }).click();
  await expect(settingsView(page)).toBeHidden();
  await expect(page.getByTestId('home-c')).toBeVisible();
});
const CHARTER_TAB = '/app?scenario=102';

async function openCharterDialog(page: Page) {
  await page.goto(CHARTER_TAB);
  await page.getByRole('button', { name: '编辑' }).click();
  const dialog = page.getByRole('dialog', { name: '编辑章程' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('charter edit opens the DialogShell editor with the r5 captured fields', async ({ page }) => {
  const dialog = await openCharterDialog(page);
  await expect(dialog).toHaveAttribute('aria-label', '编辑章程');

  await expect(dialog.getByRole('textbox')).toHaveAttribute(
    'placeholder',
    '长期指令：模型路由规则（何种任务使用何种模型）、优先级、偏好…',
  );
  await expect(dialog.getByRole('button', { name: '取消' })).toHaveText('取消');
  await expect(dialog.getByRole('button', { name: '保存章程' })).toHaveText('保存章程');
});

test('charter dialog family law: X, Escape, `取消` and backdrop dismiss', async ({ page }) => {
  let dialog = await openCharterDialog(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();

  dialog = await openCharterDialog(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  dialog = await openCharterDialog(page);
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();

  dialog = await openCharterDialog(page);
  await dialog.getByText('编辑章程').click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(dialog).toBeHidden();
});

test('fixture charter save closes the dialog (accept law)', async ({ page }) => {
  const dialog = await openCharterDialog(page);
  await dialog.getByRole('textbox').fill('优先派给 r3-builder。');
  await dialog.getByRole('button', { name: '保存章程' }).click();
  await expect(dialog).toBeHidden();
});

test('watches empty-state card is centered and growth-proof (#772)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn.locale', 'en');
    localStorage.setItem('cairn-locale', 'en');
    localStorage.setItem('cairn-theme', 'light');
  });

  for (const [scenario, copy] of [['104', /Nothing being watched yet/]] as const) {
    await page.goto(`/app?scenario=${scenario}`);
    const card = page.getByText(copy);
    await expect(card).toBeVisible();
    const geo = await card.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        centered: cs.justifyContent === 'center',
        contained: el.scrollHeight <= Math.ceil(r.height) + 1,
      };
    });
    expect(geo.centered).toBe(true);
    expect(geo.contained).toBe(true);
  }
});

test('模型与 Runner tab is one work-routing row: no Agent or dispatch leftovers (#903+#1260)', async ({
  page,
}) => {
  await page.goto(AGENT_TAB);
  await expect(page.getByRole('tab', { name: '模型与 Runner' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: 'Agent' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '派发方式' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '派发方式' })).toHaveCount(0);

  const row = page.getByTestId('chief-routing-row');
  await expect(row).toBeVisible();
  await expect(row).toContainText('模型与 Runner');
  await expect(row).toContainText('跟随 coordinator 路由规则');
  await expect(page.getByRole('button', { name: '未设置' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '压缩模型' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Runner', exact: true })).toHaveCount(0);
});
