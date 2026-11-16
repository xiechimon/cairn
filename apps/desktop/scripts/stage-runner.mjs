import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const daemonDir = resolve(desktopDir, '..', 'daemon');
const target = join(desktopDir, 'runner');

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
    target,
  ],
  { cwd: desktopDir, stdio: 'inherit' },
);

const anthropicDir = join(target, 'node_modules', '@anthropic-ai');
const bundledClaudeBinaries = readdirSync(anthropicDir).filter((name) =>
  name.startsWith('claude-agent-sdk-'),
);
for (const name of bundledClaudeBinaries) {
  rmSync(join(anthropicDir, name), { recursive: true, force: true });
}
for (const leftover of ['node_modules/.bin', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
  rmSync(join(target, leftover), { recursive: true, force: true });
}
for (const name of readdirSync(join(target, 'dist'))) {
  if (name.endsWith('.map')) rmSync(join(target, 'dist', name));
}

console.log(`staged the Cairn Runner into ${target}`);
