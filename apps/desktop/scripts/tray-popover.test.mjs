import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRAY_POPOVER_WIDTH, trayPopoverBounds } from '../src/tray-popover.ts';

const screen = { x: 0, y: 0, width: 1512, height: 982 };
const workArea = { x: 0, y: 24, width: 1512, height: 958 };

test('the popover hangs centred under the menu bar icon', () => {
  const icon = { x: 1200, y: 0, width: 24, height: 24 };
  assert.deepEqual(trayPopoverBounds(icon, workArea, 412.4), {
    x: 1212 - TRAY_POPOVER_WIDTH / 2,
    y: 28,
    width: TRAY_POPOVER_WIDTH,
    height: 413,
  });
});

test('an icon near the right edge keeps the popover on screen', () => {
  const icon = { x: 1490, y: 0, width: 22, height: 24 };
  const bounds = trayPopoverBounds(icon, workArea, 400);
  assert.equal(bounds.x + bounds.width, screen.width - 8);
});

test('an icon at the left edge of a display left of the main one stays on that display', () => {
  const left = { x: -1440, y: 24, width: 1440, height: 876 };
  const bounds = trayPopoverBounds({ x: -1435, y: 0, width: 24, height: 24 }, left, 400);
  assert.equal(bounds.x, -1432);
});

test('a popover taller than the room left is cut to fit above the Dock', () => {
  const bounds = trayPopoverBounds({ x: 700, y: 0, width: 24, height: 24 }, workArea, 2000);
  assert.equal(bounds.y + bounds.height, workArea.y + workArea.height - 8);
});
