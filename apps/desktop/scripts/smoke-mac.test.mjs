import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { isServerHelper } from '../src/server-process.ts';
import { mainWindow } from './main-window.mjs';
import { matchingPopover } from './tray-click.mjs';

const CLI = join(import.meta.dirname, 'smoke-mac.mjs');

test('only the forked NodeService helper counts as the server', () => {
  const helper = '/x/Cairn.app/Contents/Frameworks/Cairn Helper.app/Contents/MacOS/Cairn Helper';
  const server = `${helper} --type=utility --utility-sub-type=node.mojom.NodeService --lang=en-US --service-sandbox-type=none`;
  const network = `${helper} --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-US --service-sandbox-type=network`;
  const decoder = `${helper} --type=utility --utility-sub-type=data_decoder.mojom.DataDecoderService --service-sandbox-type=none`;
  const gpu = `${helper} --type=gpu-process --user-data-dir=/x`;
  assert.equal(isServerHelper(server), true);
  assert.equal(isServerHelper(network), false);
  assert.equal(isServerHelper(decoder), false);
  assert.equal(isServerHelper(gpu), false);
});

test('the smoke refuses to signal the installed app', () => {
  const result = spawnSync(process.execPath, [CLI, '/Applications/Cairn.app', 'out.png'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /installed app/);
});

test('CI alone does not opt into the real-click smoke', () => {
  const result = spawnSync(process.execPath, [CLI, join(CLI, 'missing.app'), 'out.png'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, CI: 'true', CAIRN_SMOKE_ISOLATED_SESSION: '0' },
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /CAIRN_SMOKE_ISOLATED_SESSION=1/);
});

test('the smokes drive the main window, not the hidden tray popover created before it', async () => {
  const page = (url) => ({ url: () => url });
  const tray = page('http://127.0.0.1:4100/tray');
  const main = page('http://127.0.0.1:4100/app');
  const windows = [tray, page('about:blank')];
  const app = { firstWindow: async () => tray, windows: () => windows };
  setTimeout(() => windows.push(main), 50);
  assert.equal(await mainWindow(app, 5_000), main);
});

test('the installed-app refusal does not need the app to exist', () => {
  const result = spawnSync(
    process.execPath,
    [CLI, '/Applications/Cairn-absent-on-this-host.app', 'out.png'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /installed app/);
});

test('the popover is the window server entry at the popover bounds, not the main window', () => {
  const bounds = { x: 1592, y: 30, width: 320, height: 440 };
  const main = { number: 31, layer: 0, onscreen: 1, x: 320, y: 140, width: 1280, height: 800 };
  const popover = { number: 33, layer: 3, onscreen: 1, x: 1592, y: 30, width: 320, height: 440 };
  assert.deepEqual(matchingPopover([main, popover], bounds), popover);
  assert.equal(matchingPopover([main], bounds), null);
});

test('the popover is found after the window server moves it, and a different width is not it', () => {
  const bounds = { x: 1592, y: 30, width: 320, height: 440 };
  const moved = { number: 33, layer: 3, onscreen: 0, x: 1596, y: 34, width: 320, height: 300 };
  const other = { number: 34, layer: 3, onscreen: 1, x: 1592, y: 30, width: 640, height: 440 };
  assert.deepEqual(matchingPopover([moved, other], bounds), moved);
});
