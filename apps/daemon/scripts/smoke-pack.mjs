#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTERNALS } from '../externals.mjs';

const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
const BIN_NAME = Object.keys(pkg.bin)[0];
const BIN_PATH = pkg.bin[BIN_NAME];
const TARBALL_NAME = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;

class SmokeStepError extends Error {}

function run(cmd, args, opts) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function fmt(r) {
  return `${r.status}\n${r.stdout}\n${r.stderr}`;
}

function step(name, ok, detail) {
  if (!ok) {
    console.error(`smoke: FAIL ${name}`);
    if (detail) console.error(detail);
    process.exitCode = 1;
    throw new SmokeStepError(name);
  }
  console.log(`smoke: ok ${name}`);
}

function nodeTooOld() {
  const min = pkg.engines.node.replace(/^>=/, '').split('.').map(Number);
  const now = process.versions.node.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((now[i] ?? 0) !== (min[i] ?? 0)) return (now[i] ?? 0) < (min[i] ?? 0);
  }
  return false;
}

const packDir = mkdtempSync(join(tmpdir(), 'cairn-cli-pack-'));
const installDir = mkdtempSync(join(tmpdir(), 'cairn-cli-smoke-'));
try {
  step(`node engines ${pkg.engines.node}`, !nodeTooOld());

  const packed = run('pnpm', ['pack', '--pack-destination', packDir], { cwd: PKG_DIR });
  step('pnpm pack (workspace:* resolved out of dependencies)', packed.status === 0, fmt(packed));
  const tarball = join(packDir, TARBALL_NAME);

  const listed = run('tar', ['-tzf', tarball]);
  step('tar -tzf', listed.status === 0, fmt(listed));
  const entries = listed.stdout.split('\n').filter(Boolean);
  step(
    'tarball contains the bin artifact',
    entries.includes(`package/${BIN_PATH.replace('./', '')}`),
    entries.join('\n'),
  );
  step(
    'tarball excludes src/test',
    !entries.some((e) => /^package\/(src|test)\//.test(e)),
    entries.join('\n'),
  );

  const manifestOut = run('tar', ['-xzf', tarball, '-O', 'package/package.json']);
  step('manifest extraction', manifestOut.status === 0, fmt(manifestOut));
  const manifest = JSON.parse(manifestOut.stdout);
  const depSpecs = JSON.stringify({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  });
  step(
    'manifest has no workspace:/catalog: left',
    !depSpecs.includes('workspace:') && !depSpecs.includes('catalog:'),
    depSpecs,
  );
  for (const external of EXTERNALS) {
    step(
      `manifest declares external ${external}`,
      manifest.dependencies?.[external] !== undefined,
      depSpecs,
    );
  }

  writeFileSync(
    join(installDir, 'package.json'),
    `${JSON.stringify({ name: 'cairn-cli-smoke', private: true }, null, 2)}\n`,
  );
  const installed = run('npm', ['install', tarball], { cwd: installDir });
  step('npm install tarball', installed.status === 0, fmt(installed));

  const installedBin = join(installDir, 'node_modules', pkg.name, BIN_PATH);

  const help = run('node', [installedBin, '--help']);
  step(
    'node <dist/cli.mjs> --help exits 0 and prints Usage',
    help.status === 0 && help.stdout.includes('Usage:'),
    fmt(help),
  );

  const version = run('node', [installedBin, '--version']);
  step(
    '--version === package.json version',
    version.status === 0 && version.stdout.trim() === pkg.version,
    fmt(version),
  );

  const binLink = run('node', [join(installDir, 'node_modules', '.bin', BIN_NAME), '--version']);
  step(
    'node <.bin/cairn> --version === package.json version',
    binLink.status === 0 && binLink.stdout.trim() === pkg.version,
    fmt(binLink),
  );
} catch (err) {
  if (!(err instanceof SmokeStepError)) throw err;
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(installDir, { recursive: true, force: true });
}
