import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkHost, parseHostCheck } from './orb-host-check.mjs';

for (const name of [
  'pass',
  'missing-image',
  'polkit-denied',
  'no-egress',
  'private-egress',
  'firewall-open',
]) {
  test(`recorded ${name} command outputs`, () => {
    const input = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
    const result = parseHostCheck(input);
    assert.equal(result.ok, name === 'pass');
    if (name === 'pass') {
      assert.equal(result.image, 'cairn-orb-base');
      assert.equal(result.cloneStartStop, 'ok');
      assert.equal(result.egress, 'ok');
      assert.equal(result.firewall, 'ok');
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
      if (args.some((arg) => /http:\/\/(127\.0\.0\.1:80|10\.203\.0\.1:22)\//.test(arg)))
        return { status: 22, stdout: '403', stderr: 'HTTP 403' };
      stdout = 'HTTP/2 200\r\n';
    }
    if (args.includes('is-active')) stdout = 'active\n';
    if (args.includes('timeout')) {
      return { status: args.at(-1).endsWith('/7890') ? 0 : 124, stdout: '', stderr: '' };
    }
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

test('host check rejects loopback and bridge proxy egress without privileged inspection', () => {
  const f = fakeHost();
  const result = checkHost({
    run: f.run,
    wait: () => {},
    user: 'ian',
    name: 'cairn-orb-check-fixture',
  });
  assert.equal(result.privateEgress, 'denied');
  assert.equal(result.firewall, 'ok');
  for (const target of ['http://127.0.0.1:80/', 'http://10.203.0.1:22/']) {
    assert.ok(
      f.calls.some(
        (call) => call.includes(target) && call.includes('--noproxy') && call.includes('--proxy'),
      ),
    );
  }
  assert.ok(f.calls.every((call) => !call.includes('nft') && !call.includes('sudo')));
});

test('firewall parser requires active service and complete direct TCP evidence', () => {
  const input = JSON.parse(readFileSync(new URL('./fixtures/pass.json', import.meta.url)));
  for (const change of [
    { firewallService: 'inactive' },
    { firewallService: '' },
    { firewallProbes: [] },
    { firewallProbes: input.firewallProbes.slice(1) },
    { firewallProbes: [...input.firewallProbes, input.firewallProbes[1]] },
    ...[0, 1, 2].flatMap((index) =>
      [null, 2, 125, 126, 127, ...(index === 0 ? [1, 124] : [0])].map((status) => ({
        firewallProbes: input.firewallProbes.map((probe, i) =>
          i === index ? { ...probe, status } : probe,
        ),
      })),
    ),
  ]) {
    const result = parseHostCheck({ ...input, ...change });
    assert.equal(result.firewall, 'failed', JSON.stringify(change));
    assert.equal(result.ok, false);
  }
});

test('firewall probes run bounded direct TCP checks as the guest agent', () => {
  const f = fakeHost();
  const result = checkHost({ run: f.run, user: 'ian', name: 'cairn-orb-check-fixture' });
  assert.equal(result.firewall, 'ok');
  assert.ok(
    f.calls.some((call) => call.join(' ') === 'systemctl is-active cairn-orb-firewall.service'),
  );
  for (const port of [7890, 22, 5231]) {
    const probe = f.calls.find((call) => call.at(-1) === `exec 3<>/dev/tcp/10.203.0.1/${port}`);
    assert.ok(probe);
    assert.equal(probe[0], 'systemd-run');
    assert.ok(probe.includes('-M') && probe.includes('cairn-orb-check-fixture'));
    assert.ok(probe.includes('--uid=agent'));
    assert.deepEqual(probe.slice(-5), ['timeout', '3', 'bash', '-c', probe.at(-1)]);
  }
});

for (const failure of ['inactive-service', 'open-port', 'proxy-unreachable', 'probe-error']) {
  test(`firewall ${failure} prevents success and preserves cleanup`, () => {
    const f = fakeHost();
    const result = checkHost({
      user: 'ian',
      name: 'cairn-orb-check-fixture',
      run: (cmd, args) => {
        if (failure === 'inactive-service' && args.includes('is-active'))
          return { status: 3, stdout: 'inactive\n', stderr: '' };
        if (args.includes('timeout')) {
          if (failure === 'open-port' && args.at(-1).endsWith('/22'))
            return { status: 0, stdout: '', stderr: '' };
          if (failure === 'proxy-unreachable' && args.at(-1).endsWith('/7890'))
            return { status: 124, stdout: '', stderr: '' };
          if (failure === 'probe-error' && args.at(-1).endsWith('/5231'))
            return { status: 127, stdout: '', stderr: 'timeout not found' };
        }
        return f.run(cmd, args);
      },
    });
    assert.equal(result.firewall, 'failed');
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /firewall/i.test(error)));
    assert.ok(f.calls.some((call) => call.includes('remove')));
  });
}

test('firewall blocked ports are configurable and only dropped connections count as blocked', () => {
  const f = fakeHost();
  const result = checkHost({
    user: 'ian',
    name: 'cairn-orb-check-fixture',
    blockedPorts: [2222, 8080],
    run: (cmd, args) => {
      if (args.includes('timeout') && !args.at(-1).endsWith('/7890')) {
        f.calls.push([cmd, ...args]);
        return { status: 124, stdout: '', stderr: '' };
      }
      return f.run(cmd, args);
    },
  });
  assert.equal(result.firewall, 'ok');
  assert.equal(result.ok, true);
  const refused = checkHost({
    user: 'ian',
    name: 'cairn-orb-check-fixture',
    blockedPorts: [2222, 8080],
    run: (cmd, args) =>
      args.includes('timeout') && !args.at(-1).endsWith('/7890')
        ? { status: 1, stdout: '', stderr: 'Connection refused' }
        : fakeHost().run(cmd, args),
  });
  assert.notEqual(refused.firewall, 'ok');
  assert.equal(refused.ok, false);
  assert.ok(f.calls.some((call) => call.at(-1).endsWith('/2222')));
  assert.ok(f.calls.some((call) => call.at(-1).endsWith('/8080')));
});

test('invalid firewall port configuration fails before host commands', () => {
  const f = fakeHost();
  for (const blockedPorts of [
    [],
    [22],
    [22, 22],
    [22, 7890],
    [0, 5231],
    [22, 65536],
    [22, NaN],
    [22, 1.5],
  ]) {
    assert.throws(() => checkHost({ run: f.run, user: 'ian', blockedPorts }), /ports/i);
  }
  assert.equal(f.calls.length, 0);
});
