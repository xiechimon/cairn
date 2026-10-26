import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(here, '..', 'web', 'dist');
const target = join(here, 'web');

if (!existsSync(join(source, 'index.html'))) {
  console.error(`web dist missing (${source}) — run pnpm --filter @cairn/web build first`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
