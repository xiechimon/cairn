import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkVirtualStore(bundleDir) {
  const modules = join(resolve(bundleDir), 'node_modules');
  if (!existsSync(modules)) throw new Error(`missing node_modules: ${modules}`);
  const store = join(modules, '.pnpm');
  if (!existsSync(store)) return;
  const pending = [store];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.name === 'package.json' || entry.isSymbolicLink()) {
        throw new Error(`package payload or symlink in virtual store: ${path}`);
      }
      if (entry.isDirectory()) pending.push(path);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const directories = process.argv.slice(2);
  if (directories.length === 0) throw new Error('usage: check-virtual-store.mjs <bundle dir>...');
  for (const directory of directories) checkVirtualStore(directory);
}
