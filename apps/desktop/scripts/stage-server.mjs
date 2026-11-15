import { cpSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = resolve(desktopDir, '..', 'server');
const target = join(desktopDir, 'server');

const required = [
  ['dist/index.mjs', 'pnpm --filter @xiechimon/cairn build'],
  ['web/index.html', 'pnpm --filter @cairn/web build && node apps/server/scripts/stage-web.mjs'],
  ['drizzle/meta/_journal.json', 'restore apps/server/drizzle'],
];
for (const [path, fix] of required) {
  if (!existsSync(join(serverDir, path))) {
    console.error(`apps/server/${path} is missing; run: ${fix}`);
    process.exit(1);
  }
}

rmSync(target, { recursive: true, force: true });
cpSync(join(serverDir, 'dist'), join(target, 'dist'), {
  recursive: true,
  filter: (source) => !source.endsWith('.map'),
});
cpSync(join(serverDir, 'web'), join(target, 'web'), { recursive: true });
cpSync(join(serverDir, 'drizzle'), join(target, 'drizzle'), { recursive: true });

const sqliteDir = dirname(
  createRequire(join(serverDir, 'package.json')).resolve('better-sqlite3/package.json'),
);
const sqliteTarget = join(target, 'node_modules', 'better-sqlite3');
const prebuildPlatforms = new Set(['darwin', process.platform]);
for (const entry of ['package.json', 'LICENSE', 'lib', 'prebuilds']) {
  cpSync(join(sqliteDir, entry), join(sqliteTarget, entry), {
    recursive: true,
    filter: (source) =>
      !source.endsWith('.node') || prebuildPlatforms.has(basename(source).split('-')[0] ?? ''),
  });
}

console.log(`staged the Cairn server into ${target}`);
