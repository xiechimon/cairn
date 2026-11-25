import { DESKTOP_SHELL_USER_AGENT, DESKTOP_TRAY_PATH } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import {
  MAC_DESKTOP_SHELL,
  MAC_TRAY_SHELL,
  markDesktopShell,
  syncDesktopFullScreen,
} from '../src/desktop-shell.js';

interface FakeElement {
  className: string;
  attributes: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
}

function fakeRoot() {
  const appended: FakeElement[] = [];
  const root = {
    dataset: {} as Record<string, string>,
    ownerDocument: {
      createElement: (): FakeElement => {
        const element: FakeElement = {
          className: '',
          attributes: {},
          setAttribute: (name, value) => {
            element.attributes[name] = value;
          },
        };
        return element;
      },
      body: { append: (element: FakeElement) => appended.push(element) },
    },
  };
  return { root, appended, element: root as unknown as HTMLElement };
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/156.0 Safari/537.36';

describe('markDesktopShell', () => {
  test('the desktop app user agent marks the root and adds one hidden drag strip', () => {
    const { root, appended, element } = fakeRoot();
    expect(markDesktopShell(
        element,
        `${BROWSER_UA} Electron/45.2.1 ${DESKTOP_SHELL_USER_AGENT}`,
        '/app',
      ),
    ).toBe(true);
    expect(root.dataset.shell).toBe(MAC_DESKTOP_SHELL);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.className).toBe('desktop-drag-strip');
    expect(appended[0]?.attributes['aria-hidden']).toBe('true');
  });

  test('the menu bar popover gets its own shell and no drag strip over its buttons', () => {
    const { root, appended, element } = fakeRoot();
    expect(
      markDesktopShell(element, `${BROWSER_UA} ${DESKTOP_SHELL_USER_AGENT}`, DESKTOP_TRAY_PATH),
    ).toBe(true);
    expect(root.dataset.shell).toBe(MAC_TRAY_SHELL);
    expect(appended).toHaveLength(0);
  });

  test('a browser user agent leaves the page untouched', () => {
    const { root, appended, element } = fakeRoot();
    expect(markDesktopShell(element, BROWSER_UA, '/app')).toBe(false);
    expect(root.dataset.shell).toBeUndefined();
    expect(appended).toHaveLength(0);
  });
});

describe('syncDesktopFullScreen', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  test('tracks initial fullscreen state and live transitions from cairnDesktop.shell', async () => {
    const listeners = new Set<(fullScreen: boolean) => void>();
    (globalThis as { window?: unknown }).window = {
      cairnDesktop: {
        shell: {
          isFullScreen: async () => true,
          onFullScreenChange: (listener: (fullScreen: boolean) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      },
    };
    const { root, element } = fakeRoot();
    const stop = syncDesktopFullScreen(element);
    await Promise.resolve();
    expect(root.dataset.fullscreen).toBe('');

    for (const listener of listeners) listener(false);
    expect(root.dataset.fullscreen).toBeUndefined();

    for (const listener of listeners) listener(true);
    expect(root.dataset.fullscreen).toBe('');

    stop();
    expect(listeners.size).toBe(0);
  });

  test('clears stale fullscreen marker when shell bridge is unavailable', () => {
    (globalThis as { window?: unknown }).window = {};
    const { root, element } = fakeRoot();
    root.dataset.fullscreen = '';
    const stop = syncDesktopFullScreen(element);
    expect(root.dataset.fullscreen).toBeUndefined();
    stop();
  });
});
