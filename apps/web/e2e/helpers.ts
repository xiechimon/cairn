import { errors, type Locator, type Page } from '@playwright/test';

// e2e 共享测试工具（非断言面）。放这里的判据 = 多个 spec 逐字节复用同一段
// 桩；单 spec 专用的桩仍留在各自文件（house pattern）。

declare global {
  interface Window {
    /** stubNotification 的 requestPermission() 调用计数——通知面 spec 断言用。 */
    __permCalls: number;
  }
}

/** 替换 window.Notification：permission 读 `initial`，直到 requestPermission()
 *  把它落到 `resolution`（镜像真 API——属性反映授权决定），调用次数计入
 *  window.__permCalls。headless chromium 的真权限 API 不可靠（grantPermissions
 *  不翻 Notification.permission、requestPermission 恒 resolve default），桩是
 *  稳定表达 granted/denied/default 三态的唯一通道。
 *  通知面三 spec 共用（notify-banner / account-team-cleanse /
 *  account-controls）——曾是逐字节相同的三份副本，抽成单源防漂移。 */
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

/** 等到某一帧整页没有在跑的 CSS 过渡，再读计算样式。焦点环（outline-offset /
 *  -width / -color、box-shadow）与分段控件的 hover 墨色都走 150ms 过渡，过渡
 *  中读数会读到中间值（CI 实测 outline-offset `1px`，#1427）。过渡可能挂在
 *  被测元素之外（input-group 外壳经 :has() 跟随），聚焦后的重渲染也可能晚一帧
 *  再起新过渡，所以按帧复查整页；被打断的过渡用 allSettled 吞掉。20 轮仍有
 *  过渡在跑即抛错，让超时显形，而不是带着中间值往下读。
 *  registry-focus-ring / segmented-controls / a11y-axe 共用。 */
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

/** Press `key` until `target` reaches `state`: at most 6 presses, each
 *  followed by a wait of up to 1s.
 *  Hotkey listeners register in a passive effect after first paint, so a
 *  press right after load can be lost; a lost press leaves the old state and
 *  the re-press is the fix. A delivered press ends the loop as soon as the
 *  target flips.
 *  - The key must be harmless to press again after a slow but delivered
 *    press. Escape closes one layer per press: on a single layer a re-press
 *    after a slow close is a no-op, but with stacked layers it closes the
 *    next one out.
 *  - ⌘K and ⌘J are toggles. A delivered press that takes over 1s to show is
 *    re-pressed and flips back; the loop keeps going until `state` holds, but
 *    a re-press queued behind a slow flip can still land after it returns.
 *  - `state: 'hidden'` only means something while `target` is visible: a
 *    target that never rendered reads hidden at once.
 *  Only a wait timeout counts as "not yet". Any other wait error (strict
 *  mode, a closed page) is rethrown, not retried into a misleading message. */
export async function pressUntil(
  page: Page,
  key: string,
  target: Locator,
  state: 'visible' | 'hidden' = 'visible',
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press(key);
    const reached = await target.waitFor({ state, timeout: 1000 }).then(
      () => true,
      (error: unknown) => {
        if (error instanceof errors.TimeoutError) return false;
        throw error;
      },
    );
    if (reached) return;
  }
  throw new Error(`${key} never made ${target} ${state}`);
}
