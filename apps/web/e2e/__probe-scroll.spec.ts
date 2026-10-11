import { expect, type Page, test } from '@playwright/test';

const drawer = (page: Page) => page.locator('.chief-drawer');
const fab = (page: Page) => page.locator('.chief-fab');
const minimize = (page: Page) => drawer(page).getByRole('button', { name: '最小化' });
const viewport = (page: Page) => page.getByTestId('chief-body');

async function settled(page: Page) {
  await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

test('probe: scrollTop timeline across minimize and reopen', async ({ page }) => {
  await page.goto('/app?scenario=chief-scroll-long');
  await settled(page);

  await page.evaluate(() => {
    const w = window as any;
    w.__scrolls = [];
    const vp = document.querySelector('[data-testid="chief-body"]')!;
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    Object.defineProperty(vp, 'scrollTop', {
      get() {
        return desc.get!.call(this);
      },
      set(v: number) {
        if (v !== desc.get!.call(this)) {
          w.__scrolls.push({
            t: Math.round(performance.now()),
            event: 'scrollTop-set',
            from: desc.get!.call(this),
            to: v,
            stack: new Error().stack?.split('\n').slice(1, 8).join(' | '),
          });
        }
        return desc.set!.call(this, v);
      },
      configurable: true,
    });
    const origScrollTo = vp.scrollTo.bind(vp);
    (vp as any).scrollTo = (...args: any[]) => {
      w.__scrolls.push({
        t: Math.round(performance.now()),
        event: 'scrollTo',
        args: JSON.parse(JSON.stringify(args)),
        stack: new Error().stack?.split('\n').slice(1, 8).join(' | '),
      });
      return origScrollTo(...args);
    };
    vp.addEventListener('scroll', () => {
      w.__scrolls.push({
        t: Math.round(performance.now()),
        top: vp.scrollTop,
        event: 'scroll',
      });
    });
    w.__ticks = 0;
    const tick = () => {
      w.__ticks++;
      w.__mode = w.__mode || [];
      const last = w.__mode[w.__mode.length - 1];
      const cur = vp.getAttribute('data-scrollable');
      if (!last || last.vpScrollable !== cur) {
        w.__mode.push({
          t: Math.round(performance.now()),
          vpScrollable: cur,
          dataAutoscrolling: vp.hasAttribute('data-autoscrolling'),
          top: vp.scrollTop,
        });
      }
    };
    setInterval(tick, 16);
  });

  const range = await viewport(page).evaluate((el) => el.scrollHeight - el.clientHeight);
  await viewport(page).evaluate((el) => {
    el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
  });
  const parked = await viewport(page).evaluate((el) => el.scrollTop);
  console.log('RANGE:', range, 'PARKED:', parked);

  await minimize(page).click();
  await expect(drawer(page)).toBeHidden();

  await fab(page).click();
  await settled(page);
  await expect(drawer(page)).toBeVisible();
  // additional settle: wait for any post-animation scroll mutations (the
  // primitive defers its commits via rAF)
  await page.waitForTimeout(800);

  const scrolls = await page.evaluate(() => (window as any).__scrolls);
  const modeHist = await page.evaluate(() => (window as any).__mode);
  console.log('SCROLLS:', JSON.stringify(scrolls, null, 1));
  console.log('MODE:', JSON.stringify(modeHist));
  expect(true).toBe(true);
});
