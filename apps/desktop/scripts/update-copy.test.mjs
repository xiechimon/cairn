import assert from 'node:assert/strict';
import { test } from 'node:test';
import { desktopLocale } from '../src/locale.ts';
import {
  couldNotStartCopy,
  installUpdateCopy,
  serverStoppedCopy,
  unsupportedUpdateCopy,
  updateCheckFailedCopy,
  upToDateCopy,
} from '../src/update-copy.ts';

test('the desktop locale follows the page or OS language', () => {
  assert.equal(desktopLocale('zh-CN'), 'zh');
  assert.equal(desktopLocale('zh'), 'zh');
  assert.equal(desktopLocale('en-US'), 'en');
  assert.equal(desktopLocale('en'), 'en');
  assert.equal(desktopLocale(''), 'en');
  assert.equal(desktopLocale(undefined), 'en');
});

test('the install dialog speaks Chinese on a Chinese desktop', () => {
  const copy = installUpdateCopy('zh', '0.44.0', '0.43.2', false);
  assert.equal(copy.title, 'Cairn 0.44.0 可以安装');
  assert.equal(copy.detail, '当前版本是 0.43.2。Cairn 会下载更新，然后重启完成安装。');
  assert.deepEqual(copy.buttons, ['安装并重启', '稍后']);
});

test('a version that already failed once says so when asked to install again', () => {
  const copy = installUpdateCopy('zh', '0.44.0', '0.43.2', true);
  assert.equal(copy.detail, '0.44.0 上次在这台 Mac 上未能启动。你已选择安装，Cairn 会重新安装。');
  const en = installUpdateCopy('en', '0.44.0', '0.43.2', true);
  assert.match(en.detail, /0\.44\.0/);
  assert.match(en.detail, /did not start/);
});

test('the up-to-date and check-failed dialogs are localized', () => {
  assert.equal(upToDateCopy('zh', '0.44.0').title, 'Cairn 已是最新');
  assert.equal(upToDateCopy('zh', '0.44.0').detail, '当前版本 0.44.0 已是最新。');
  assert.equal(updateCheckFailedCopy('zh', 'offline').title, 'Cairn 未能检查更新');
  assert.equal(updateCheckFailedCopy('zh', 'offline').detail, 'offline');
});

test('each unsupported blocker has its own localized detail', () => {
  assert.equal(
    unsupportedUpdateCopy('zh', 'not-in-applications').detail,
    '把 Cairn 移到「应用程序」文件夹后再检查。',
  );
  assert.equal(
    unsupportedUpdateCopy('zh', 'read-only').detail,
    'Cairn 在只读位置运行。把它拷贝到「应用程序」文件夹后再检查。',
  );
  assert.equal(unsupportedUpdateCopy('zh', 'development').detail, '这是开发版。');
  assert.equal(unsupportedUpdateCopy('en', 'development').detail, 'This is a development build.');
});

test('the fatal error boxes are localized too', () => {
  assert.equal(serverStoppedCopy('zh', 1).title, 'Cairn 服务已停止');
  assert.equal(serverStoppedCopy('zh', 1).detail, 'Cairn 服务以代码 1 退出。');
  assert.equal(couldNotStartCopy('zh', 'disk full').title, 'Cairn 未能启动');
  assert.equal(couldNotStartCopy('zh', 'disk full').detail, 'disk full');
});
