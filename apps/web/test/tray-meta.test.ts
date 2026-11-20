import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { TrayHeadMeta } from '../src/tray/tray-meta.js';
import type { TrayGroup } from '../src/tray/tray-groups.js';

const TIP =
  '可用内存 7.7 GB；5 分钟负载 45.0，8 核；剩余磁盘 178 GB';

function render(meta: NonNullable<TrayGroup['meta']>): string {
  return renderToStaticMarkup(createElement(TrayHeadMeta, { meta, tip: TIP }));
}

const meta = (over: Partial<NonNullable<TrayGroup['meta']>> = {}) => ({
  percent: 94,
  level: 'full' as const,
  warn: true,
  tip: {
    key: '可用内存 {free} GB；5 分钟负载 {load}，{cores} 核；剩余磁盘 {disk} GB',
    vars: { free: '7.7', load: '45.0', cores: 8, disk: 178 },
  },
  ...over,
});

test('the machine meta is one icon and a single percentage, with the details only in the tooltip', () => {
  const html = render(meta());
  expect(html).toContain('data-testid="tray-machine-meta"');
  expect(html).toContain('data-level="full"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain(`title="${TIP}"`);
  const text = html.replace(/<[^>]+>/g, '');
  expect(text).toBe('94%');
});

test.each(['normal', 'high'] as const)('level %s renders the same bare percentage', (level) => {
  const html = render(meta({ percent: 61, level, warn: level !== 'normal' }));
  expect(html).toContain(`data-level="${level}"`);
  expect(html.replace(/<[^>]+>/g, '')).toBe('61%');
});
