import { afterEach, describe, expect, test, vi } from 'vitest';
import { copyTextWithFeedback, writeClipboard } from '../src/lib/clipboard.js';

function plainHttpPage({ allowed }: { allowed: boolean }) {
  const written: string[] = [];
  const listeners = new Set<(event: unknown) => void>();
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('document', {
    addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: unknown) => void) =>
      listeners.delete(listener),
    execCommand: () => {
      if (!allowed) return false;
      for (const listener of [...listeners]) {
        listener({
          clipboardData: { setData: (_format: string, text: string) => written.push(text) },
          preventDefault: () => {},
          stopImmediatePropagation: () => {},
        });
      }
      return true;
    },
  });
  return { written, listeners };
}

afterEach(() => vi.unstubAllGlobals());

describe('copy on a plain-http origin, where navigator.clipboard is missing', () => {
  test('copies the text and confirms', async () => {
    const page = plainHttpPage({ allowed: true });
    const copied = vi.fn();
    const failed = vi.fn();
    copyTextWithFeedback('cairn connect', copied, failed);
    expect(page.written).toEqual(['cairn connect']);
    expect(copied).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
    expect(page.listeners.size).toBe(0);
    await expect(writeClipboard('again')).resolves.toBe(true);
  });

  test('reports a failure when the browser refuses to copy', async () => {
    const page = plainHttpPage({ allowed: false });
    const copied = vi.fn();
    const failed = vi.fn();
    copyTextWithFeedback('cairn connect', copied, failed);
    expect(failed).toHaveBeenCalledOnce();
    expect(copied).not.toHaveBeenCalled();
    expect(page.listeners.size).toBe(0);
    await expect(writeClipboard('again')).resolves.toBe(false);
  });
});
