import { setTimeout as delay } from 'node:timers/promises';

const TRAY_PATH = '/tray';
const POLL_MS = 250;

export function isTrayPage(page) {
  return new URL(page.url(), 'about:blank').pathname === TRAY_PATH;
}

export async function mainWindow(electronApp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = electronApp
      .windows()
      .find((page) => page.url().startsWith('http') && !isTrayPage(page));
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      const seen = electronApp.windows().map((page) => page.url());
      throw new Error(`the main window did not open in ${timeoutMs} ms; windows: ${seen}`);
    }
    await delay(POLL_MS);
  }
}
