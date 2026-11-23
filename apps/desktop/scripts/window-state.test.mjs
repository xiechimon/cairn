import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampBounds, parseWindowState } from '../src/window-state.ts';

const PRIMARY = { x: 0, y: 25, width: 1512, height: 920 };
const RIGHT = { x: 1512, y: 0, width: 2560, height: 1415 };

test('saved bounds are applied at launch, and a page saved by an older build is not replayed', () => {
  const state = parseWindowState(
    JSON.stringify({
      bounds: { x: 1700, y: 120, width: 1400, height: 900 },
      path: '/app/project/p1?pane=tasks',
    }),
  );
  assert.deepEqual(state, { bounds: { x: 1700, y: 120, width: 1400, height: 900 } });
  assert.deepEqual(clampBounds(state.bounds, [PRIMARY, RIGHT], PRIMARY), {
    x: 1700,
    y: 120,
    width: 1400,
    height: 900,
  });
});

test('bounds left on an unplugged monitor are moved onto the primary display', () => {
  const state = parseWindowState(
    JSON.stringify({ bounds: { x: 1700, y: 120, width: 1400, height: 900 } }),
  );
  const placed = clampBounds(state.bounds, [PRIMARY], PRIMARY);
  assert.deepEqual(placed, { x: 56, y: 35, width: 1400, height: 900 });
});

test('a window larger than the display or hanging off its edge is pulled inside it', () => {
  const placed = clampBounds({ x: -300, y: 10, width: 2000, height: 700 }, [PRIMARY], PRIMARY);
  assert.deepEqual(placed, { x: 0, y: 25, width: 1512, height: 700 });
});

test('a missing or malformed file falls back to the defaults', () => {
  for (const raw of [
    null,
    '',
    '{',
    'null',
    '[]',
    '{"bounds":{"x":0,"y":0,"width":-5,"height":10}}',
  ]) {
    assert.deepEqual(parseWindowState(raw), { bounds: null }, String(raw));
  }
});
