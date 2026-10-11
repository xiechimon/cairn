import { expect, type Page, test } from '@playwright/test';

const drawer = (page: Page) => page.locator('.chief-drawer');
const fab = (page: Page) => page.locator('.chief-fab');
const minimize = (page: Page) => drawer(page).getByRole('button', { name: '最小化' });
const composer = (page: Page) => page.getByTestId('chief-composer-input');

async function settled(page: Page) {
  await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

test('probe: focus migration on reopen — instrument focus() + effect timing', async ({ page }) => {
  await page.goto('/app?scenario=chief-scroll-long');
  await settled(page);

  await page.evaluate(() => {
    const w = window as any;
    w.__log = [];
    const orig = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args: any[]) {
      const ta = this as HTMLTextAreaElement;
      const aside = document.querySelector('.chief-drawer')!;
      const detail: Record<string, unknown> = {
        t: Math.round(performance.now()),
        tag: this.tagName,
        testid: this.getAttribute?.('data-testid') ?? null,
        focusedAfter: null,
      };
      // async capture: serialize the aside's outerHTML + computed styles after paint
      detail.snapshot = {
        asideHiddenAttr: aside.hasAttribute('hidden'),
        asideStyleAttr: aside.getAttribute('style'),
        asideFullClass: aside.className,
        asideOuterStart: aside.outerHTML.slice(0, 600),
      };
      w.__log.push(detail);
      const r = orig.apply(this, args as any);
      w.__log[w.__log.length - 1].focusedAfter = document.activeElement === this;
      return r;
    };
  });

  await minimize(page).click();
  await expect(drawer(page)).toBeHidden();

  await fab(page).click();
  await expect(drawer(page)).toBeVisible();
  await page.waitForTimeout(1500);

  const log = await page.evaluate(() => (window as any).__log);
  console.log('FOCUS LOG:', JSON.stringify(log, null, 1));
  expect(log.length).toBeGreaterThan(0);
});
