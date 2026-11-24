import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRunnerClaude } from './check-runner-claude.mjs';
import { checkVirtualStore } from './check-virtual-store.mjs';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const daemonDir = resolve(desktopDir, '..', 'daemon');
const target = join(desktopDir, 'runner');
const platform = process.platform;
const arch = process.env.ARCH ?? process.arch;

if (!existsSync(join(daemonDir, 'dist', 'cli.mjs'))) {
  console.error(
    'apps/daemon/dist/cli.mjs is missing; run: pnpm --filter @xiechimon/cairn-cli build',
  );
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
execFileSync(
  'pnpm',
  [
    '--filter',
    '@xiechimon/cairn-cli',
    'deploy',
    '--prod',
    '--ignore-scripts',
    '--config.node-linker=hoisted',
    '--config.package-import-method=copy',
    `--os=${platform}`,
    `--cpu=${arch}`,
    target,
  ],
  { cwd: desktopDir, stdio: 'inherit', shell: process.platform === 'win32' },
);

for (const leftover of ['node_modules/.bin', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
  rmSync(join(target, leftover), { recursive: true, force: true });
}
for (const name of readdirSync(join(target, 'dist'))) {
  if (name.endsWith('.map')) rmSync(join(target, 'dist', name));
}

checkVirtualStore(target);
console.log(
  `Claude Code binary for ${platform}-${arch}: ${resolveRunnerClaude(target, platform, arch)}`,
);
console.log(`staged the Cairn Runner into ${target}`);
