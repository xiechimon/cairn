import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyLaneExit } from './lane-worker-exit-gate.mjs';

const SCRIPT = fileURLToPath(new URL('./lane-worker-exit-gate.mjs', import.meta.url));

test('real #2021 deepseek-v4-flash route-only exit is red', () => {
  const result = classifyLaneExit({
    log: 'ai-route: implement -> pi:domestic-proxy/deepseek-v4-flash\n',
    rc: 0,
    durationSeconds: 55,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'banned-model');
  assert.match(result.reason, /deepseek-v4-flash/);
});

test('real #2005 overlapping-PR noop wrap-up at 57s rc 0 is red', () => {
  const result = classifyLaneExit({
    log: '重叠的 open PR：#1992 涉及 workflow、structure baseline、prepush；#1787 涉及 workflow。本轮未改动其内容，也未启动服务器。\n',
    rc: 0,
    durationSeconds: 57,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'noop-exit');
  assert.match(result.reason, /no-op|noop-exit/);
});

test('real #1775 uncommitted wrap-up at 55s rc 0 is red', () => {
  const result = classifyLaneExit({
    log: '未提交、未推送，未启动服务器。请补充具体自检失败项；产品实施仍需先决定执行隔离、响应泄密边界及旧秘密迁移策略。\n',
    rc: 0,
    durationSeconds: 55,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'noop-exit');
});

test('allowed model with a long successful run stays green', () => {
  const result = classifyLaneExit({
    log: [
      'ai-route: implement -> pi:domestic-proxy/deepseek-v4.1-flash',
      'opened https://github.com/xiechimon/cairn/pull/9999',
      '',
    ].join('\n'),
    rc: 0,
    durationSeconds: 900,
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'ok');
});

test('non-zero rc fails through even without banned model or noop text', () => {
  const result = classifyLaneExit({
    log: 'something failed\n',
    rc: 1,
    durationSeconds: 900,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'nonzero-rc');
});

test('CLI reds the #2021 banned-model fixture and greens a long allowed run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lane-exit-gate-'));
  try {
    const bad = join(dir, 'bad.log');
    const good = join(dir, 'good.log');
    writeFileSync(bad, 'ai-route: implement -> pi:domestic-proxy/deepseek-v4-flash\n');
    writeFileSync(
      good,
      'ai-route: implement -> pi:domestic-proxy/deepseek-v4.1-flash\nopened https://github.com/xiechimon/cairn/pull/1\n',
    );
    const red = spawnSync(
      process.execPath,
      [SCRIPT, '--log', bad, '--rc', '0', '--duration-s', '55'],
      { encoding: 'utf8' },
    );
    assert.equal(red.status, 1, `${red.stdout}${red.stderr}`);
    assert.match(`${red.stdout}${red.stderr}`, /banned-model|deepseek-v4-flash/);
    const green = spawnSync(
      process.execPath,
      [SCRIPT, '--log', good, '--rc', '0', '--duration-s', '900'],
      { encoding: 'utf8' },
    );
    assert.equal(green.status, 0, `${green.stdout}${green.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
