import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  installAgentDesktop,
  ownComputerRunnerEnv,
  registerOwnComputerIpc,
} from '../src/own-computer.ts';

const VERSION = '1.3.1';
const HELPER = 'agent-desktop-macos-helper';

function scratch() {
  return mkdtempSync(join(tmpdir(), 'own-computer-'));
}

function archive({ version = VERSION, helper = true, nested = false } = {}) {
  const dir = scratch();
  const content = join(dir, 'content');
  const inner = nested ? join(content, 'agent-desktop-v1.3.1') : content;
  mkdirSync(inner, { recursive: true });
  const cli = join(inner, 'agent-desktop');
  writeFileSync(
    cli,
    `#!/bin/sh\necho '{"ok":true,"command":"version","data":{"version":"${version}"}}'\n`,
  );
  chmodSync(cli, 0o755);
  if (helper) {
    writeFileSync(join(inner, HELPER), '#!/bin/sh\n');
    chmodSync(join(inner, HELPER), 0o755);
  }
  const file = join(dir, 'release.tar.gz');
  execFileSync('/usr/bin/tar', ['-czf', file, '-C', content, '.']);
  const bytes = readFileSync(file);
  return {
    bytes,
    release: {
      url: 'https://example.invalid/agent-desktop.tar.gz',
      archiveSha256: createHash('sha256').update(bytes).digest('hex'),
      binarySha256: createHash('sha256').update(readFileSync(cli)).digest('hex'),
    },
  };
}

function options(toolsRoot, made, overrides = {}) {
  let downloads = 0;
  const opts = {
    toolsRoot,
    release: made.release,
    version: VERSION,
    helper: HELPER,
    fetch: async () => {
      downloads += 1;
      return new Response(made.bytes);
    },
    ...overrides,
  };
  return { opts, downloads: () => downloads };
}

const finalBinary = (toolsRoot) => join(toolsRoot, 'agent-desktop', VERSION, 'agent-desktop');
const leftovers = (toolsRoot) =>
  existsSync(join(toolsRoot, 'agent-desktop'))
    ? readdirSync(join(toolsRoot, 'agent-desktop')).filter((name) => name !== VERSION)
    : [];

test('installs the pinned archive into the tools folder and a second run is a no-op', async () => {
  const toolsRoot = scratch();
  const made = archive();
  const { opts, downloads } = options(toolsRoot, made);
  assert.deepEqual(await installAgentDesktop(opts), { ok: true, binary: finalBinary(toolsRoot) });
  assert.equal(existsSync(join(toolsRoot, 'agent-desktop', VERSION, HELPER)), true);
  assert.deepEqual(leftovers(toolsRoot), []);
  assert.deepEqual(await installAgentDesktop(opts), { ok: true, binary: finalBinary(toolsRoot) });
  assert.equal(downloads(), 1);
});

test('an archive that nests the files in a directory installs too', async () => {
  const toolsRoot = scratch();
  const { opts } = options(toolsRoot, archive({ nested: true }));
  assert.equal((await installAgentDesktop(opts)).ok, true);
  assert.equal(existsSync(finalBinary(toolsRoot)), true);
});

test('a checksum mismatch leaves no final file', async () => {
  const toolsRoot = scratch();
  const made = archive();
  const { opts } = options(toolsRoot, {
    ...made,
    release: { ...made.release, archiveSha256: '0'.repeat(64) },
  });
  assert.deepEqual(await installAgentDesktop(opts), { ok: false, reason: 'checksum' });
  assert.equal(existsSync(finalBinary(toolsRoot)), false);
  assert.deepEqual(leftovers(toolsRoot), []);
});

test('a missing helper is an archive failure', async () => {
  const toolsRoot = scratch();
  const { opts } = options(toolsRoot, archive({ helper: false }));
  assert.deepEqual(await installAgentDesktop(opts), { ok: false, reason: 'archive' });
  assert.equal(existsSync(finalBinary(toolsRoot)), false);
  assert.deepEqual(leftovers(toolsRoot), []);
});

test('a binary answering another version is refused', async () => {
  const toolsRoot = scratch();
  const { opts } = options(toolsRoot, archive({ version: '1.0.9' }));
  assert.deepEqual(await installAgentDesktop(opts), { ok: false, reason: 'version' });
  assert.equal(existsSync(finalBinary(toolsRoot)), false);
  assert.deepEqual(leftovers(toolsRoot), []);
});

test('a failed download is a network failure', async () => {
  const toolsRoot = scratch();
  const { opts } = options(toolsRoot, archive(), {
    fetch: async () => new Response('gone', { status: 404 }),
  });
  assert.deepEqual(await installAgentDesktop(opts), { ok: false, reason: 'network' });
  const thrown = options(toolsRoot, archive(), {
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
  });
  assert.deepEqual(await installAgentDesktop(thrown.opts), { ok: false, reason: 'network' });
  assert.equal(existsSync(finalBinary(toolsRoot)), false);
});

test('an unknown architecture is unsupported', async () => {
  const toolsRoot = scratch();
  const { opts } = options(toolsRoot, archive(), { release: null });
  assert.deepEqual(await installAgentDesktop(opts), { ok: false, reason: 'unsupported' });
});

test('a changed existing install is replaced', async () => {
  const toolsRoot = scratch();
  const made = archive();
  const { opts, downloads } = options(toolsRoot, made);
  await installAgentDesktop(opts);
  writeFileSync(finalBinary(toolsRoot), '#!/bin/sh\necho tampered\n');
  assert.equal((await installAgentDesktop(opts)).ok, true);
  assert.equal(downloads(), 2);
  assert.equal(
    createHash('sha256')
      .update(readFileSync(finalBinary(toolsRoot)))
      .digest('hex'),
    made.release.binarySha256,
  );
  rmSync(toolsRoot, { recursive: true, force: true });
});

test('an existing 1.1.0 install needs the upgrade and 1.3.1 installs beside it', async () => {
  const toolsRoot = scratch();
  const oldDir = join(toolsRoot, 'agent-desktop', '1.1.0');
  mkdirSync(oldDir, { recursive: true });
  writeFileSync(join(oldDir, 'agent-desktop'), '#!/bin/sh\necho old\n');
  const made = archive();
  const { opts, downloads } = options(toolsRoot, made);
  assert.equal(existsSync(finalBinary(toolsRoot)), false);
  assert.deepEqual(await installAgentDesktop(opts), { ok: true, binary: finalBinary(toolsRoot) });
  assert.equal(downloads(), 1);
  assert.equal(existsSync(join(oldDir, 'agent-desktop')), true);
  assert.equal(existsSync(finalBinary(toolsRoot)), true);
});

test('the runner env carries the tools path and the host shell on macOS only', () => {
  assert.deepEqual(ownComputerRunnerEnv('/runner', 'darwin', VERSION), {
    CAIRN_AGENT_DESKTOP: '/runner/tools/agent-desktop/1.3.1/agent-desktop',
    CAIRN_OWN_COMPUTER: '1',
  });
  assert.deepEqual(ownComputerRunnerEnv('/runner', 'linux', VERSION), {});
});

test('a foreign frame gets nothing from the own-computer handlers', async () => {
  const handlers = new Map();
  const calls = [];
  registerOwnComputerIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    (event) => event.own === true,
    {
      install: async () => {
        calls.push('install');
        return { ok: true, binary: '/x' };
      },
      guide: async () => {
        calls.push('guide');
      },
      permissions: async () => {
        calls.push('permissions');
        return null;
      },
    },
  );
  assert.deepEqual([...handlers.keys()].sort(), [
    'own-computer:guide',
    'own-computer:install',
    'own-computer:permissions',
  ]);
  for (const handler of handlers.values()) assert.equal(await handler({ own: false }), null);
  assert.deepEqual(calls, []);
  assert.deepEqual(await handlers.get('own-computer:install')({ own: true }), {
    ok: true,
    binary: '/x',
  });
  assert.deepEqual(calls, ['install']);
});
