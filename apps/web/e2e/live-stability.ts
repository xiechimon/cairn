import type { Locator, Page } from '@playwright/test';

declare global {
  interface Window {
    __remounts?: string[];
  }
}

export async function watchRemounts(page: Page, testIds: readonly string[]): Promise<void> {
  await page.evaluate((ids) => {
    const selector = ids.map((id) => `[data-testid="${id}"]`).join(',');
    const keyOf = (el: Element) =>
      `${el.getAttribute('data-testid')}|${(el.textContent ?? '').trim().slice(0, 80)}`;
    const gone = new Set<string>();
    const found = (node: Node) =>
      node instanceof Element ? [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)] : [];
    window.__remounts = [];
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) for (const el of found(node)) gone.add(keyOf(el));
        for (const node of record.addedNodes)
          for (const el of found(node)) if (gone.has(keyOf(el))) window.__remounts?.push(keyOf(el));
      }
    }).observe(document.body, { childList: true, subtree: true });
  }, testIds);
}

export const remounts = (page: Page) => page.evaluate(() => window.__remounts ?? []);

export async function offsetFrom(anchor: Locator, target: Locator): Promise<number> {
  const [a, b] = await Promise.all([anchor.boundingBox(), target.boundingBox()]);
  return Math.round((b?.y ?? 0) - (a?.y ?? 0));
}

export const tops = (rows: Locator) =>
  rows.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
