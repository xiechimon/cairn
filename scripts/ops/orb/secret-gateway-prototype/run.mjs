import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { certificates } from './certificates.mjs';
import { gateway } from './gateway.mjs';

const exec = promisify(execFile);
const image = process.env.PROTOTYPE_IMAGE;
const evidencePath = process.env.PROTOTYPE_EVIDENCE;
if (!image || !evidencePath) throw new Error('Set PROTOTYPE_IMAGE and PROTOTYPE_EVIDENCE');
const directory = await mkdtemp(join(tmpdir(), 'cairn-gateway-'));
const value = randomBytes(32).toString('hex');
const placeholder = `cairn-placeholder-${randomBytes(32).toString('hex')}`;
const audit = [];
const upstreamReceipts = [];
const agentArtifacts = [];
const containerNames = [];
const interception = await certificates('allowed.test');
const upstreamTls = await certificates('allowed.test');
const wrongTls = await certificates('wrong.test');
let upstreamPort;
const upstream = createServer(upstreamTls, (req, res) => {
  const bound = req.rawHeaders.filter(
    (entry, i) => i % 2 === 0 && entry.toLowerCase() === 'authorization',
  );
  upstreamReceipts.push({
    header: 'authorization',
    exactValue: req.headers.authorization === `Bearer ${value}`,
    singleHeader: bound.length === 1,
    absentElsewhere:
      !req.url.includes(value) &&
      Object.entries(req.headers).every(
        ([name, content]) => name === 'authorization' || !String(content).includes(value),
      ),
    path: req.url,
  });
  if (req.url === '/redirect') res.writeHead(302, { location: 'https://disallowed.test/leak' });
  else res.writeHead(200);
  res.end('fixture response without credential');
});
upstream.on('tlsClientError', () => {});
const badUpstream = createServer(wrongTls, (_req, res) => res.end('must not arrive'));
badUpstream.on('tlsClientError', () => {});
const prototype = gateway({
  tls: interception,
  upstreamCa: `${upstreamTls.ca}\n${wrongTls.ca}`,
  upstreamPort: () => upstreamPort,
  audit,
});
let admin;
try {
  await new Promise((done) => upstream.listen(0, '127.0.0.1', done));
  await new Promise((done) => badUpstream.listen(0, '127.0.0.1', done));
  upstreamPort = upstream.address().port;
  const goodPort = upstreamPort;
  for (const guest of ['a', 'b']) {
    const path = join(directory, guest);
    await mkdir(path, { mode: 0o700 });
    await writeFile(join(path, 'ca.pem'), interception.ca, { mode: 0o400 });
    const listener = prototype.listener(guest);
    listener.listen(join(path, 'egress.sock'));
    await once(listener, 'listening');
    await chmod(join(path, 'egress.sock'), 0o600);
  }
  prototype.admin.listen(join(directory, 'admin.sock'));
  await once(prototype.admin, 'listening');
  await chmod(join(directory, 'admin.sock'), 0o600);
  admin = connect(join(directory, 'admin.sock'));
  await once(admin, 'connect');
  const accepted = once(admin, 'data');
  admin.write(
    `${JSON.stringify({ guest: 'a', origin: 'https://allowed.test', header: 'authorization', template: 'Bearer {secret}', value, placeholder })}\n`,
  );
  assert.ok(JSON.parse(String((await accepted)[0])).accepted, 'registration must succeed');
  const client = await readFile(new URL('./guest.mjs', import.meta.url), 'utf8');
  const cases = [
    { name: 'authorized', status: 200, receipts: 1 },
    { name: 'wrong-host', authority: 'disallowed.test:443', connectStatus: 403 },
    { name: 'wrong-port', authority: 'allowed.test:444', connectStatus: 403 },
    { name: 'host-mismatch', host: 'disallowed.test', status: 403 },
    { name: 'sni-mismatch', sni: 'wrong.test', status: 403 },
    { name: 'missing-sni', sni: '', status: 403 },
    { name: 'wrong-header', extraHeaders: ['X-Leak: {placeholder}'], status: 403 },
    { name: 'wrong-path', path: '/{placeholder}', status: 403 },
    {
      name: 'duplicate-header',
      extraHeaders: ['Authorization: Bearer {placeholder}'],
      status: 403,
    },
    { name: 'trace', method: 'TRACE', status: 403 },
    { name: 'absolute-target', path: 'https://allowed.test/ok', status: 403 },
    { name: 'redirect', path: '/redirect', status: 302, receipts: 1 },
    { name: 'redirect-destination', authority: 'disallowed.test:443', connectStatus: 403 },
    { name: 'other-guest', guest: 'b', connectStatus: 403 },
    { name: 'missing-ca', trust: false, tlsFailure: true },
    { name: 'invalid-upstream-certificate', invalidUpstream: true, status: 502 },
    { name: 'authorized-after-refusals', status: 200, receipts: 1 },
    { name: 'revoked', revoke: true, connectStatus: 403 },
  ];
  const checks = [];
  for (const fixture of cases) {
    console.error(`Probe: ${fixture.name}`);
    upstreamPort = fixture.invalidUpstream ? badUpstream.address().port : goodPort;
    if (fixture.revoke) {
      admin.end();
      await once(admin, 'close');
      assert.ok(
        audit.some((event) => event.decision === 'revoked'),
        'admin close must revoke',
      );
    }
    const before = upstreamReceipts.length;
    const name = `cairn-gateway-${randomUUID()}`;
    containerNames.push(name);
    const child = spawn(
      'podman',
      [
        'run',
        '--rm',
        '--pull=never',
        `--name=${name}`,
        '--network=none',
        '--read-only',
        '--cap-drop=all',
        '--security-opt=no-new-privileges',
        '--userns=keep-id',
        '--pids-limit=64',
        '--memory=256m',
        '--ulimit=core=0',
        '--mount',
        `type=bind,src=${join(directory, fixture.guest ?? 'a')},dst=/egress,ro=true`,
        '--env',
        `PROTOTYPE_CASE=${JSON.stringify({ ...fixture, placeholder })}`,
        '--entrypoint=node',
        '-i',
        image,
        '--input-type=module',
      ],
      { stdio: 'pipe', signal: AbortSignal.timeout(15000) },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const closed = once(child, 'close');
    child.stdin.end(client);
    let code;
    try {
      [code] = await closed;
    } catch {
      assert.ok(!stdout.includes(value) && !stderr.includes(value), 'no plaintext in guest output');
      console.error(
        JSON.stringify({
          case: fixture.name,
          stdoutBytes: stdout.length,
          stderrBytes: stderr.length,
        }),
      );
      throw new Error(`Guest startup or exit timeout: ${fixture.name}`);
    }
    assert.ok(!stdout.includes(value) && !stderr.includes(value), 'no plaintext in guest output');
    agentArtifacts.push({ stdout, stderr });
    assert.ok(code === 0, `guest must exit cleanly: ${fixture.name}`);
    const result = JSON.parse(stdout);
    assert.deepEqual(result.interfaces, ['lo']);
    assert.deepEqual(result.visibleFiles, ['ca.pem', 'egress.sock']);
    assert.ok(result.readOnlyListener, 'guest must not write the listener directory');
    assert.ok(result.otherGuestAndAdminAbsent, 'guest must not see other listeners or admin');
    assert.ok(result.toolResult.header.includes(placeholder), 'tool result must hold placeholder');
    if (fixture.status) assert.ok(result.status === fixture.status, `HTTP status: ${fixture.name}`);
    if (fixture.connectStatus)
      assert.ok(result.connectStatus === fixture.connectStatus, `CONNECT status: ${fixture.name}`);
    if (fixture.tlsFailure) assert.ok(result.tlsFailure, `TLS refusal: ${fixture.name}`);
    assert.ok(
      upstreamReceipts.length - before === (fixture.receipts ?? 0),
      `upstream receipt count: ${fixture.name}`,
    );
    checks.push({
      case: fixture.name,
      passed: true,
      status: result.status ?? result.connectStatus,
      tlsFailure: result.tlsFailure ?? false,
    });
  }
  assert.ok(
    upstreamReceipts.every(
      (entry) => entry.exactValue && entry.singleHeader && entry.absentElsewhere,
    ),
    'real value must occur only in one outbound header',
  );
  const evidence = {
    candidate: 'standalone Node relay experiment',
    testedAt: new Date().toISOString(),
    sourceHashes: Object.fromEntries(
      await Promise.all(
        ['run.mjs', 'guest.mjs', 'gateway.mjs', 'certificates.mjs', 'package-lock.json'].map(
          async (file) => [
            file,
            createHash('sha256')
              .update(await readFile(new URL(file, import.meta.url)))
              .digest('hex'),
          ],
        ),
      ),
    ),
    image,
    network: 'none',
    readOnlyRoot: true,
    droppedCapabilities: 'all',
    checks,
    upstreamReceipts,
    audit,
    agentArtifacts,
    notCovered: [
      'Envoy comparison',
      'production relay integration and ordinary egress',
      'daemon step E2E (#4543)',
      'SDK/model transcripts',
      'curl/git/Python/claude trust matrix',
      'nspawn',
      'restart recovery and in-flight revoke',
    ],
  };
  assert.ok(!JSON.stringify(evidence).includes(value), 'no plaintext in evidence');
  const output = resolve(evidencePath);
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(
    JSON.stringify({
      passed: checks.length,
      upstreamReceipts: upstreamReceipts.length,
      plaintextMatches: 0,
      evidence: output,
      notCovered: evidence.notCovered,
    }),
  );
} finally {
  admin?.destroy();
  prototype.close();
  upstream.closeAllConnections();
  badUpstream.closeAllConnections();
  upstream.close();
  badUpstream.close();
  if (containerNames.length) await exec('podman', ['rm', '--force', '--ignore', ...containerNames]);
  await rm(directory, { recursive: true, force: true });
}
