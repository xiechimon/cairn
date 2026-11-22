import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPageCapture } from '../src/page-capture.ts';

function surfaces({ loads }) {
  const opened = [];
  const open = () => {
    const surface = {
      destroyed: false,
      load: () => (loads === 'hang' ? new Promise(() => {}) : Promise.resolve()),
      nextFrame: () => Promise.resolve(Uint8Array.of(0xff, 0xd8, 0xff)),
      destroy() {
        surface.destroyed = true;
      },
    };
    opened.push(surface);
    return surface;
  };
  return { open, opened };
}

test('a page that never finishes rendering gives no image and its window is destroyed at the budget', async () => {
  const { open, opened } = surfaces({ loads: 'hang' });
  const capture = createPageCapture(open, 50);
  const started = Date.now();
  assert.equal(await capture('<h1>never</h1>'), null);
  assert.ok(Date.now() - started < 1000);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].destroyed, true);
});

test('a hung capture does not block the next page', async () => {
  const hung = surfaces({ loads: 'hang' });
  const quick = surfaces({ loads: 'ok' });
  let calls = 0;
  const capture = createPageCapture(() => (calls++ === 0 ? hung.open() : quick.open()), 50);
  const [first, second] = await Promise.all([capture('<h1>a</h1>'), capture('<h1>b</h1>')]);
  assert.equal(first, null);
  assert.deepEqual([...second], [0xff, 0xd8, 0xff]);
  assert.equal(quick.opened[0].destroyed, true);
});
