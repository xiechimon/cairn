import { expect, type Page, test } from '@playwright/test';

const drawer = (page: Page) => page.locator('.chief-drawer');
const fab = (page: Page) => page.locator('.chief-fab');
const minimize = (page: Page) => drawer(page).getByRole('button', { name: '最小化' });

test('probe: who is visibility:hidden at the focus() call', async ({ page }) => {
  await page.goto('/app?scenario=chief-scroll-long');
  await expect(drawer(page)).toBeVisible();

  await minimize(page).click();
  await expect(drawer(page)).toBeHidden();

  await page.evaluate(() => {
    const w = window as any;
    w.__focusCalls = [];
    const orig = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args: any[]) {
      const walk: string[] = [];
      let n: Element | null = this;
      while (n && n !== document.documentElement) {
        const vis = getComputedStyle(n).visibility;
        if (vis === 'hidden') {
          walk.push(
            `${n.tagName}.${(n.className || '').toString().slice(0, 50)} vis=hidden` +
              ` hiddenAttr=${n.hasAttribute('hidden')}` +
              ` animations=${n.getAnimations({ subtree: false }).length}` +
              ` animNames=${n
                .getAnimations({ subtree: false })
                .map((a) => (a as CSSAnimation).animationName)
                .join(',')}`,
          );
        }
        n = n.parentElement;
      }
      w.__focusCalls.push({
        t: Math.round(performance.now()),
        tag: this.tagName,
        walk,
      });
      return orig.apply(this, args as any);
    };
  });

  await fab(page).click();
  await expect(drawer(page)).toBeVisible();
  await page.waitForTimeout(800);

  const calls = await page.evaluate(() => (window as any).__focusCalls);
  console.log('FOCUS CALLS:', JSON.stringify(calls, null, 1));
});
