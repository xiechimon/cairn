import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));

const bundleFormFlag = {
  name: 'cairn-bundle-form',
  setup(b) {
    b.onLoad({ filter: /src[\\/]bundle-form\.ts$/ }, () => ({
      contents: 'export const BUNDLED_FORM = true;',
      loader: 'js',
    }));
  },
};

const banner = [
  '#!/usr/bin/env node',
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
].join('\n');

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['better-sqlite3'],
  plugins: [bundleFormFlag],
  banner: { js: banner },
  sourcemap: true,
  logLevel: 'info',
});

mkdirSync(resolve(root, 'dist'), { recursive: true });
copyFileSync(
  resolve(root, '../../scripts/harness-eval-worker.mjs'),
  resolve(root, 'dist/harness-eval-worker.mjs'),
);
