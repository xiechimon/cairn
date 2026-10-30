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

for (const proxyVariable of ['HTTP_PROXY', 'HTTPS_PROXY'])
  for (const status of ['200', '204', '299', '401', 'transport'])
    test(`${proxyVariable} probes both identities on every direct and proxy endpoint with ${status}`, (t) => {
      const root = mkdtempSync(join(tmpdir(), 'proxy-canary-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      writeFileSync(
        join(root, 'curl'),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "$CALLS"\ncase "$*" in *--proxy*) ${status === 'transport' ? 'exit 7' : `printf ${status}`};; *) printf 401;; esac\n`,
      );
      chmodSync(join(root, 'curl'), 0o755);
      writeFileSync(join(root, 'uname'), '#!/bin/sh\necho Darwin\n');
      chmodSync(join(root, 'uname'), 0o755);
      const calls = join(root, 'calls');
      const run = spawnSync(
        '/bin/bash',
        [
          join(import.meta.dirname, 'canary.sh'),
          '--server-url',
          'http://localhost:8787',
          '--server-url',
          'https://fixture.example',
          '--tailscale-users',
          'owner',
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            HTTP_PROXY: '',
            HTTPS_PROXY: '',
            [proxyVariable]: 'http://proxy.invalid:7890',
            NO_PROXY: '*',
            CALLS: calls,
          },
        },
      );
      assert.equal(run.status, status.startsWith('2') ? 1 : 0, run.stderr);
      const lines = readFileSync(calls, 'utf8').trim().split('\n');
      assert.equal(lines.length, 8);
      for (const url of ['http://localhost:8787', 'https://fixture.example']) {
        const endpoint = lines.filter((line) => line.includes(`${url}/api/teams`));
        assert.equal(endpoint.length, 4);
        for (const proxy of [false, true]) {
          const leg = endpoint.filter((line) => line.includes('--proxy') === proxy);
          assert.equal(leg.length, 2);
          assert.equal(
            leg.filter((line) => line.includes('tailscale-user-login: owner')).length,
            1,
          );
          assert.ok(leg.every((line) => !line.includes('Authorization:')));
          assert.ok(
            leg.every((line) =>
              proxy
                ? !line.includes('--noproxy *') &&
                  line.includes('--proxy http://proxy.invalid:7890')
                : line.includes('--noproxy *'),
            ),
          );
        }
      }
      t.diagnostic(run.stdout.trim());
    });

test('all skipped process channels fail without claiming isolation', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skipped-canary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'uname'), '#!/bin/sh\necho Darwin\n');
  chmodSync(join(root, 'uname'), 0o755);
  const run = spawnSync('/bin/bash', [join(import.meta.dirname, 'canary.sh'), '--pid', '123'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${root}:${process.env.PATH}` },
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /SKIPPED/);
});
