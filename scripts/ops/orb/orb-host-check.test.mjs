import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkHost, parseHostCheck } from './orb-host-check.mjs';

for (const name of ['pass', 'missing-image', 'polkit-denied', 'no-egress', 'private-egress']) {
  test(`recorded ${name} command outputs`, () => {
    const input = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
    const result = parseHostCheck(input);
    assert.equal(result.ok, name === 'pass');
    if (name === 'pass') {
      assert.equal(result.image, 'cairn-orb-base');
      assert.equal(result.cloneStartStop, 'ok');
      assert.equal(result.egress, 'ok');
      assert.equal(result.memoryMax, 4294967296);
      assert.equal(result.homeVisible, false);
      assert.equal(result.negativeControl, 'denied');
    }
  });
}

test('ambiguous or unsafe outputs never pass', () => {
  const input = JSON.parse(readFileSync(new URL('./fixtures/pass.json', import.meta.url)));
  for (const change of [
    { images: 'cairn-orb-base-old directory no' },
    { memory: 'MemoryMax=infinity' },
    { homeExit: 1 },
    { homeExit: null },
    { negativeExit: 0 },
    { negativeError: 'Connection timed out' },
    { headers: 'HTTP/1.1 200 Connection established\r\n\r\nHTTP/2 403' },
    { cloneStartStop: 'failed' },
    { privateEgress: [] },
    {
      privateEgress: [
        { status: 0, code: '200' },
        { status: 22, code: '403' },
      ],
    },
    {
      privateEgress: [
        { status: 7, code: '000' },
        { status: 22, code: '403' },
      ],
    },
  ])
    assert.equal(parseHostCheck({ ...input, ...change }).ok, false);
});

function fakeHost(failAt) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    const text = [cmd, ...args].join(' ');
    if (args.includes('not-cairn-x')) return { status: 1, stderr: 'Access denied', stdout: '' };
    if (failAt && text.includes(failAt))
      return { status: 1, stderr: 'fixture failure', stdout: '' };
    let stdout = '';
    if (args.includes('list-images')) stdout = 'cairn-orb-base directory no\n';
    if (args.includes('show')) stdout = 'MemoryMax=4294967296\n';
    if (args.includes('curl')) {
      if (args.some((arg) => /http:\/\/(127\.0\.0\.1|10\.203\.0\.1):8787/.test(arg)))
        return { status: 22, stdout: '403', stderr: 'HTTP 403' };
      stdout = 'HTTP/2 200\r\n';
    }
    if (cmd === 'nft') stdout = 'table inet cairn_orb { }';
    return { status: 0, stdout, stderr: '' };
  };
  return { calls, run };
}

test('host probe exercises no-password lifecycle, relay, limits and isolation', () => {
  const f = fakeHost();
  assert.equal(
    checkHost({ run: f.run, wait: () => {}, user: 'ian', name: 'cairn-orb-check-fixture' }).ok,
    true,
  );
  assert.ok(f.calls.some((call) => call.includes('--no-ask-password')));
  assert.ok(f.calls.some((call) => call.includes('--wait') && call.includes('true')));
  assert.ok(f.calls.some((call) => call.includes('curl') && call.includes('--proxy')));
  assert.ok(f.calls.some((call) => call.includes('poweroff')));
  assert.ok(f.calls.some((call) => call.includes('remove')));
  assert.ok(f.calls.every((call) => !call.includes('sudo')));
});

for (const failure of ['start', 'true', 'curl', 'show', 'poweroff', 'remove']) {
  test(`${failure} failure is reported and cleanup is attempted`, () => {
    const f = fakeHost(failure);
    const result = checkHost({
      run: f.run,
      wait: () => {},
      user: 'ian',
      name: 'cairn-orb-check-fixture',
    });
    assert.equal(result.ok, false);
    assert.ok(f.calls.some((call) => call.includes('remove')));
  });
}

test('probe refuses root and unsafe fixture names', () => {
  const f = fakeHost();
  assert.throws(() => checkHost({ run: f.run, wait: () => {}, user: 'root' }), /ian/);
  assert.throws(
    () => checkHost({ run: f.run, wait: () => {}, user: 'ian', name: 'not-cairn-x' }),
    /name/,
  );
  assert.equal(f.calls.length, 0);
});

test('unexpected negative-control success is cleaned up and cannot pass', () => {
  const f = fakeHost();
  const result = checkHost({
    run: (cmd, args) =>
      args.includes('clone') && args.includes('not-cairn-x')
        ? { status: 0, stdout: '', stderr: '' }
        : f.run(cmd, args),
    user: 'ian',
    wait: () => {},
    name: 'cairn-orb-check-fixture',
  });
  assert.equal(result.ok, false);
  assert.ok(f.calls.some((call) => call.includes('remove') && call.includes('not-cairn-x')));
});

test('host check rejects loopback and bridge egress and reports owner firewall inspection', () => {
  const f = fakeHost();
  const result = checkHost({
    run: f.run,
    wait: () => {},
    user: 'ian',
    name: 'cairn-orb-check-fixture',
  });
  assert.equal(result.privateEgress, 'denied');
  assert.equal(result.firewall, 'present');
  for (const target of ['http://127.0.0.1:8787/', 'http://10.203.0.1:8787/']) {
    assert.ok(
      f.calls.some(
        (call) => call.includes(target) && call.includes('--noproxy') && call.includes('--proxy'),
      ),
    );
  }
  const owner = checkHost({
    run: (cmd, args) =>
      cmd === 'nft' ? { status: 1, stderr: 'Operation not permitted' } : f.run(cmd, args),
    wait: () => {},
    user: 'ian',
    name: 'cairn-orb-check-fixture',
  });
  assert.equal(owner.firewall, 'owner-check-required');
  assert.equal(owner.ok, false);
});
