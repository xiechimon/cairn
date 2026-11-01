import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readMetadata, runGuestCheck, waitForNetwork } from './guest-check.mjs';
import { checkHost, parseHostCheck } from './orb-host-check.mjs';

for (const name of [
  'pass',
  'missing-image',
  'polkit-denied',
  'no-egress',
  'private-egress',
  'firewall-open',
  'ufw-ok',
  'ufw-inactive',
  'ufw-missing-rules',
  'foreign-rules-ok',
  'foreign-rules-managed',
  'foreign-rules-lost',
  'foreign-rules-no-tun',
]) {
  test(`recorded ${name} command outputs`, () => {
    const input = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
    const result = parseHostCheck(input);
    assert.equal(
      result.ok,
      ['pass', 'ufw-ok', 'ufw-inactive', 'foreign-rules-ok', 'foreign-rules-no-tun'].includes(name),
    );
    if (name.startsWith('foreign-rules-'))
      assert.equal(result.foreignRules, name.slice('foreign-rules-'.length));
    if (name.startsWith('ufw-'))
      assert.equal(result.ufw, name.slice(4) === 'inactive' ? 'inactive' : name.slice(4));
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

function fakeHost(
  t,
  { resultChange = {}, missing = false, malformed = false, failAt, ufw = 'inactive' } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-orb-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const networkdDirectory = join(root, 'systemd');
  mkdirSync(join(networkdDirectory, 'networkd.conf.d'), { recursive: true });
  writeFileSync(
    join(networkdDirectory, 'networkd.conf.d/10-cairn-keep-foreign.conf'),
    '[Network]\nManageForeignRoutingPolicyRules=no\nManageForeignRoutes=no\n',
  );
  let prepared = false;
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    assert.ok(!args.some((arg) => arg === '-M' || arg.startsWith('--machine')));
    assert.ok(cmd !== 'systemd-run');
    assert.ok(
      cmd !== 'machinectl' ||
        !args.some((arg) => ['bind', 'shell', 'login', 'copy-to', 'copy-from'].includes(arg)),
    );
    if (cmd === 'ip') {
      if (args[0] === 'link') return { status: 0, stdout: '7: sbtun0: <POINTOPOINT,UP>\n' };
      assert.deepEqual(args, ['rule', 'show']);
      return {
        status: 0,
        stdout:
          '9002: from all lookup 2022 suppress_prefixlength 0\n9003: from all iif sbtun0 goto 9010\n',
      };
    }
    if (cmd === 'systemctl' && args[1] === 'ufw')
      return { status: ufw === 'active' ? 0 : 3, stdout: `${ufw}\n` };
    if (args.includes('not-cairn-x')) return { status: 1, stderr: 'Access denied' };
    if (failAt && args.includes(failAt)) return { status: 1, stderr: 'fixture failure' };
    let stdout = '';
    if (args.includes('list-images')) stdout = 'cairn-orb-base directory no\n';
    if (args.includes('show')) stdout = 'MemoryMax=4294967296\n';
    if (args.includes('is-active'))
      stdout = args.some((arg) => arg.startsWith('systemd-nspawn@')) ? 'inactive\n' : 'active\n';
    if (args.includes('start')) {
      const directory = join(root, args.at(-1));
      assert.equal(existsSync(directory), false);
      mkdirSync(directory, { mode: 0o700 });
      prepared = true;
    }
    if (args.includes('remove') && prepared)
      rmSync(join(root, args.at(-1)), { recursive: true, force: true });
    return { status: 0, stdout, stderr: '' };
  };
  const wait = () => {
    const directory = join(root, 'cairn-orb-check-fixture');
    if (!existsSync(join(directory, 'check-request'))) return;
    const request = JSON.parse(readFileSync(join(directory, 'check-request'), 'utf8'));
    if (!missing)
      writeFileSync(
        join(directory, 'check-result.json'),
        malformed
          ? '{'
          : JSON.stringify({
              version: 1,
              requestId: request.requestId,
              egressCode: '200',
              egressExit: 0,
              privateEgress: [
                { status: 22, code: '403' },
                { status: 22, code: '403' },
              ],
              firewallProbes: [7890, ...request.blockedPorts].map((port) => ({
                port,
                status: port === 7890 ? 0 : 124,
              })),
              homeExit: 0,
              networkReady: true,
              networkWaitMs: 50000,
              ipv4: '10.203.0.2',
              ...resultChange,
            }),
      );
  };
  return {
    calls,
    run,
    runtimeRoot: root,
    networkdDirectory,
    ufwRulesFile: join(root, 'user.rules'),
    user: 'ian',
    name: 'cairn-orb-check-fixture',
    wait,
  };
}

test('host check uses the private trigger/result bind and rejects every exec transport', (t) => {
  const f = fakeHost(t);
  const result = checkHost(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.privateEgress, 'denied');
  assert.equal(result.firewall, 'ok');
  assert.ok(f.calls.some((call) => call.includes('poweroff')));
  assert.ok(f.calls.some((call) => call.includes('remove')));
  assert.ok(!existsSync(join(f.runtimeRoot, f.name)));
});

for (const failAt of ['start', 'show', 'poweroff', 'remove']) {
  test(`${failAt} failure is reported and cleanup is attempted`, (t) => {
    const f = fakeHost(t, { failAt });
    assert.equal(checkHost(f).ok, false);
    assert.ok(f.calls.some((call) => call.includes('remove')));
    if (failAt === 'remove') assert.ok(existsSync(join(f.runtimeRoot, f.name)));
  });
}

for (const [name, options] of [
  ['missing result', { missing: true }],
  ['malformed JSON', { malformed: true }],
  ['stale request', { resultChange: { requestId: 'stale' } }],
  ['unexpected payload', { resultChange: { body: 'must not be exposed' } }],
  ['incomplete probes', { resultChange: { firewallProbes: [] } }],
  ['public egress failure', { resultChange: { egressExit: 7 } }],
  ['private egress reachable', { resultChange: { privateEgress: [{ status: 0, code: '200' }] } }],
  ['home visible', { resultChange: { homeExit: 1 } }],
]) {
  test(`${name} fails closed with bounded polling and cleanup`, (t) => {
    const f = fakeHost(t, options);
    let waits = 0;
    const result = checkHost({
      ...f,
      wait: () => {
        waits++;
        f.wait();
      },
    });
    assert.equal(result.ok, false);
    assert.ok(waits <= 239);
    assert.ok(f.calls.some((call) => call.includes('remove')));
    assert.ok(!JSON.stringify(result).includes('must not be exposed'));
  });
}

test('check refuses root, unsafe names, existing directories and symlinked results', (t) => {
  const f = fakeHost(t);
  assert.throws(() => checkHost({ ...f, user: 'root' }), /ian/);
  assert.throws(() => checkHost({ ...f, name: 'not-cairn-x' }), /name/);
  mkdirSync(join(f.runtimeRoot, f.name));
  writeFileSync(join(f.runtimeRoot, f.name, 'keep'), 'owner data');
  assert.equal(checkHost(f).ok, false);
  assert.equal(readFileSync(join(f.runtimeRoot, f.name, 'keep'), 'utf8'), 'owner data');
  rmSync(join(f.runtimeRoot, f.name), { recursive: true });
  const result = checkHost({
    ...f,
    wait: () => {
      f.wait();
      const path = join(f.runtimeRoot, f.name, 'check-result.json');
      renameSync(path, `${path}.real`);
      symlinkSync(`${path}.real`, path);
    },
  });
  assert.equal(result.ok, false);
});

test('firewall port overrides travel in the trigger metadata', (t) => {
  const f = fakeHost(t);
  assert.equal(checkHost({ ...f, blockedPorts: [2222, 8080] }).ok, true);
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

test('invalid firewall port configuration fails before host commands', () => {
  const f = { calls: [], run: () => assert.fail('unexpected command') };
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

for (const failure of ['', 'curl', 'timeout', 'test']) {
  test(`guest metadata probes execute as bounded local commands: ${failure || 'pass'}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-orb-guest-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const request = { version: 1, requestId: 'request-123', blockedPorts: [22, 5231] };
    writeFileSync(join(root, 'check-request'), JSON.stringify(request));
    const calls = [];
    runGuestCheck({
      directory: root,
      network: { readAddresses: () => '2: host0 inet 10.203.0.2/24 scope global host0' },
      run: (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === failure)
          return { status: null, stdout: 'sensitive response', stderr: 'sensitive error' };
        if (cmd === 'curl')
          return {
            status: args.includes('--fail') ? 22 : 0,
            stdout: args.includes('--fail') ? '403' : '200',
          };
        if (cmd === 'timeout') return { status: args.at(-1).endsWith('/7890') ? 0 : 124 };
        return { status: 0 };
      },
    });
    const text = readFileSync(join(root, 'check-result.json'), 'utf8');
    const result = JSON.parse(text);
    assert.equal(result.requestId, request.requestId);
    assert.equal(result.homeExit, failure === 'test' ? null : 0);
    assert.equal(result.egressExit, failure === 'curl' ? null : 0);
    assert.equal(result.firewallProbes.length, 3);
    assert.ok(!text.includes('sensitive'));
    assert.equal(calls.length, 7);
    assert.ok(calls[0].includes('--retry-all-errors'));
    assert.ok(calls[0].includes('--retry-max-time'));
    for (const port of [7890, 22, 5231]) {
      assert.ok(
        calls.some(
          (call) => call.join(' ') === `timeout 3 bash -c exec 3<>/dev/tcp/10.203.0.1/${port}`,
        ),
      );
    }
    assert.ok(
      calls
        .filter(([cmd]) => cmd === 'curl')
        .every(
          (call) =>
            call.includes('--noproxy') && call.includes('--proxy') && call.includes('/dev/null'),
        ),
    );
    assert.ok(calls.some((call) => call.join(' ') === 'test ! -e /home/ian'));
    assert.ok(!existsSync(join(root, 'check-request')));
  });
}

test('guest refuses malformed requests before invoking probes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-orb-guest-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const request of [{}, { version: 1, requestId: 'x', blockedPorts: [22, 7890] }]) {
    writeFileSync(join(root, 'check-request'), JSON.stringify(request));
    assert.throws(() =>
      runGuestCheck({ directory: root, run: () => assert.fail('unexpected probe') }),
    );
  }
  mkdirSync(join(root, 'check-result.json'));
});

test('shutdown escalation is bounded and never removes a running machine', (t) => {
  for (const stopAfterTerminate of [false, true]) {
    const f = fakeHost(t);
    let terminated = false;
    let lists = 0;
    const result = checkHost({
      ...f,
      run: (cmd, args) => {
        const value = f.run(cmd, args);
        if (args.includes('terminate')) terminated = true;
        if (args.includes('list')) {
          lists++;
          return {
            status: 0,
            stdout: terminated && stopAfterTerminate ? '' : `${f.name} container`,
          };
        }
        return value;
      },
    });
    assert.ok(terminated);
    assert.ok(lists <= 30);
    assert.equal(result.ok, stopAfterTerminate);
    assert.equal(
      f.calls.some((call) => call.includes('remove')),
      stopAfterTerminate,
    );
    assert.equal(existsSync(join(f.runtimeRoot, f.name)), !stopAfterTerminate);
  }
});

test('unexpected negative-control success cannot pass and is cleaned up', (t) => {
  const f = fakeHost(t);
  const result = checkHost({
    ...f,
    run: (cmd, args) =>
      args.includes('clone') && args.includes('not-cairn-x') ? { status: 0 } : f.run(cmd, args),
  });
  assert.equal(result.ok, false);
  assert.ok(f.calls.some((call) => call.includes('remove') && call.includes('not-cairn-x')));
});

test('metadata reader rejects symlinks, directories, and oversized payloads', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-orb-metadata-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'result');
  writeFileSync(path, ' '.repeat(16385));
  assert.throws(() => readMetadata(path), /metadata/);
  symlinkSync(path, join(root, 'link'));
  assert.throws(() => readMetadata(join(root, 'link')));
  assert.throws(() => readMetadata(root), /metadata/);
});

test('real guest Node process publishes metadata consumed by the unprivileged host lifecycle', (t) => {
  const f = fakeHost(t, { missing: true });
  const bin = join(f.runtimeRoot, 'bin');
  mkdirSync(bin);
  for (const cmd of ['curl', 'timeout', 'test', 'ip']) {
    const path = join(bin, cmd);
    writeFileSync(
      path,
      `#!${process.execPath}
const cmd = ${JSON.stringify(cmd)};
const args = process.argv.slice(2);
process.stderr.write('probe diagnostics must stay in guest');
if (cmd === 'ip') process.stdout.write('2: host0 inet 10.203.0.2/24 scope global host0');
if (cmd === 'curl') { process.stdout.write(args.includes('--fail') ? '403' : '200'); process.exit(args.includes('--fail') ? 22 : 0); }
if (cmd === 'timeout') process.exit(args.at(-1).endsWith('/7890') ? 0 : 124);
`,
    );
    chmodSync(path, 0o755);
  }
  const result = checkHost({
    ...f,
    wait: () => {
      const processResult = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { runGuestCheck } from ${JSON.stringify(new URL('./guest-check.mjs', import.meta.url).href)}; runGuestCheck({ directory: ${JSON.stringify(join(f.runtimeRoot, f.name))} });`,
        ],
        { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } },
      );
      assert.equal(processResult.status, 0, processResult.stderr);
      const metadata = readFileSync(join(f.runtimeRoot, f.name, 'check-result.json'), 'utf8');
      assert.ok(!metadata.includes('diagnostics'));
      assert.ok(!existsSync(join(f.runtimeRoot, f.name, 'check-request')));
      assert.equal(statSync(join(f.runtimeRoot, f.name, 'check-result.json')).mode & 0o777, 0o600);
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('missing root stop cleanup fails with bounded polling and preserves the directory', (t) => {
  const f = fakeHost(t);
  const result = checkHost({
    ...f,
    run: (cmd, args) => (args.includes('remove') ? { status: 0 } : f.run(cmd, args)),
  });
  assert.equal(result.ok, false);
  assert.equal(result.egress, 'ok');
  assert.ok(result.errors.some((error) => error.includes('runtime directory')));
  assert.ok(existsSync(join(f.runtimeRoot, f.name)));
});

test('host waits for root preparation and never creates its bind source', (t) => {
  const f = fakeHost(t);
  const directory = join(f.runtimeRoot, f.name);
  let waits = 0;
  const result = checkHost({
    ...f,
    run: (cmd, args) => {
      const value = f.run(cmd, args);
      if (args.includes('start')) rmSync(directory, { recursive: true });
      return value;
    },
    wait: () => {
      if (++waits === 2) mkdirSync(directory, { mode: 0o700 });
      f.wait();
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(waits >= 2);
});

test('missing root preparation times out without writing a trigger', (t) => {
  const f = fakeHost(t);
  let waits = 0;
  const result = checkHost({
    ...f,
    run: (cmd, args) => {
      const value = f.run(cmd, args);
      if (args.includes('start')) rmSync(join(f.runtimeRoot, f.name), { recursive: true });
      return value;
    },
    wait: () => waits++,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /runtime directory/.test(error)));
  assert.equal(waits, 29);
});

for (const metadata of [
  undefined,
  '{',
  '{}',
  JSON.stringify({ key: '0.3.0-abc1234', version: '0.3.0', sha: 'abc1234' }),
]) {
  test(`daemon release metadata is informational: ${metadata ?? 'missing'}`, (t) => {
    const f = fakeHost(t);
    const releaseFile = join(f.runtimeRoot, 'current.json');
    if (metadata !== undefined) writeFileSync(releaseFile, metadata);
    const result = checkHost({ ...f, releaseFile });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
      result.daemonRelease,
      metadata?.includes('abc1234') ? JSON.parse(metadata) : null,
    );
  });
}

test('the image is removed only after the container unit finished its stop hooks', (t) => {
  const f = fakeHost(t);
  let polls = 0;
  const order = [];
  const result = checkHost({
    ...f,
    run: (cmd, args) => {
      if (cmd === 'systemctl' && args.some((arg) => arg.startsWith('systemd-nspawn@'))) {
        polls += 1;
        order.push(`unit:${polls}`);
        return polls < 3
          ? { status: 3, stdout: 'deactivating\n', stderr: '' }
          : { status: 3, stdout: 'inactive\n', stderr: '' };
      }
      if (cmd === 'machinectl' && args.includes('remove') && args.includes(f.name))
        order.push('remove');
      return f.run(cmd, args);
    },
  });
  assert.equal(result.cloneStartStop, 'ok');
  assert.deepEqual(order.slice(-4), ['unit:1', 'unit:2', 'unit:3', 'remove']);
  assert.ok(!result.errors.some((error) => error.includes('is-active')));
});

for (const present of [false, true]) {
  test(`unprivileged host check diagnoses active ufw from user.rules: ${present}`, (t) => {
    const f = fakeHost(t, { ufw: 'active' });
    if (present)
      writeFileSync(
        f.ufwRulesFile,
        readFileSync(new URL('./fixtures/ufw-user.rules', import.meta.url)),
      );
    const result = checkHost(f);
    assert.equal(result.ufw, present ? 'ok' : 'missing-rules');
    assert.equal(result.ok, present);
    assert.deepEqual(
      result.errors,
      present
        ? []
        : ['ufw is active without the cairn-orb DHCP and relay rules; rerun install-host.sh'],
    );
    assert.ok(!f.calls.some(([cmd]) => cmd === 'ufw' || cmd === 'sudo'));
  });
}

test('host check permits a slow guest result within a bounded 240 second wait', (t) => {
  const f = fakeHost(t);
  let waits = 0;
  const result = checkHost({
    ...f,
    wait: () => {
      if (++waits === 200) f.wait();
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(waits, 200);
  assert.equal(result.networkWaitMs, 50000);
  assert.equal(result.ipv4, '10.203.0.2');
  assert.equal(result.networkReady, true);
});

test('invalid or timed-out guest network metadata cannot pass', (t) => {
  for (const resultChange of [
    { networkReady: false, ipv4: null },
    { networkReady: true, ipv4: '169.254.1.2' },
    { ipv4: '10.203.0.2/24' },
    { networkWaitMs: -1 },
    { networkWaitMs: '50000' },
  ]) {
    const f = fakeHost(t, { resultChange });
    assert.equal(checkHost(f).ok, false, JSON.stringify(resultChange));
  }
});

for (const [name, addresses, expectedWait] of [
  ['ready immediately', ['2: host0 inet 10.203.0.2/24 scope global host0'], 0],
  [
    'delayed DHCP after link-local',
    [
      '',
      '2: host0 inet 169.254.1.2/16 scope link host0',
      '2: host0 inet 10.203.0.3/24 scope global host0',
    ],
    2000,
  ],
  [
    'multiple addresses',
    [
      '2: host0 inet 169.254.1.2/16 scope link host0\n2: host0 inet 10.203.0.4/24 scope global host0',
    ],
    0,
  ],
]) {
  test(`network wait: ${name}`, () => {
    let elapsed = 0;
    let reads = 0;
    const result = waitForNetwork({
      readAddresses: () => addresses[Math.min(reads++, addresses.length - 1)],
      now: () => elapsed,
      wait: (ms) => {
        elapsed += ms;
      },
    });
    assert.equal(result.networkReady, true);
    assert.equal(result.networkWaitMs, expectedWait);
    assert.match(result.ipv4, /^10\.203\.0\.[234]$/);
    assert.equal(reads, expectedWait / 1000 + 1);
  });
}

for (const addresses of [
  '',
  '2: host0 inet 169.254.1.2/16 scope link host0',
  '2: host0 inet 999.1.2.3/24 scope global host0',
]) {
  test(`network wait bounds missing, link-local and invalid addresses: ${addresses}`, () => {
    let elapsed = 0;
    let reads = 0;
    const result = waitForNetwork({
      readAddresses: () => {
        reads++;
        return addresses;
      },
      now: () => elapsed,
      wait: (ms) => {
        elapsed += ms;
      },
    });
    assert.deepEqual(result, { networkReady: false, networkWaitMs: 120000, ipv4: null });
    assert.equal(reads, 121);
  });
}

test('network wait caps its last poll at the configured deadline', () => {
  let elapsed = 0;
  const result = waitForNetwork({
    timeoutMs: 2500,
    readAddresses: () => '',
    now: () => elapsed,
    wait: (ms) => {
      elapsed += ms;
    },
  });
  assert.equal(elapsed, 2500);
  assert.equal(result.networkReady, false);
});

for (const ready of [false, true]) {
  test(`guest waits before every probe and publishes network metadata even on timeout: ${ready}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-orb-network-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(
      join(root, 'check-request'),
      JSON.stringify({ version: 1, requestId: 'network-test', blockedPorts: [22, 5231] }),
    );
    let elapsed = 0;
    const calls = [];
    runGuestCheck({
      directory: root,
      network: {
        timeoutMs: 2000,
        now: () => elapsed,
        wait: (ms) => {
          elapsed += ms;
        },
      },
      run: (cmd, args) => {
        calls.push(cmd);
        if (cmd === 'ip') {
          assert.deepEqual(args, ['-4', '-o', 'addr', 'show', 'dev', 'host0']);
          return {
            status: 0,
            stdout:
              elapsed === 2000 && ready ? '2: host0 inet 10.203.0.2/24 scope global host0' : '',
          };
        }
        assert.equal(elapsed, 2000);
        return { status: 7, stdout: '000' };
      },
    });
    const result = JSON.parse(readFileSync(join(root, 'check-result.json'), 'utf8'));
    assert.equal(result.networkReady, ready);
    assert.equal(result.networkWaitMs, 2000);
    assert.equal(result.ipv4, ready ? '10.203.0.2' : null);
    assert.deepEqual(calls.slice(0, 3), ['ip', 'ip', 'ip']);
    assert.equal(calls.filter((cmd) => cmd !== 'ip').length, 7);
  });
}

for (const [name, rules] of [
  ['both absent', '0: from all lookup local\n32766: from all lookup main\n'],
  ['table absent', '9003: from all iif sbtun0 goto 9010\n'],
  ['interface absent', '9002: from all lookup 2022 suppress_prefixlength 0\n'],
  ['similar tokens', '9002: from all lookup 20220\n9003: from all iif sbtun01 goto 9010\n'],
]) {
  test(`sing-box rules lost: ${name}`, (t) => {
    const f = fakeHost(t);
    const result = checkHost({
      ...f,
      run: (cmd, args) =>
        cmd === 'ip' && args[0] === 'rule' ? { status: 0, stdout: rules } : f.run(cmd, args),
    });
    assert.equal(result.foreignRules, 'lost');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.includes(
        'sing-box tun policy rules (table 2022) are missing; restart sing-box',
      ),
    );
  });
}

for (const config of [
  '',
  '[Network]\nManageForeignRoutingPolicyRules=yes\n',
  '# ManageForeignRoutingPolicyRules=no\n',
  '[Link]\nManageForeignRoutingPolicyRules=no\n',
]) {
  test(`active networkd diagnoses managed foreign rules: ${JSON.stringify(config)}`, (t) => {
    const f = fakeHost(t);
    writeFileSync(join(f.networkdDirectory, 'networkd.conf.d/10-cairn-keep-foreign.conf'), config);
    const result = checkHost(f);
    assert.equal(result.foreignRules, 'managed');
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.includes(
        'systemd-networkd manages foreign routing policy rules; set ManageForeignRoutingPolicyRules=no',
      ),
    );
    assert.ok(!f.calls.some(([cmd]) => cmd === 'sudo'));
  });
}

for (const source of ['networkd.conf', 'networkd.conf.d/90-local.conf']) {
  test(`equivalent foreign routing settings in ${source} are accepted`, (t) => {
    const f = fakeHost(t);
    rmSync(join(f.networkdDirectory, 'networkd.conf.d/10-cairn-keep-foreign.conf'));
    writeFileSync(
      join(f.networkdDirectory, source),
      '# Local policy\n[Network]\nManageForeignRoutingPolicyRules = no\nManageForeignRoutes=no\n',
    );
    const result = checkHost(f);
    assert.equal(result.foreignRules, 'ok');
    assert.equal(result.ok, true, JSON.stringify(result));
  });
}

test('later drop-ins override main and earlier foreign routing settings', (t) => {
  const f = fakeHost(t);
  writeFileSync(
    join(f.networkdDirectory, 'networkd.conf'),
    '[Network]\nManageForeignRoutingPolicyRules=yes\n',
  );
  assert.equal(checkHost(f).foreignRules, 'ok');
  writeFileSync(
    join(f.networkdDirectory, 'networkd.conf.d/90-local.conf'),
    '[Network]\nManageForeignRoutingPolicyRules=yes\n',
  );
  assert.equal(checkHost(f).foreignRules, 'managed');
});

test('a host without sbtun0 reports no-tun without requiring policy rules', (t) => {
  const f = fakeHost(t);
  const result = checkHost({
    ...f,
    run: (cmd, args) => {
      if (cmd === 'ip' && args[0] === 'link') {
        assert.deepEqual(args, ['link', 'show', 'dev', 'sbtun0']);
        return { status: 1, stderr: 'Device sbtun0 does not exist' };
      }
      if (cmd === 'ip') assert.fail('no tun needs no policy rule query');
      return f.run(cmd, args);
    },
  });
  assert.equal(result.foreignRules, 'no-tun');
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('inactive networkd does not manage foreign rules', (t) => {
  const f = fakeHost(t);
  rmSync(f.networkdDirectory, { recursive: true });
  const result = checkHost({
    ...f,
    run: (cmd, args) =>
      cmd === 'systemctl' && args[1] === 'systemd-networkd.service'
        ? { status: 3, stdout: 'inactive\n' }
        : f.run(cmd, args),
  });
  assert.equal(result.foreignRules, 'ok');
  assert.equal(result.ok, true, JSON.stringify(result));
});
