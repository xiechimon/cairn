import { expect, type Locator, type Page } from '@playwright/test';

declare global {
  interface Window {

    __permCalls: number;
  }
}

export function stubNotification(
  page: Page,
  initial: string,
  resolution: string,
): Promise<void> {
  return page.addInitScript(
    ({ p, r }) => {
      let perm = p;
      window.__permCalls = 0;
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: {
          get permission() {
            return perm;
          },
          requestPermission() {
            window.__permCalls++;
            perm = r;
            return Promise.resolve(r);
          },
        },
      });
    },
    { p: initial, r: resolution },
  );
}

export async function settleTransitions(page: Page): Promise<void> {
  const settled = await page.evaluate(async () => {
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    for (let i = 0; i < 20; i += 1) {
      await frame();
      const running = document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition && a.playState === 'running');
      if (running.length === 0) return true;
      await Promise.allSettled(running.map((a) => a.finished));
    }
    return false;
  });
  if (!settled) throw new Error('CSS transitions still running after 20 rounds');
}

export async function pressAndExpect(
  page: Page,
  key: string,
  target: Locator,
  state: 'visible' | 'hidden' = 'visible',
): Promise<void> {
  const before = `${target} before ${key}`;
  if (state === 'hidden') await expect(target, before).toBeVisible();
  else await expect(target, before).toBeHidden();
  await page.keyboard.press(key);
  if (state === 'hidden') await expect(target, `${key} should hide ${target}`).toBeHidden();
  else await expect(target, `${key} should show ${target}`).toBeVisible();
}

export interface RingReport {
  focused: boolean;
  outline: string;
  clippedBy: string[];
}

export function readRing(locator: Locator): Promise<RingReport> {
  return locator.evaluate((el) => {
    const cs = getComputedStyle(el);
    const width = Number.parseFloat(cs.outlineWidth);
    const reach = cs.outlineStyle === 'none' ? 0 : Number.parseFloat(cs.outlineOffset) + width;
    const rect = el.getBoundingClientRect();
    const clippedBy: string[] = [];
    if (reach > 0) {
      for (let a = el.parentElement; a != null; a = a.parentElement) {
        const s = getComputedStyle(a);
        const box = a.getBoundingClientRect();
        const sides: string[] = [];
        if (s.overflowX !== 'visible') {
          if (rect.left - reach < box.left - 0.5) sides.push('left');
          if (rect.right + reach > box.right + 0.5) sides.push('right');
        }
        if (s.overflowY !== 'visible') {
          if (rect.top - reach < box.top - 0.5) sides.push('top');
          if (rect.bottom + reach > box.bottom + 0.5) sides.push('bottom');
        }
        if (sides.length > 0) clippedBy.push(`${a.tagName.toLowerCase()}:${sides.join('+')}`);
      }
    }
    return {
      focused: document.activeElement === el,
      outline: cs.outlineStyle === 'none' || width === 0 ? 'none' : `${cs.outlineStyle} ${width}px`,
      clippedBy,
    };
  });
}

export async function keyboardFocus(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await settleTransitions(page);
}
