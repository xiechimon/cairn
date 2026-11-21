import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { isServerHelper } from '../src/server-process.ts';

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
