import { describe, expect, test } from 'vitest';
import {
  type DesktopNotifyPayload,
  desktopNotificationOptions,
  isDesktopNotifyPayload,
} from '../src/desktop-shell.js';

const payload: DesktopNotifyPayload = {
  title: '需要你决定',
  body: '修一下按钮',
  href: '/app?thread=todo-x',
  tag: 'u1:todo-x',
  sound: 'system',
};

describe('isDesktopNotifyPayload', () => {
  test('accepts a well-formed payload', () => {
    expect(isDesktopNotifyPayload(payload)).toBe(true);
  });

  test('rejects non-objects, empty titles and oversized fields', () => {
    expect(isDesktopNotifyPayload(null)).toBe(false);
    expect(isDesktopNotifyPayload('x')).toBe(false);
    expect(isDesktopNotifyPayload({ ...payload, title: '' })).toBe(false);
    expect(isDesktopNotifyPayload({ ...payload, title: 'x'.repeat(201) })).toBe(false);
    expect(isDesktopNotifyPayload({ ...payload, body: 'x'.repeat(501) })).toBe(false);
    expect(isDesktopNotifyPayload({ ...payload, tag: 'x'.repeat(101) })).toBe(false);
  });

  test('rejects hrefs that are not app paths', () => {
    expect(isDesktopNotifyPayload({ ...payload, href: 'https://evil.example' })).toBe(false);
    expect(isDesktopNotifyPayload({ ...payload, href: '/settings' })).toBe(false);
    expect(isDesktopNotifyPayload({ ...payload, href: '/app?chief=c1' })).toBe(true);
  });

  test('rejects unknown sound names', () => {
    expect(isDesktopNotifyPayload({ ...payload, sound: 'Basso' })).toBe(false);
    expect(isDesktopNotifyPayload({ ...payload, sound: '' })).toBe(false);
    for (const sound of ['system', 'Glass', 'Ping', 'Pop', 'Purr', 'none']) {
      expect(isDesktopNotifyPayload({ ...payload, sound })).toBe(true);
    }
  });
});

describe('desktopNotificationOptions', () => {
  test('system sound maps to no explicit sound and audible delivery', () => {
    expect(desktopNotificationOptions(payload)).toEqual({
      title: '需要你决定',
      body: '修一下按钮',
      silent: false,
    });
  });

  test('named sound passes through to the OS sound name', () => {
    expect(desktopNotificationOptions({ ...payload, sound: 'Glass' })).toEqual({
      title: '需要你决定',
      body: '修一下按钮',
      silent: false,
      sound: 'Glass',
    });
  });

  test('none silences the notification', () => {
    expect(desktopNotificationOptions({ ...payload, sound: 'none' })).toEqual({
      title: '需要你决定',
      body: '修一下按钮',
      silent: true,
    });
  });
});
