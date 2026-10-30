import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBroker } from './broker.mjs';

for (const groupId of [0, -1])
  test(`broker refuses GID ${groupId}`, async () => {
    await assert.rejects(
      createBroker({ socketPath: '/tmp/unused-round2.sock', groupId }),
      /Invalid socket group/,
    );
  });

test('Bash HTTP-only canary probes every URL and identity with empty arrays', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'round2-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'curl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\nprintf 401\n');
  chmodSync(join(root, 'curl'), 0o755);
  for (const users of ['', 'owner']) {
    const calls = join(root, `calls-${users}`);
    const run = spawnSync(
      '/bin/bash',
      [
        join(import.meta.dirname, 'canary.sh'),
        '--paths',
        '--server-url',
        'http://127.0.0.1:8787',
        '--server-url',
        'https://fixture.example',
        ...(users ? ['--tailscale-users', users] : []),
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, CALLS: calls },
      },
    );
    assert.equal(run.status, 0, run.stderr);
    const output = readFileSync(calls, 'utf8');
    assert.equal(output.trim().split('\n').length, 4);
    if (!users) assert.match(output, /tailscale-user-login: secret-reach-probe/);
    assert.match(output, /https:\/\/fixture.example\/api\/teams/);
    assert.match(output, /http:\/\/127.0.0.1:8787\/api\/teams/);
    if (users) assert.match(output, /tailscale-user-login: owner/);
    assert.doesNotMatch(output, /Authorization:/);
  }
});

for (const code of ['EACCES', 'EPERM', 'ENOENT'])
  test(`maps ${code} classification`, () => {
    const source = readFileSync(join(import.meta.dirname, 'process-memory.mjs'), 'utf8')
      .replace(
        /readFileSync\(`\/proc\/\$\{pid\}\/maps`, 'utf8'\)/,
        `(() => { throw Object.assign(new Error(), { code: '${code}' }); })()`,
      )
      .replace('const pid = process.argv[2];', "const pid = '123';")
      .replace(/if \(process.argv\[1\].*\) \{/, 'if (true) {');
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', source, '123'], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), code === 'ENOENT' ? 'SKIPPED' : 'BLOCKED');
  });

test('Linux canary rechecks discovered self Tailscale addresses', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'self-tail-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [command, body] of Object.entries({
    uname: 'echo Linux',
    tailscale: "printf '100.64.0.7\\nfd7a:115c:a1e0::7\\n'",
    curl: 'echo "$*" >> "$CALLS"; printf 401',
  })) {
    writeFileSync(join(root, command), `#!/bin/sh\n${body}\n`);
    chmodSync(join(root, command), 0o755);
  }
  const calls = join(root, 'calls');
  const run = spawnSync(
    '/bin/bash',
    [
      join(import.meta.dirname, 'canary.sh'),
      '--paths',
      '--server-url',
      'https://fixture.example',
      '--tailscale-users',
      'owner',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, CALLS: calls },
    },
  );
  assert.equal(run.status, 0, run.stderr);
  const output = readFileSync(calls, 'utf8');
  assert.match(output, /https:\/\/100.64.0.7\/api\/teams/);
  assert.match(output, /https:\/\/\[fd7a:115c:a1e0::7\]\/api\/teams/);
  assert.equal(output.trim().split('\n').length, 6);
});

test('operations documentation names actual protection probes and Mac token limits', () => {
  const doc = readFileSync('docs/ops/secret-reach.md', 'utf8');
  assert.match(doc, /GET.*branches\/main\/protection/);
  assert.match(doc, /DELETE.*absent branch/);
  assert.match(doc, /full.*token.*out of scope/i);
  assert.match(doc, /outside the repository.*read-only/i);
});
