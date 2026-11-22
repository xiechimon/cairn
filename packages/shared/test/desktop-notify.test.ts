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

  test('accepts an optional dialog fallback and rejects malformed ones', () => {
    const dialog = { title: 'Cairn 回滚了更新', detail: '失败记录在 /tmp/log。' };
    expect(isDesktopNotifyPayload({ ...payload, dialog })).toBe(true);
    expect(isDesktopNotifyPayload({ ...payload, dialog: 'x' })).toBe(false);
    expect(isDesktopNotifyPayload({ ...payload, dialog: { title: '', detail: 'd' } })).toBe(false);
    expect(
      isDesktopNotifyPayload({ ...payload, dialog: { title: 't', detail: 'x'.repeat(501) } }),
    ).toBe(false);
    expect(
      isDesktopNotifyPayload({ ...payload, dialog: { title: 'x'.repeat(201), detail: 'd' } }),
    ).toBe(false);
  });
});

describe('desktopNotificationOptions', () => {
  test('always uses the audible system default sound', () => {
    expect(desktopNotificationOptions(payload)).toEqual({
      title: '需要你决定',
      body: '修一下按钮',
      silent: false,
    });
  });
});
