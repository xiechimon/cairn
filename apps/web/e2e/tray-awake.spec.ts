import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

async function openTray(page: Page, locale: 'en' | 'zh' = 'en', path = '/tray?scenario=home-c', platform: 'mac' | 'linux' = 'mac') {
  await page.setViewportSize({ width: 320, height: 650 });
  await page.addInitScript(({ language, platform }) => {
    localStorage.setItem('cairn.locale', language);
    Object.defineProperty(navigator, 'userAgent', { value: platform === 'mac' ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' : 'Mozilla/5.0 (X11; Linux x86_64)' });
    const state = { runner: 'off', keepAwake: 'system', lidClosedAvailable: false, accent: null };
    const fixture = {
      state,
      calls: [] as string[],
      hidden: 0,
      listener: (_next: typeof state) => {},
    };
    const w = window as unknown as { cairnDesktop: unknown; trayFixture: typeof fixture };
    w.trayFixture = fixture;
    w.cairnDesktop = { tray: {
      state: async () => fixture.state,
      subscribe: (listener: typeof fixture.listener) => { fixture.listener = listener; return () => {}; },
      onOpened: () => () => {},
      setKeepAwake: (mode: string) => fixture.calls.push(mode),
      setRunner: async () => {}, resize: () => {}, publish: () => {}, open: () => {}, quit: () => {},
      hide: () => { fixture.hidden++; },
    } };
  }, { language: locale, platform });
  await page.goto(path);
}

test('tray keep-awake discloses inline and returns focus without dismissing', async ({ page }, testInfo) => {
  await openTray(page);
  const tile = page.getByRole('button', { name: 'Stay awake' });
  await expect(tile).toHaveAttribute('aria-expanded', 'false');
  await expect(tile).toHaveAccessibleDescription('Let the screen sleep. Stay awake while tasks run');
  await page.screenshot({ path: testInfo.outputPath('tray-en-collapsed.png') });
  await tile.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tile).toHaveAttribute('aria-expanded', 'true');
  const lid = page.getByRole('radio', { name: /Keep running with the lid closed/ });
  await expect(lid).toBeDisabled();
  await expect(page.getByText('Requires AC power')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tray-en-expanded.png') });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Keep the screen on' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Let the screen sleep' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Keep the screen on' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tile).toBeFocused();
  await expect(tile).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(tile).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(tile).toBeFocused();
  await expect(tile).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as unknown as { trayFixture: { hidden: number } }).trayFixture.hidden)).toBe(1);
});

test('tray keeps the confirmed mode until the host publishes', async ({ page }) => {
  await openTray(page);
  const tile = page.getByRole('button', { name: 'Stay awake' });
  await expect(tile).toContainText('Let the screen sleep');
  await tile.click();
  await page.getByRole('radio', { name: 'Keep the screen on' }).click();
  await expect(tile).toHaveAttribute('aria-expanded', 'false');
  await expect(tile).not.toBeFocused();
  await expect(tile).toContainText('Let the screen sleep');
  await expect.poll(() => page.evaluate(() => (window as unknown as { trayFixture: { calls: string[] } }).trayFixture.calls)).toEqual(['screen-on']);
  await page.evaluate(() => {
    const fixture = (window as unknown as { trayFixture: { state: { keepAwake: string }; listener: (state: unknown) => void } }).trayFixture;
    fixture.state.keepAwake = 'screen-on';
    fixture.listener({ ...fixture.state });
  });
  await expect(tile).toContainText('Keep the screen on');
  await tile.click();
  await tile.focus();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(tile).toHaveAttribute('aria-expanded', 'false');
  await expect(tile).not.toBeFocused();
});

test('tray updates power availability in Chinese and renders the computer display name', async ({ page }, testInfo) => {
  await mockLive(page, {
    threads: [], messages: [], machines: [{
      id: 'mac-1', name: 'registered-host', kind: 'remote', online: true,
      capabilities: { hostname: 'registered-host', computerName: 'Studio Mac' },
      running: [{ threadId: 'task-1', title: 'Review the build', startedAt: Date.now() }],
      queued: [], strain: [],
    }],
  });
  await openTray(page, 'zh', '/tray');
  await expect(page.getByRole('region', { name: 'Studio Mac' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Studio Mac' })).toBeVisible();
  const tile = page.getByRole('button', { name: '保持唤醒' });
  await tile.click();
  const lid = page.getByRole('radio', { name: '合盖继续运行' });
  await expect(lid).toBeDisabled();
  await expect(page.getByText('需要接通电源')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tray-zh-battery.png') });
  await page.evaluate(() => {
    const fixture = (window as unknown as { trayFixture: { state: { keepAwake: string; lidClosedAvailable: boolean }; listener: (state: unknown) => void } }).trayFixture;
    fixture.state.keepAwake = 'lid-closed';
    fixture.state.lidClosedAvailable = true;
    fixture.listener({ ...fixture.state });
  });
  await expect(tile).toHaveAttribute('aria-expanded', 'true');
  await expect(tile).toContainText('合盖继续运行');
  await expect(lid).toBeEnabled();
  await expect(lid).toBeChecked();
  await expect(page.getByText('需要接通电源')).toHaveCount(0);
});

test('non-Mac tray omits the unavailable lid-closed option', async ({ page }) => {
  await openTray(page, 'en', '/tray?scenario=home-c', 'linux');
  await page.getByRole('button', { name: 'Stay awake' }).click();
  await expect(page.getByRole('radio', { name: /Keep running with the lid closed/ })).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(2);
});
