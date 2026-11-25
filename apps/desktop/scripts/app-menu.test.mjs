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

test('a staged update waits for the user to step away and still offers to update now', () => {
  let installed = 0;
  const template = appMenuTemplate(
    { status: 'ready', version: '0.1.536' },
    { check: () => {}, install: () => (installed += 1) },
    { send: () => {}, back: () => {}, forward: () => {} },
  );
  const item = template[0].submenu.find((entry) => entry.label?.includes('0.1.536'));
  assert.equal(item.label, 'Update to 0.1.536 Now');
  item.click();
  assert.equal(installed, 1);
});

test('localizes the menu bar into Chinese when requested', () => {
  const template = appMenuTemplate(
    { status: 'ready', version: '0.1.536' },
    { check: () => {}, install: () => {} },
    { send: () => {}, back: () => {}, forward: () => {} },
    'zh',
  );
  const updateEntry = template[0].submenu.find((entry) => entry.label?.includes('0.1.536'));
  assert.equal(updateEntry.label, '立即更新到 0.1.536');
  const settingsEntry = template[0].submenu.find(
    (entry) => entry.accelerator === 'CommandOrControl+,',
  );
  assert.equal(settingsEntry.label, '设置…');
  assert.equal(template[1].label, '文件');
  assert.equal(template[1].submenu[0].label, '新建任务');
});
