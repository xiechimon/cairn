import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { RunTurnTime } from '../src/runs/run-turns-popover.js';

const date = new Date(2026, 10, 5, 9, 7);
const AT = date.getTime();
const CLOCK = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const DAY = date.toLocaleDateString([], { month: '2-digit', day: '2-digit' });

test('an older run-log row shows its padded date and time on one line', () => {
  const html = renderToStaticMarkup(createElement(RunTurnTime, { at: AT, group: '更早' }));
  expect(html).toContain('whitespace-nowrap');
  expect(html).toContain(`>${DAY} ${CLOCK}<`);
});

test('a row from today or yesterday shows only the time', () => {
  const html = renderToStaticMarkup(createElement(RunTurnTime, { at: AT, group: '今天' }));
  expect(html).toContain(`>${CLOCK}<`);
});
