import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HARNESS_DIRS = ['apps/web/pr-screens'];
const HARNESS_FILES = [
  'apps/web/e2e/audit-pages.ts',
  'apps/web/e2e/helpers.ts',
  'scripts/test-admission.mjs',
  'scripts/heavy-slots.mjs',
  'scripts/owned-process.mjs',
];
const CONFIG_DIR = 'apps/web';
const CONFIG_PATTERN = /^playwright\.pr-screens.*\.config\.ts$/;

function copyInto(from, to, relative, copied) {
  const source = join(from, relative);
  if (!existsSync(source) || !statSync(source).isFile()) return;
  mkdirSync(dirname(join(to, relative)), { recursive: true });
  copyFileSync(source, join(to, relative));
  copied.push(relative);
}

export function overlayHarness(from, to) {
  const copied = [];
  for (const dir of HARNESS_DIRS) {
    if (!existsSync(join(from, dir))) continue;
    for (const name of readdirSync(join(from, dir)).sort())
      copyInto(from, to, join(dir, name), copied);
  }
  for (const file of HARNESS_FILES) copyInto(from, to, file, copied);
  if (existsSync(join(from, CONFIG_DIR)))
    for (const name of readdirSync(join(from, CONFIG_DIR)).sort())
      if (CONFIG_PATTERN.test(name)) copyInto(from, to, join(CONFIG_DIR, name), copied);
  return copied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [from, to] = process.argv.slice(2);
  for (const file of overlayHarness(from, to)) process.stdout.write(`${file}\n`);
}
