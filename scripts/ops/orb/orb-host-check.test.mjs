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
import { readMetadata, runGuestCheck } from './guest-check.mjs';
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

function fakeHost(t, { resultChange = {}, missing = false, malformed = false, failAt } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-orb-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    assert.ok(!args.some((arg) => arg === '-M' || arg.startsWith('--machine')));
    assert.ok(cmd !== 'systemd-run');
    assert.ok(
      cmd !== 'machinectl' ||
        !args.some((arg) => ['bind', 'shell', 'login', 'copy-to', 'copy-from'].includes(arg)),
    );
    if (args.includes('not-cairn-x')) return { status: 1, stderr: 'Access denied' };
    if (failAt && args.includes(failAt)) return { status: 1, stderr: 'fixture failure' };
    let stdout = '';
    if (args.includes('list-images')) stdout = 'cairn-orb-base directory no\n';
    if (args.includes('show')) stdout = 'MemoryMax=4294967296\n';
    if (args.includes('is-active')) stdout = 'active\n';
    if (args.includes('start')) {
      const directory = join(root, args.at(-1));
      assert.equal(statSync(directory).mode & 0o777, 0o700);
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
                ...resultChange,
              }),
        );
    }
    return { status: 0, stdout, stderr: '' };
  };
  return {
    calls,
    run,
    runtimeRoot: root,
    user: 'ian',
    name: 'cairn-orb-check-fixture',
    wait: () => {},
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
    const result = checkHost({ ...f, wait: () => waits++ });
    assert.equal(result.ok, false);
    assert.ok(waits <= 149);
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
    run: (cmd, args) => {
      const value = f.run(cmd, args);
      if (args.includes('start')) {
        const path = join(f.runtimeRoot, f.name, 'check-result.json');
        renameSync(path, `${path}.real`);
        symlinkSync(`${path}.real`, path);
      }
      return value;
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
  for (const cmd of ['curl', 'timeout', 'test']) {
    const path = join(bin, cmd);
    writeFileSync(
      path,
      `#!${process.execPath}
const cmd = ${JSON.stringify(cmd)};
const args = process.argv.slice(2);
process.stderr.write('probe diagnostics must stay in guest');
if (cmd === 'curl') { process.stdout.write(args.includes('--fail') ? '403' : '200'); process.exit(args.includes('--fail') ? 22 : 0); }
if (cmd === 'timeout') process.exit(args.at(-1).endsWith('/7890') ? 0 : 124);
`,
    );
    chmodSync(path, 0o755);
  }
  const result = checkHost({
    ...f,
    run: (cmd, args) => {
      const response = f.run(cmd, args);
      if (args.includes('start')) {
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
        assert.equal(
          statSync(join(f.runtimeRoot, f.name, 'check-result.json')).mode & 0o777,
          0o600,
        );
      }
      return response;
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('runtime cleanup errors preserve structured failure metadata and the directory', (t) => {
  const f = fakeHost(t);
  const result = checkHost({
    ...f,
    removeRuntime: () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.egress, 'ok');
  assert.ok(
    result.errors.some((error) => error.includes('runtime directory') && error.includes('EACCES')),
  );
  assert.ok(existsSync(join(f.runtimeRoot, f.name)));
});
