import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { install, sudoersPath, sudoersRule } from './install.mjs';
import { installedLayout, validateConfig, wrapperScript } from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '../../..');
const gitPath = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const scratch = [];

after(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

function fixture({ visudoExit = 0 } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'cairn-ops-install-'));
  scratch.push(base);
  const root = join(base, 'root');
  for (const directory of [
    'usr/local/lib',
    'usr/local/sbin',
    'etc/sudoers.d',
    'var/lib',
    'var/log',
  ])
    mkdirSync(join(root, directory), { recursive: true });
  const visudo = join(base, 'visudo');
  writeFileSync(
    visudo,
    `#!/bin/sh\n[ "$1" = -cf ] && [ -f "$2" ] || exit 3\nexit ${visudoExit}\n`,
    {
      mode: 0o755,
    },
  );
  const lines = [];
  const options = {
    root,
    owner: process.getuid(),
    group: process.getgid(),
    euid: process.getuid(),
    visudo,
    git: gitPath,
    tools: [visudo, gitPath],
    log: (line) => lines.push(line),
  };
  return { base, root, options, lines };
}

function mode(path) {
  return lstatSync(path).mode & 0o7777;
}

test('dry run lists every change and touches nothing', () => {
  const { root, options, lines } = fixture();
  const changed = install({ ...options, dryRun: true });
  assert.ok(changed > 0);
  assert.ok(
    lines.slice(0, -1).every((line) => line.startsWith('would ')),
    lines.join('\n'),
  );
  for (const path of [
    installedLayout.runner,
    installedLayout.module,
    installedLayout.config,
    sudoersPath,
  ])
    assert.ok(
      lines.some((line) => line.includes(path)),
      path,
    );
  assert.equal(existsSync(join(root, installedLayout.runner)), false);
  assert.equal(existsSync(join(root, sudoersPath)), false);
  assert.match(lines.at(-1), /dry run/);
});

test('installs root-only layout, mirror and sudoers rule, then is idempotent', () => {
  const { root, options, lines } = fixture();
  install(options);
  const at = (path) => join(root, path);
  assert.equal(readFileSync(at(installedLayout.runner), 'utf8'), wrapperScript(installedLayout));
  assert.equal(mode(at(installedLayout.runner)), 0o755);
  assert.equal(
    readFileSync(at(installedLayout.module), 'utf8'),
    readFileSync(join(here, 'run.mjs'), 'utf8'),
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(dirname(at(installedLayout.module)), 'layout.json'), 'utf8')),
    installedLayout,
  );
  assert.equal(
    readFileSync(at(installedLayout.config), 'utf8'),
    readFileSync(join(here, 'tasks.json'), 'utf8'),
  );
  assert.equal(mode(at(installedLayout.state)), 0o711);
  assert.equal(mode(at(installedLayout.work)), 0o711);
  assert.equal(mode(at(installedLayout.mirror)), 0o700);
  assert.equal(
    execFileSync(
      gitPath,
      ['--git-dir', at(installedLayout.mirror), 'rev-parse', '--is-bare-repository'],
      {
        encoding: 'utf8',
      },
    ).trim(),
    'true',
  );
  assert.equal(mode(at(installedLayout.log)), 0o644);
  assert.equal(readFileSync(at(sudoersPath), 'utf8'), sudoersRule('ian'));
  assert.equal(mode(at(sudoersPath)), 0o440);
  assert.match(
    readFileSync(at(sudoersPath), 'utf8'),
    /^ian ALL=\(root\) NOPASSWD: \/usr\/local\/sbin\/cairn-ops-run$/m,
  );

  writeFileSync(at(installedLayout.log), '{"event":"start"}\n');
  lines.length = 0;
  assert.equal(install(options), 0);
  assert.deepEqual(lines, ['cairn-ops: already installed, nothing to change']);
  assert.equal(readFileSync(at(installedLayout.log), 'utf8'), '{"event":"start"}\n');
});

test('repairs drifted modes and content and prints each repair', () => {
  const { root, options, lines } = fixture();
  install(options);
  chmodSync(join(root, installedLayout.config), 0o666);
  writeFileSync(join(root, installedLayout.runner), '#!/bin/sh\nexec /tmp/evil\n');
  lines.length = 0;
  install(options);
  assert.ok(
    lines.some((line) => line === `chmod ${installedLayout.config} 0666 -> 0644`),
    lines.join('\n'),
  );
  assert.ok(
    lines.some((line) => line.startsWith(`write ${installedLayout.runner}`)),
    lines.join('\n'),
  );
  assert.equal(mode(join(root, installedLayout.config)), 0o644);
  assert.equal(
    readFileSync(join(root, installedLayout.runner), 'utf8'),
    wrapperScript(installedLayout),
  );
});

test('aborts before any change when visudo rejects the rule', () => {
  const { root, options } = fixture({ visudoExit: 1 });
  assert.throws(() => install(options), /visudo rejected/);
  assert.equal(existsSync(join(root, installedLayout.runner)), false);
  assert.equal(existsSync(join(root, sudoersPath)), false);
});

test('refuses symlinked targets', () => {
  const { base, root, options } = fixture();
  mkdirSync(join(root, 'etc/cairn-ops'));
  writeFileSync(join(base, 'elsewhere.json'), '{}');
  symlinkSync(join(base, 'elsewhere.json'), join(root, installedLayout.config));
  assert.throws(() => install(options), /is a symlink/);
  assert.equal(existsSync(join(root, installedLayout.runner)), false);
  assert.equal(readFileSync(join(base, 'elsewhere.json'), 'utf8'), '{}');
});

test('refuses to apply without root and refuses an invalid task configuration', () => {
  const { base, options } = fixture();
  assert.throws(() => install({ ...options, euid: process.getuid() + 1 }), /must run as root/);
  const source = join(base, 'source');
  mkdirSync(source);
  copyFileSync(join(here, 'run.mjs'), join(source, 'run.mjs'));
  writeFileSync(
    join(source, 'tasks.json'),
    JSON.stringify({
      source: { url: 'https://github.com/xiechimon/cairn.git', branch: 'main' },
      tasks: {
        bad: {
          directory: 'scripts',
          interpreter: '/bin/sh',
          entry: 'x',
          args: [],
          env: { LD_PRELOAD: '.*' },
        },
      },
    }),
  );
  assert.throws(() => install({ ...options, source }), /may not allow LD_PRELOAD/);
});

test('shipped tasks name fixed entries inside their directories', () => {
  const config = validateConfig(JSON.parse(readFileSync(join(here, 'tasks.json'), 'utf8')));
  assert.deepEqual(Object.keys(config.tasks).sort(), ['orb-install-host', 'secret-reach-setup']);
  assert.equal(config.tasks['orb-install-host'].directory, 'scripts/ops/orb');
  assert.equal(config.tasks['orb-install-host'].entry, 'install-host.sh');
  assert.equal(config.tasks['secret-reach-setup'].directory, 'scripts/ops/secret-reach');
  assert.ok(existsSync(join(repository, 'scripts/ops/secret-reach/setup-runner-user.sh')));
  assert.equal(config.source.url, 'https://github.com/xiechimon/cairn.git');
  assert.equal(config.source.branch, 'main');
});

test('install.sh rejects unexpected arguments before running anything', () => {
  for (const args of [['--force'], ['--dry-run', 'x']]) {
    const result = spawnSync('/bin/sh', [join(here, 'install.sh'), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: install.sh/);
  }
});
