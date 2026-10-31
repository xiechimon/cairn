import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { OrbCommandRunner, OrbExecResult } from './provider.js';

async function checkoutCommand(runner: OrbCommandRunner, checkout: string, args: string[]) {
  const result = await runner(['git', '-C', checkout, ...args], {
    signal: AbortSignal.timeout(30_000),
  });
  if (result.code !== 0)
    throw new Error(`Orb daemon checkout git ${args[0]} failed (${result.code}): ${result.stderr}`);
  return result.stdout;
}

function publishLink(root: string, target: string, name: string) {
  const temporary = join(root, `.${name}-${randomUUID()}`);
  try {
    symlinkSync(target, temporary);
    renameSync(temporary, join(root, name));
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function publishOrbDist(
  distSource: string,
  root: string,
  runner: OrbCommandRunner,
  retainedKeys: () => ReadonlySet<string> | undefined = () => new Set(),
) {
  const checkout = resolve(distSource, '../../..');
  const { version } = JSON.parse(
    readFileSync(join(checkout, 'apps/daemon/package.json'), 'utf8'),
  ) as { version: unknown };
  if (
    typeof version !== 'string' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/.test(version)
  )
    throw new Error('Orb daemon checkout has an invalid package version');
  const sha = (await checkoutCommand(runner, checkout, ['rev-parse', '--short', 'HEAD'])).trim();
  if (!/^[a-f0-9]{4,40}$/.test(sha)) throw new Error('Orb daemon checkout has an invalid git SHA');
  const builtHash = createHash('sha256');
  const hashDirectory = async (directory: string, prefix: string): Promise<void> => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const metadata = statSync(path);
      const relative = `${prefix}${name}`;
      builtHash.update(JSON.stringify([relative, metadata.mode, metadata.size]));
      if (metadata.isDirectory()) await hashDirectory(path, `${relative}/`);
      else if (metadata.isFile())
        for await (const chunk of createReadStream(path)) builtHash.update(chunk);
      else throw new Error('Orb daemon build must contain only files and directories');
    }
  };
  await hashDirectory(distSource, '');
  let key = `${version}-${sha}-dist-${builtHash.digest('hex').slice(0, 16)}`;
  const status = await checkoutCommand(runner, checkout, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  if (status) {
    const hash = createHash('sha256');
    const files = await checkoutCommand(runner, checkout, [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);
    for (const file of [...new Set(files.split('\0').filter(Boolean))].sort()) {
      const path = join(checkout, file);
      const metadata = lstatSync(path, { throwIfNoEntry: false });
      hash.update(JSON.stringify([file, metadata?.mode, metadata?.size]));
      if (metadata?.isSymbolicLink()) hash.update(readlinkSync(path));
      else if (metadata?.isFile())
        for await (const chunk of createReadStream(path)) hash.update(chunk);
    }
    key += `-dirty-${hash.digest('hex').slice(0, 16)}`;
  }
  const releases = join(root, 'releases');
  mkdirSync(releases, { recursive: true, mode: 0o755 });
  const release = join(releases, key);
  if (!existsSync(release)) {
    const temporary = mkdtempSync(join(root, '.release-'));
    try {
      let result: OrbExecResult;
      try {
        result = await runner(
          [
            'pnpm',
            '--dir',
            checkout,
            'deploy',
            '--filter',
            '@xiechimon/cairn-cli',
            '--prod',
            '--prefer-offline',
            temporary,
          ],
          {
            env: { ...process.env, PNPM_CONFIG_IGNORE_SCRIPTS: 'true' },
            signal: AbortSignal.timeout(120_000),
          },
        );
      } catch (error) {
        throw new Error(
          `Orb pnpm deploy failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (result.code !== 0)
        throw new Error(
          `Orb pnpm deploy failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
        );
      rmSync(join(temporary, 'dist'), { recursive: true, force: true });
      cpSync(distSource, join(temporary, 'dist'), { recursive: true, dereference: true });
      if (!existsSync(join(temporary, 'dist/cli.mjs')))
        throw new Error('Orb daemon build is missing cli.mjs');
      if (!existsSync(join(temporary, 'node_modules')))
        throw new Error('Orb pnpm deploy did not produce production node_modules');
      chmodSync(temporary, 0o755);
      renameSync(temporary, release);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  publishLink(root, `releases/${key}`, 'current');
  publishLink(root, 'current/dist/cli.mjs', 'cli.mjs');
  const metadata = join(root, `.current-${randomUUID()}.json`);
  try {
    writeFileSync(metadata, `${JSON.stringify({ key, version, sha })}\n`, { mode: 0o644 });
    renameSync(metadata, join(root, 'current.json'));
  } finally {
    rmSync(metadata, { force: true });
  }
  const entries = readdirSync(releases, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, mtime: lstatSync(join(releases, entry.name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime || left.name.localeCompare(right.name));
  const retained = retainedKeys();
  if (!retained) return;
  for (const entry of entries.slice(3)) {
    if (entry.name !== key && !retained.has(entry.name))
      rmSync(join(releases, entry.name), { recursive: true, force: true });
  }
}
