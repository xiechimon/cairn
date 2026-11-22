import { setTimeout as delay } from 'node:timers/promises';

const POLL_MS = 250;

export async function mainWindow(electronApp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = electronApp.windows().find((page) => page.url().startsWith('http'));
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      const seen = electronApp.windows().map((page) => page.url());
      throw new Error(`the main window did not open in ${timeoutMs} ms; windows: ${seen}`);
    }
    await delay(POLL_MS);
  }
}
