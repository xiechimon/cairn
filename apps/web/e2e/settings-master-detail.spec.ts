import { expect, type Locator, type Page, test } from '@playwright/test';

const MACHINES = '/app/settings/machines?scenario=machines-master-detail';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const items = (page: Page) => settings(page).getByTestId('machine-item');
const detail = (page: Page) => settings(page).getByTestId('machine-detail');

test('the breadcrumb is the only page title: no second heading repeats it', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(settings(page).getByTestId('settings-head')).toHaveText('执行机');
  await expect(settings(page).getByRole('heading', { name: '执行机', exact: true })).toHaveCount(1);
  await expect(settings(page).getByTestId('page-topbar')).toHaveCount(0);
  await expect(settings(page).getByTestId('settings-head')).toContainText('执行机');
});

test('other sections keep one heading for the page, the breadcrumb', async ({ page }) => {
  for (const [section, label] of [
    ['skills', '技能'],
    ['mcp', '应用'],
  ] as const) {
    await page.goto(`/app/settings/${section}?scenario=providers-fleet`);
    await expect(settings(page).getByTestId('settings-head')).toHaveText(label);
    await expect(settings(page).getByRole('heading', { name: label, exact: true })).toHaveCount(1);
  }
});

test('search is quiet, shows no key hint, and typing with nothing focused goes into it', async ({
  page,
}) => {
  await page.goto(MACHINES);
  const search = settings(page).getByLabel('搜索设置');
  await expect(settings(page).getByTestId('settings-search').locator('kbd')).toHaveCount(0);
  await expect(search).not.toHaveAttribute('aria-keyshortcuts');
  const look = await search.evaluate((el) => {
    const css = getComputedStyle(el);
    return { border: css.borderTopWidth, bg: css.backgroundColor };
  });
  expect(look.border).toBe('0px');
  expect(look.bg).toBe('rgba(0, 0, 0, 0)');
  await expect(search).not.toBeFocused();
  await page.keyboard.type('color');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('color');
  await expect(settings(page).getByTestId('settings-search-results')).toBeVisible();
  await expect(settings(page).locator('[data-settings-result="account"]').first()).toBeVisible();
});

test('the slash key is no longer a shortcut: it types a slash into the search like any character', async ({
  page,
}) => {
  await page.goto(MACHINES);
  const search = settings(page).getByLabel('搜索设置');
  await expect(search).toBeVisible();
  await page.keyboard.press('/');
  await expect(search).toHaveValue('/');
});

test('IME composition started with nothing focused lands in the search', async ({ page }) => {
  await page.goto(MACHINES);
  const search = settings(page).getByLabel('搜索设置');
  const client = await page.context().newCDPSession(page);
  await expect(search).not.toBeFocused();
  await client.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Process',
    code: 'KeyJ',
    windowsVirtualKeyCode: 229,
  });
  await expect(search).toBeFocused();
  await client.send('Input.imeSetComposition', { text: 'ji', selectionStart: 2, selectionEnd: 2 });
  await client.send('Input.insertText', { text: '机' });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Process',
    code: 'KeyJ',
    windowsVirtualKeyCode: 229,
  });
  await expect(search).toHaveValue('机');
  await expect(settings(page).locator('[data-settings-result="machines"]').first()).toBeVisible();
});

test('typing while a menu is open in settings does not move focus to the search', async ({
  page,
}) => {
  await page.goto('/app/settings/account?scenario=providers-fleet');
  const search = settings(page).getByLabel('搜索设置');
  const trigger = settings(page).getByRole('combobox', { name: '语言' });
  await trigger.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('x');
  await expect(search).not.toBeFocused();
  await expect(search).toHaveValue('');
});

const ringOf = (locator: Locator) =>
  locator.evaluate((el) => {
    const css = getComputedStyle(el);
    const shadow = css.boxShadow.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?/g, '').trim();
    const probe = document.createElement('div');
    probe.style.color = 'var(--focus-ring)';
    document.body.append(probe);
    const focusRing = getComputedStyle(probe).color;
    probe.remove();
    return {
      outline: css.outlineStyle,
      shadow: shadow === '' ? 'none' : shadow,
      focusBorder: css.borderTopColor === focusRing,
    };
  });

test('search turns the pill border to the focus ring while focused, and Esc clears and blurs it', async ({
  page,
}) => {
  await page.goto(MACHINES);
  const search = settings(page).getByLabel('搜索设置');
  const pill = settings(page).getByTestId('settings-search');
  expect(await ringOf(pill)).toMatchObject({ shadow: 'none', focusBorder: false });
  await search.focus();
  await expect(search).toBeFocused();
  await expect.poll(() => ringOf(pill)).toMatchObject({ shadow: 'none', focusBorder: true });
  const focusedInput = await ringOf(search);
  expect(focusedInput.outline).toBe('none');
  expect(focusedInput.shadow).toBe('none');
  await page.keyboard.type('机');
  await page.keyboard.press('Escape');
  await expect(search).not.toBeFocused();
  await expect(search).toHaveValue('');
  await expect(settings(page)).toBeVisible();
  await expect.poll(() => ringOf(pill)).toMatchObject({ shadow: 'none', focusBorder: false });
  const idleInput = await ringOf(search);
  expect(idleInput.outline).toBe('none');
  expect(idleInput.shadow).toBe('none');
});

test('Esc during IME composition leaves the search query and focus alone', async ({ page }) => {
  await page.goto(MACHINES);
  const search = settings(page).getByLabel('搜索设置');
  await search.focus();
  await page.keyboard.type('机');
  await search.evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(search).toHaveValue('机');
  await expect(search).toBeFocused();
  await expect(settings(page)).toBeVisible();
});

test('typing inside another settings field does not steal focus', async ({ page }) => {
  await page.goto('/app/settings/routing?scenario=providers-fleet');
  const name = settings(page).getByLabel('名称');
  await name.fill('');
  await page.keyboard.type('a/b');
  await expect(name).toHaveValue('a/b');
  await expect(name).toBeFocused();
});

test('machines show only name, default, system, online status and menu, including old deep links', async ({
  page,
}) => {
  await page.goto(MACHINES);
  await expect(items(page)).toHaveCount(3);
  await expect(detail(page)).toHaveCount(0);
  await expect(settings(page).getByTestId('machine-toggle')).toHaveCount(0);

  const host = items(page).filter({ hasText: 'omarchy' });
  await expect(host.getByTestId('machine-item-status')).toHaveText('在线');
  await expect(host.getByTestId('machine-open-runtime')).toHaveCount(0);
  await expect(host.getByTestId('machine-open-capabilities')).toHaveCount(0);
  await expect(host.getByRole('switch')).toHaveCount(0);
  await expect(host.getByTestId('machine-menu')).toBeVisible();
  await expect(host.getByTestId('machine-os')).toHaveText('Linux');
  await expect(
    items(page).filter({ hasText: 'old-laptop' }).getByTestId('machine-item-status'),
  ).toHaveText('离线');
  const oldDaemon = items(page).filter({ hasText: 'old-laptop' });
  await expect(oldDaemon.getByTestId('machine-os')).toHaveText('系统未知');
  await expect(
    items(page).filter({ hasText: 'build-box' }).getByTestId('machine-item-status'),
  ).toHaveText('在线');
  await expect(settings(page).getByTestId('machine-list').locator('svg[fill^="#"]')).toHaveCount(0);
  await expect(settings(page).getByTestId('settings-checked')).toHaveCount(0);

  await oldDaemon.getByTestId('machine-item-name').click();
  await expect(detail(page)).toHaveCount(0);
  await page.goto(`${MACHINES}&machine=md-old-laptop`);
  await expect(items(page)).toHaveCount(3);
  await expect(detail(page)).toHaveCount(0);
  await expect(settings(page).getByTestId('machine-agent-access')).toHaveCount(0);
  await expect(settings(page).getByTestId('provider-row')).toHaveCount(0);
});

test('at 375px the rows keep name, status and controls inside the panel and nothing scrolls sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${MACHINES}&machine=md-old-laptop`);
  await expect(items(page)).toHaveCount(3);
  await expect(detail(page)).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const inner = await settings(page)
    .getByTestId('machines-scroll')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(inner).toBeLessThanOrEqual(0);
  const toggle = await items(page).first().getByTestId('machine-menu').boundingBox();
  const panel = await settings(page).getByTestId('settings-panel').boundingBox();
  expect((toggle?.x ?? 0) + (toggle?.width ?? 0) <= (panel?.x ?? 0) + (panel?.width ?? 0)).toBe(true);
});

test('the old machine detail URL lands on the simplified list inside settings', async ({ page }) => {
  await page.goto('/app/resources/machines/md-old-laptop?scenario=machines-master-detail');
  await expect(page).toHaveURL(
    /\/app\/settings\/machines\?scenario=machines-master-detail&machine=md-old-laptop$/,
  );
  await expect(items(page).filter({ hasText: 'old-laptop' })).toBeVisible();
  await expect(detail(page)).toHaveCount(0);
});
