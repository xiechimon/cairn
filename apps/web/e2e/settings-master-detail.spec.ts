import { expect, type Locator, type Page, test } from '@playwright/test';

const MACHINES = '/app/settings/machines?scenario=machines-master-detail';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });
const items = (page: Page) => settings(page).getByTestId('machine-item');
const detail = (page: Page) => settings(page).getByTestId('machine-detail');

test('the breadcrumb is the only page title: no second heading repeats it', async ({ page }) => {
  await page.goto(MACHINES);
  await expect(settings(page).getByTestId('settings-head')).toHaveText('Runner');
  await expect(settings(page).getByRole('heading', { name: 'Runner', exact: true })).toHaveCount(1);
  await expect(settings(page).getByTestId('page-topbar')).toHaveCount(0);
  await expect(settings(page).getByTestId('settings-head')).toContainText('Runner');
});

test('other sections keep one heading for the page, the breadcrumb', async ({ page }) => {
  for (const [section, label] of [
    ['providers', '模型服务'],
    ['routing', '用量与连接'],
    ['skills', '技能'],
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
  await expect(settings(page).locator('[data-settings-result="appearance"]').first()).toBeVisible();
});

test('the slash key is no longer a shortcut: it types a slash into the search like any character', async ({
  page,
}) => {
  await page.goto(MACHINES);
  const search = settings(page).getByLabel('搜索设置');
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
  await page.goto('/app/settings/providers?scenario=providers-fleet');
  const name = settings(page).getByLabel('名称');
  await name.fill('');
  await page.keyboard.type('a/b');
  await expect(name).toHaveValue('a/b');
  await expect(name).toBeFocused();
});

test('machines are single-column rows: name, then status, runtime and capability links; switch and menu on the right', async ({
  page,
}) => {
  await page.goto(MACHINES);
  await expect(items(page)).toHaveCount(3);
  await expect(detail(page)).toHaveCount(0);
  await expect(settings(page).getByTestId('machine-toggle').first()).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  const host = items(page).filter({ hasText: 'omarchy' });
  await expect(host.locator('[data-orchestration="host"]')).toHaveText('Coordinator 主机');
  await expect(host.getByTestId('machine-item-status')).toHaveText('在线');
  await expect(host.getByTestId('machine-open-runtime')).toContainText('运行时');
  await expect(host.getByTestId('machine-accept-toggle')).toBeVisible();
  await expect(host.getByTestId('machine-menu')).toBeVisible();
  await expect(
    items(page).filter({ hasText: 'old-laptop' }).getByTestId('machine-item-status'),
  ).toHaveText('离线');
  await expect(
    items(page).filter({ hasText: 'build-box' }).getByTestId('machine-item-status'),
  ).toHaveText('登录已过期');
  await expect(settings(page).getByTestId('machine-list').locator('svg[fill^="#"]')).toHaveCount(0);
  await expect(settings(page).getByTestId('settings-checked')).toHaveCount(0);

  await items(page).filter({ hasText: 'old-laptop' }).getByTestId('machine-toggle').click();
  await expect(page).toHaveURL(/machine=md-old-laptop/);
  await expect(items(page).filter({ hasText: 'old-laptop' })).toHaveAttribute(
    'data-expanded',
    'true',
  );
  await expect(items(page).filter({ hasText: 'omarchy' })).toHaveAttribute(
    'data-expanded',
    'false',
  );
  await expect(detail(page)).toHaveCount(1);
  await items(page).filter({ hasText: 'old-laptop' }).getByTestId('machine-toggle').click();
  await expect(detail(page)).toHaveCount(0);
});

test('expansion sections: runtimes, each row a label and description with the control on the right', async ({
  page,
}) => {
  await page.goto(MACHINES);
  await items(page).filter({ hasText: 'omarchy' }).getByTestId('machine-toggle').click();
  const pane = detail(page);
  for (const name of ['运行时']) {
    await expect(pane.getByRole('heading', { name, exact: true })).toBeVisible();
  }

  const row = pane.locator('[data-testid="provider-row"][data-runtime="claude-code"]');
  await expect(row).toContainText('Claude Code');
  await expect(row).toContainText('2.1.316');
  await expect(row.locator('svg[fill^="#"]')).toHaveCount(0);
});

test('the runtime link opens the row and an offline row says when it was last online and freezes its settings', async ({
  page,
}) => {
  await page.goto(MACHINES);
  const old = items(page).filter({ hasText: 'old-laptop' });
  await expect(old.getByTestId('machine-last-seen')).toContainText('最后在线');
  await old.getByTestId('machine-open-runtime').click();
  await expect(old).toHaveAttribute('data-expanded', 'true');
  const pane = detail(page);
  await expect(pane.getByTestId('machine-offline-hint')).toContainText('重新连接 old-laptop');
  const accept = old.getByTestId('machine-accept-toggle');
  const runtime = pane.getByTestId('provider-toggle').first();
  for (const control of [accept, runtime]) {
    await expect(control).toBeDisabled();
    await expect(control).toHaveAttribute('aria-disabled', 'true');
  }
  const trackOf = (el: Locator) => el.evaluate((node) => getComputedStyle(node).backgroundColor);
  const off = await trackOf(pane.getByTestId('provider-toggle').nth(1));
  expect(await trackOf(accept)).toBe(off);
  expect(await trackOf(runtime)).toBe(off);
  const onlineAccept = items(page).filter({ hasText: 'omarchy' }).getByTestId('machine-accept-toggle');
  await expect(onlineAccept).toBeEnabled();
  await expect(onlineAccept).toBeChecked();
  await expect(accept).toBeChecked();
  expect(await trackOf(onlineAccept)).not.toBe(await trackOf(accept));
  await expect(pane.getByTestId('machine-recover')).toContainText('重新启动');
  await expect(pane.getByTestId('machine-recover').locator('code')).toContainText('start');
});

test('expired login explains how to bring the machine back, with the command as code', async ({
  page,
}) => {
  await page.goto(MACHINES);
  await items(page).filter({ hasText: 'build-box' }).getByTestId('machine-toggle').click();
  const warning = detail(page).getByTestId('claude-login-warning');
  await expect(warning).toHaveAttribute('data-login', 'expired');
  await expect(warning.locator('code')).toHaveText('claude auth login');
});

test('at 375px the rows keep name, status and controls inside the panel and nothing scrolls sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${MACHINES}&machine=md-old-laptop`);
  await expect(items(page)).toHaveCount(3);
  await expect(detail(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const inner = await settings(page)
    .getByTestId('machines-scroll')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(inner).toBeLessThanOrEqual(0);
  const toggle = await items(page).first().getByTestId('machine-accept-toggle').boundingBox();
  const panel = await settings(page).getByTestId('settings-panel').boundingBox();
  expect((toggle?.x ?? 0) + (toggle?.width ?? 0) <= (panel?.x ?? 0) + (panel?.width ?? 0)).toBe(true);
});

test('the old machine detail URL lands on the machine inside settings', async ({ page }) => {
  await page.goto('/app/resources/machines/md-old-laptop?scenario=machines-master-detail');
  await expect(page).toHaveURL(
    /\/app\/settings\/machines\?scenario=machines-master-detail&machine=md-old-laptop$/,
  );
  await expect(items(page).filter({ hasText: 'old-laptop' })).toHaveAttribute(
    'data-expanded',
    'true',
  );
});
