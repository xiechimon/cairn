import { expect, type Page, test } from '@playwright/test';

/** Same-origin responses get ACAO so the sandboxed frame can load the app. */
const allowSandboxedSubresources = (page: Page, baseURL: string) =>
  page.route(`${baseURL}/**`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'access-control-allow-origin': '*' },
    });
  });

/** In-frame collector: addInitScript runs in every frame, including the
 *  opaque-origin sandbox where page-level pageerror events are not
 *  observable from the parent. Capture=true also sees resource errors. */
const collectErrors = () => {
  const w = window as unknown as { __bootErrors?: string[] };
  w.__bootErrors = [];
  window.addEventListener(
    'error',
    (event) => {
      w.__bootErrors?.push(event.message || `resource:${String(event.target)}`);
    },
    true,
  );
};

const openSandboxedApp = async (page: Page, baseURL: string) => {
  await allowSandboxedSubresources(page, baseURL as string);
  await page.addInitScript(collectErrors);
  await page.setContent(
    `<iframe id="sbx" sandbox="allow-scripts" src="${baseURL}/app" width="1280" height="800"></iframe>`,
  );
  return page.frameLocator('#sbx');
};

const frameErrors = (frame: ReturnType<Page['frameLocator']>) =>
  frame
    .locator('#root')
    .evaluate(() => (window as unknown as { __bootErrors?: string[] }).__bootErrors ?? []);

test('sandboxed iframe without allow-same-origin renders /app (no white screen)', async ({
  page,
  baseURL,
}) => {
  const frame = await openSandboxedApp(page, baseURL);

  // F1/F2/F4-F7: the boot survived — the React tree rendered into #root.
  await expect(frame.locator('#root')).not.toBeEmpty({ timeout: 20_000 });

  const probe = await frame.locator('#root').evaluate((root) => ({
    kids: root.childElementCount,
    textLen: document.body.innerText.length,
    lang: document.documentElement.lang,
    theme: root.closest('html')?.dataset.theme ?? null,
  }));
  expect(probe.kids).toBeGreaterThan(0);
  expect(probe.textLen).toBeGreaterThan(0);
  // Degraded defaults: the no-stored-value paths land on zh-CN + system dark.
  expect(probe.lang).toBe('zh-CN');
  expect(probe.theme).toBe('dark');
  expect((await frameErrors(frame)).filter((m) => m.includes('SecurityError'))).toEqual([]);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('sandboxed boot survives a persistence interaction (writes silently dropped)', async ({
  page,
  baseURL,
}) => {
  const frame = await openSandboxedApp(page, baseURL);
  await expect(frame.locator('#root')).not.toBeEmpty({ timeout: 20_000 });

  // F13: a persistence interaction in a dead-storage environment must be a
  // silent no-op, not a throw — toggle the sidebar collapse (the toggle
  // writes cairn.sidebar-collapsed on every click).
  await frame.locator('[aria-label="收起侧边栏"]').first().click();
  await expect(frame.locator('[aria-label="展开侧边栏"]').first()).toBeVisible();

  expect((await frameErrors(frame)).filter((m) => m.includes('SecurityError'))).toEqual([]);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
