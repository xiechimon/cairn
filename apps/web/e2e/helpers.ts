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
