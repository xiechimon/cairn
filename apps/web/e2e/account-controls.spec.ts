import { expect, test } from '@playwright/test';
import { stubNotification } from './helpers.js';

declare global {
  interface Window {
    __probeMutated: boolean;
  }
}

const USER_NAME = 'Xmon Dai';

test('rename: header `编辑名称` enters edit mode prefilled and focused; Enter and save both submit (R1–R4)', async ({ page }) => {
  await page.goto('/app/account?scenario=13');
  const header = page.locator('.account-header');
  await expect(header.getByRole('heading', { name: USER_NAME, exact: true })).toBeVisible();

  await header.getByRole('button', { name: '编辑名称' }).click();
  const input = header.getByRole('textbox', { name: '名称' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(USER_NAME);

  await input.fill('改名之后');
  await input.press('Enter');
  await expect(header.getByRole('textbox')).toHaveCount(0);
  await expect(header.getByRole('heading', { name: '改名之后', exact: true })).toBeVisible();

  await header.getByRole('button', { name: '编辑名称' }).click();
  await expect(header.getByRole('textbox')).toHaveValue('改名之后');
  await header.getByRole('textbox').fill('再改一次');
  await header.getByRole('button', { name: '保存' }).click();
  await expect(header.getByRole('heading', { name: '再改一次', exact: true })).toBeVisible();
});

test('rename: Esc and cancel both discard the draft; empty or whitespace-only names do not submit (R5/R6)', async ({ page }) => {
  await page.goto('/app/account?scenario=13');
  const header = page.locator('.account-header');
  const heading = header.getByRole('heading', { name: USER_NAME, exact: true });
  const edit = header.getByRole('button', { name: '编辑名称' });

  await edit.click();
  await header.getByRole('textbox').fill('半路放弃');
  await header.getByRole('textbox').press('Escape');
  await expect(header.getByRole('textbox')).toHaveCount(0);
  await expect(heading).toBeVisible();

  await edit.click();
  await header.getByRole('textbox').fill('点了取消');
  await header.getByRole('button', { name: '取消' }).click();
  await expect(header.getByRole('textbox')).toHaveCount(0);
  await expect(heading).toBeVisible();

  await edit.click();
  await header.getByRole('textbox').fill('   ');
  await header.getByRole('textbox').press('Enter');
  await expect(header.getByRole('textbox')).toHaveCount(0);
  await expect(heading).toBeVisible();
});

test('rename live: submit sends PATCH /api/user/me, the new name survives reload, failure toast names the field (R7–R9)', async ({
  page,
}) => {

  let current = USER_NAME;
  let failPatch = false;
  const patchBodies: unknown[] = [];
  const userJson = () => ({ id: 'user-1', displayName: current, avatarUrl: null, type: 'user' });
  await page.route('**/api/user/me', (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { displayName?: string };
      patchBodies.push(body);
      if (failPatch) return route.fulfill({ status: 500, json: { error: 'boom' } });
      current = body.displayName ?? current;
      return route.fulfill({ json: userJson() });
    }
    return route.fulfill({ json: userJson() });
  });

  await page.goto('/app/account');
  const header = page.locator('.account-header');
  const rename = async (next: string) => {
    await header.getByRole('button', { name: '编辑名称' }).click();
    await header.getByRole('textbox').fill(next);
    await header.getByRole('textbox').press('Enter');
  };
  await expect(header.getByRole('heading', { name: USER_NAME, exact: true })).toBeVisible();
  await rename('落库名字');

  await expect.poll(() => patchBodies.length).toBe(1);
  expect(patchBodies[0]).toEqual({ displayName: '落库名字' });

  await expect(header.getByRole('heading', { name: '落库名字', exact: true })).toBeVisible();

  await page.reload();
  await expect(header.getByRole('heading', { name: '落库名字', exact: true })).toBeVisible();

  failPatch = true;
  await rename('坏名字');
  await expect.poll(() => patchBodies.length).toBe(2);
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('保存失败，请重试。');
  await expect(header.getByRole('heading', { name: '落库名字', exact: true })).toBeVisible();
  await expect(header.getByRole('heading', { name: '坏名字', exact: true })).toHaveCount(0);
});

test('switch: granted state can be turned off, the off state persists across reload, and it can be turned back on (S1/S2)', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');

  await page.reload();
  await expect(sw).toHaveAttribute('aria-checked', 'false');

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => window.__permCalls)).toBe(0);
  await page.reload();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
});

test('switch: denied state opens the preference panel + interception explainer, can be turned off, both states persist across reload (S3/S4)', async ({
  page,
}) => {
  await stubNotification(page, 'denied', 'denied');
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  const hint = page.locator('.account-notify-blocked');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(hint).toHaveCount(0);

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => window.__permCalls)).toBe(1);

  await expect(hint).toBeVisible();
  await expect(hint).toContainText('重新允许');
  await page.reload();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(hint).toBeVisible();

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(hint).toHaveCount(0);
  await page.reload();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

test('switch: default state fires the driver requestPermission, granted resolution lands and the on state persists (S5)', async ({
  page,
}) => {
  await stubNotification(page, 'default', 'granted');
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => window.__permCalls)).toBe(1);

  await page.reload();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
});

test('switch fixture face: scenario can freeze denied — starts off, clicking opens the interception explainer; 13 baselines stay on (S6)', async ({
  page,
}) => {

  await stubNotification(page, 'denied', 'denied');
  await page.goto('/app/account?scenario=13-notify-denied');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.account-notify-blocked')).toContainText('重新允许');

  await page.evaluate(() => localStorage.clear());
  await page.goto('/app/account?scenario=13');
  await expect(page.getByRole('switch', { name: '推送通知' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('probe: every control on the account page has an observable effect on click (P1, not just rename and switch)', async ({
  page,
}) => {
  await page.goto('/app/account?scenario=13');
  const col = page.getByTestId('page-col');

  const SELECTOR = 'button:not([role="radio"][aria-checked="true"]), [role="switch"], a[href]';
  const descriptors = await col
    .locator(SELECTOR)
    .evaluateAll((els) =>
      els.map((el) => ({

        role:
          el.getAttribute('role') ??
          (el.tagName === 'BUTTON' ? 'button' : el.tagName === 'A' ? 'link' : el.tagName.toLowerCase()),
        name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(),
      })),
    );

  expect(descriptors.map((d) => d.name)).toEqual(['编辑名称', '语言', '紧凑', '推送通知']);

  for (const d of descriptors) {

    await page.goto('/app/account?scenario=13');
    await col.evaluate((el) => {
      window.__probeMutated = false;
      new MutationObserver(() => {
        window.__probeMutated = true;
      }).observe(el, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    });
    const target = col.getByRole(d.role as 'button', { name: d.name, exact: true });
    await expect(target, `控件定位丢失: ${d.role}/${d.name}`).toHaveCount(1);
    await target.click();

    await expect
      .poll(() => page.evaluate(() => window.__probeMutated), {
        timeout: 2000,
        message: `假可供性: ${d.role}/${d.name} 点击后无可观察变化`,
      })
      .toBe(true);
  }
});
