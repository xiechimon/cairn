import { DESKTOP_SHELL_USER_AGENT } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { MAC_DESKTOP_SHELL, markDesktopShell } from '../src/desktop-shell.js';

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
    expect(markDesktopShell(element, `${BROWSER_UA} Electron/45.2.1 ${DESKTOP_SHELL_USER_AGENT}`)).toBe(
      true,
    );
    expect(root.dataset.shell).toBe(MAC_DESKTOP_SHELL);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.className).toBe('desktop-drag-strip');
    expect(appended[0]?.attributes['aria-hidden']).toBe('true');
  });

  test('a browser user agent leaves the page untouched', () => {
    const { root, appended, element } = fakeRoot();
    expect(markDesktopShell(element, BROWSER_UA)).toBe(false);
    expect(root.dataset.shell).toBeUndefined();
    expect(appended).toHaveLength(0);
  });
});
