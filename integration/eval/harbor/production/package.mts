import { execFile } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

export interface RuntimePackageManifest {
  bundleSha256: string;
  bundleBytes: number;
  packages: { name: string; version: string }[];
}

export async function packageProductionRuntime(input: {
  candidateRoot: string;
  dependencyRoot: string;
  outputDir: string;
}): Promise<RuntimePackageManifest> {
  const candidateRoot = realpathSync(input.candidateRoot);
  const dependencyRoot = realpathSync(input.dependencyRoot);
  const outputDir = resolve(input.outputDir);
  mkdirSync(outputDir);
  const args = [
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--clearenv',
    '--ro-bind',
    '/usr',
    '/usr',
    '--symlink',
    'usr/bin',
    '/bin',
    '--ro-bind',
    '/lib',
    '/lib',
    '--ro-bind',
    '/lib64',
    '/lib64',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--setenv',
    'PATH',
    '/usr/bin:/bin',
    '--setenv',
    'HOME',
    '/tmp',
    '--ro-bind',
    realpathSync(process.execPath),
    '/runtime-node',
    '--ro-bind',
    join(import.meta.dirname, 'package-worker.mjs'),
    '/builder/package-worker.mjs',
    '--bind',
    outputDir,
    '/output',
  ];
  for (const path of [
    'apps/daemon/src',
    'packages/shared/src',
    'packages/shared/merge-gate-paths.json',
    'integration/eval/harbor/production/runner.mts',
    'integration/eval/harbor/production/run-task.mts',
  ]) {
    const source = realpathSync(join(candidateRoot, path));
    const fromRoot = relative(candidateRoot, source);
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot))
      throw new Error('Source mount escapes candidate root');
    args.push('--ro-bind', source, `/source/${path}`);
  }
  for (const path of ['node_modules', 'apps/daemon/node_modules']) {
    const source = realpathSync(join(dependencyRoot, path));
    const fromRoot = relative(dependencyRoot, source);
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot))
      throw new Error('Dependency mount escapes trusted root');
    args.push('--ro-bind', source, `/deps/${path}`);
  }
  args.push('--chdir', '/tmp', '/runtime-node', '/builder/package-worker.mjs');
  const { stdout } = await promisify(execFile)('/usr/bin/bwrap', args, {
    env: {},
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
  });
  return JSON.parse(stdout) as RuntimePackageManifest;
}
