import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

const AGENT_TAB = '/app?scenario=101';

const settingsView = (page: Page) => page.getByRole('heading', { name: '总管设置' });

test('back button works: click returns to the chief drawer (#811)', async ({ page }) => {
  await page.goto(AGENT_TAB);
  await expect(settingsView(page)).toBeVisible();
  await page.getByRole('button', { name: '返回' }).click();
  await expect(settingsView(page)).toBeHidden();
  await expect(page.getByRole('dialog', { name: '总管' })).toBeVisible();
});
const CHARTER_TAB = '/app?scenario=102';

async function openAgentDialog(page: Page) {
  await page.goto(AGENT_TAB);

  await page.getByRole('button', { name: '未设置' }).click();
  const dialog = page.getByRole('dialog', { name: '选择总管 Agent' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('agent row opens the `选择总管 Agent` dialog with search + canon default row', async ({
  page,
}) => {
  const dialog = await openAgentDialog(page);
  await expect(dialog).toHaveAttribute('aria-label', '选择总管 Agent');
  await expect(dialog.getByPlaceholder('搜索 Agent…')).toHaveAttribute(
    'placeholder',
    '搜索 Agent…',
  );
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await expect(dialog.getByRole('option')).toHaveText('r3-builder');
});

test('agent dialog search sits on the dialog body inset (#872 blast radius)', async ({ page }) => {
  const dialog = await openAgentDialog(page);

  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined),
  );
  const inset = await dialog.getByPlaceholder('搜索 Agent…').evaluate((el) => {
    const box = el.parentElement as HTMLElement;
    const body = box.closest('[data-testid="dialog-body"]') as HTMLElement;
    return box.getBoundingClientRect().left - body.getBoundingClientRect().left;
  });
  expect(inset).toBeCloseTo(20, 1);
});

test('agent dialog family law: X, Escape and backdrop dismiss; panel clicks do not', async ({
  page,
}) => {
  let dialog = await openAgentDialog(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();

  dialog = await openAgentDialog(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  dialog = await openAgentDialog(page);
  await dialog.getByText('选择总管 Agent').click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(dialog).toBeHidden();
});

test('agent dialog search filters the list; no match shows the empty row', async ({ page }) => {
  const dialog = await openAgentDialog(page);
  await dialog.getByPlaceholder('搜索 Agent…').fill('不存在');
  await expect(dialog.getByRole('option')).toHaveCount(0);
  await expect(dialog.getByText('没有匹配的 Agent')).toHaveText('没有匹配的 Agent');
  await dialog.getByPlaceholder('搜索 Agent…').fill('r3');
  await expect(dialog.getByRole('option')).toHaveCount(1);
});

test('fixture agent pick closes the dialog (accept law)', async ({ page }) => {
  const dialog = await openAgentDialog(page);
  await dialog.getByRole('option').click();
  await expect(dialog).toBeHidden();
});

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

test('empty-state card centered and growth-proof: memo matches watches (#772)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn.locale', 'en');
    localStorage.setItem('cairn-locale', 'en');
    localStorage.setItem('cairn-theme', 'light');
  });

  for (const [scenario, copy] of [
    ['103', /No Agent selected yet/],
    ['104', /Nothing being watched yet/],
  ] as const) {
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

test('Agent tab has no `派发方式` row: the settings slot was removed, neighbor decision faces intact (#903+#1260)', async ({ page }) => {
  await page.goto(AGENT_TAB);
  await expect(page.getByRole('heading', { name: '派发方式' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '派发方式' })).toHaveCount(0);

  await expect(page.getByRole('button', { name: '未设置' })).toHaveCount(1);
  await expect(page.getByTestId('chief-follows-agent')).toBeVisible();
  await expect(page.getByRole('button', { name: '压缩模型' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '机器', exact: true })).toHaveCount(0);
});
