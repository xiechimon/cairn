import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appMenuTemplate } from '../src/app-menu.ts';

function menuItems(sent, navigated) {
  const template = appMenuTemplate(
    { status: 'idle' },
    { check: () => {}, install: () => {} },
    {
      send: (command) => sent.push(command),
      back: () => navigated.push('back'),
      forward: () => navigated.push('forward'),
    },
  );
  return template.flatMap((menu) => [menu, ...(Array.isArray(menu.submenu) ? menu.submenu : [])]);
}

test('the menu bar carries the shortcuts a Mac user expects', () => {
  const sent = [];
  const navigated = [];
  const items = menuItems(sent, navigated);
  const byKey = new Map(items.filter((item) => item.accelerator).map((i) => [i.accelerator, i]));
  assert.equal(byKey.size, items.filter((item) => item.accelerator).length);

  for (const key of ['CommandOrControl+,', 'CommandOrControl+N', 'CommandOrControl+F']) {
    byKey.get(key).click();
  }
  assert.deepEqual(sent, ['settings', 'new-task', 'search']);
  byKey.get('CommandOrControl+[').click();
  byKey.get('CommandOrControl+]').click();
  assert.deepEqual(navigated, ['back', 'forward']);
  assert.equal(byKey.get('CommandOrControl+=').role, 'zoomIn');

  const roles = new Set(items.map((item) => item.role));
  for (const role of [
    'quit',
    'close',
    'undo',
    'redo',
    'cut',
    'copy',
    'paste',
    'selectAll',
    'reload',
    'resetZoom',
    'zoomOut',
    'windowMenu',
  ]) {
    assert.ok(roles.has(role), `menu lacks ${role}`);
  }
});
